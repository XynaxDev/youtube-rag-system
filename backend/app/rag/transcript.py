"""
Transcript extraction, video metadata fetching, and document chunking.
Extracted from singleVideo.py / multiVideo.py.
"""

import re
import math
import logging
import time
import os
import json
import urllib.request
from xml.etree.ElementTree import ParseError as XmlParseError
from dataclasses import dataclass
from datetime import datetime
from typing import List, Tuple, Dict, Optional

import requests
import random
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
)

try:
    from yt_dlp import YoutubeDL  # type: ignore
except Exception:  # pragma: no cover
    YoutubeDL = None  # type: ignore

try:
    from youtube_transcript_api._errors import VideoUnplayable  # type: ignore
except Exception:  # pragma: no cover
    VideoUnplayable = Exception  # fallback for compatibility
try:
    from youtube_transcript_api._errors import YouTubeRequestFailed  # type: ignore
except Exception:  # pragma: no cover
    YouTubeRequestFailed = Exception  # fallback for compatibility
try:
    from youtube_transcript_api._errors import IpBlocked  # type: ignore
except Exception:  # pragma: no cover
    IpBlocked = Exception  # fallback for compatibility
try:
    from youtube_transcript_api._errors import RequestBlocked  # type: ignore
except Exception:  # pragma: no cover
    RequestBlocked = Exception  # fallback for compatibility

from googleapiclient.discovery import build
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import GOOGLE_API_KEY, CHROMA_PERSIST_DIR

logger = logging.getLogger(__name__)

_LAST_TRANSCRIPT_ERRORS: Dict[str, str] = {}
_RATE_LIMIT_UNTIL: Dict[str, float] = {}
_TRANSCRIPT_CACHE_MEM: Dict[str, List["TranscriptFragment"]] = {}
TRANSCRIPT_CACHE_DIR = os.getenv(
    "TRANSCRIPT_CACHE_DIR",
    os.path.abspath(os.path.join(CHROMA_PERSIST_DIR, "..", ".transcript_cache")),
)
os.makedirs(TRANSCRIPT_CACHE_DIR, exist_ok=True)

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
]


def _get_random_ua():
    return random.choice(_USER_AGENTS)


SUPPORTED_LANGS = [
    "en",
    "en-US",
    "en-GB",
    "en-IN",
    "en-CA",
    "en-AU",
    "hi",
    "hi-IN",
    "es",
    "es-ES",
    "es-MX",
    "fr",
    "fr-FR",
    "de",
    "de-DE",
    "zh-Hans",
    "zh-Hant",
    "zh-CN",
    "zh-TW",
    "ja",
    "ja-JP",
    "ko",
    "ko-KR",
    "ru",
    "ru-RU",
    "pt",
    "pt-BR",
    "pt-PT",
    "it",
    "it-IT",
    "ar",
    "ar-SA",
    "tr",
    "tr-TR",
    "vi",
    "vi-VN",
]


@dataclass
class TranscriptFragment:
    text: str
    start: float
    duration: float


def _cache_path(video_id: str) -> str:
    safe_video_id = re.sub(r"[^0-9A-Za-z_-]", "", str(video_id or ""))
    return os.path.join(TRANSCRIPT_CACHE_DIR, f"{safe_video_id}.json")


def _serialize_fragments(fragments: List["TranscriptFragment"]) -> list[dict]:
    payload: list[dict] = []
    for fragment in fragments:
        payload.append(
            {
                "text": fragment.text,
                "start": float(fragment.start),
                "duration": float(fragment.duration),
            }
        )
    return payload


def _load_transcript_cache(video_id: str) -> List["TranscriptFragment"]:
    mem_cached = _TRANSCRIPT_CACHE_MEM.get(video_id)
    if mem_cached:
        return mem_cached

    path = _cache_path(video_id)
    if not os.path.exists(path):
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        cached = _normalize_fragments(payload)
        if cached:
            _TRANSCRIPT_CACHE_MEM[video_id] = cached
        return cached
    except Exception as e:
        logger.warning("Failed to load transcript cache for %s: %s", video_id, e)
        return []


def _save_transcript_cache(
    video_id: str, fragments: List["TranscriptFragment"]
) -> None:
    if not fragments:
        return
    _TRANSCRIPT_CACHE_MEM[video_id] = fragments
    path = _cache_path(video_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_serialize_fragments(fragments), f, ensure_ascii=False)
    except Exception as e:
        logger.warning("Failed to persist transcript cache for %s: %s", video_id, e)


def clear_transcript_cache(video_id: str) -> bool:
    """Remove transcript cache (memory + disk) for a video id."""
    removed = False
    if _TRANSCRIPT_CACHE_MEM.pop(video_id, None) is not None:
        removed = True
    _LAST_TRANSCRIPT_ERRORS.pop(video_id, None)
    _RATE_LIMIT_UNTIL.pop(video_id, None)

    path = _cache_path(video_id)
    if os.path.exists(path):
        try:
            os.remove(path)
            removed = True
        except Exception as e:
            logger.warning("Unable to remove transcript cache for %s: %s", video_id, e)
    return removed


def _set_last_error(video_id: str, message: str) -> None:
    text = (message or "").strip()
    # Avoid leaking long signed URLs in API responses/log summaries.
    text = re.sub(r"https?://\S+", "<url>", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 280:
        text = text[:277] + "..."
    _LAST_TRANSCRIPT_ERRORS[video_id] = text


def _clear_last_error(video_id: str) -> None:
    _LAST_TRANSCRIPT_ERRORS.pop(video_id, None)


def _normalize_fragment_text(text: str) -> str:
    if not text:
        return ""
    cleaned = str(text).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _normalize_fragments(raw_items) -> List[TranscriptFragment]:
    """Normalize transcript snippets from youtube_transcript_api outputs."""
    normalized: List[TranscriptFragment] = []
    if not raw_items:
        return normalized

    if hasattr(raw_items, "snippets"):
        raw_items = getattr(raw_items, "snippets") or []

    for item in raw_items:
        text = getattr(item, "text", None)
        start = getattr(item, "start", None)
        duration = getattr(item, "duration", None)

        if text is None and isinstance(item, dict):
            text = item.get("text")
            start = item.get("start")
            duration = item.get("duration")

        clean_text = _normalize_fragment_text(text or "")
        if not clean_text:
            continue

        try:
            s = float(start or 0.0)
            d = float(duration or 0.0)
        except Exception:
            s, d = 0.0, 0.0

        if d <= 0:
            d = 2.0

        normalized.append(TranscriptFragment(text=clean_text, start=s, duration=d))

    return normalized


def _timecode_to_seconds(value: str) -> float:
    raw = (value or "").strip().replace(",", ".")
    if not raw:
        return 0.0
    parts = raw.split(":")
    try:
        if len(parts) == 3:
            h = float(parts[0])
            m = float(parts[1])
            s = float(parts[2])
            return h * 3600 + m * 60 + s
        if len(parts) == 2:
            m = float(parts[0])
            s = float(parts[1])
            return m * 60 + s
        return float(parts[0])
    except Exception:
        return 0.0


def _parse_vtt_fragments(vtt_text: str) -> List[TranscriptFragment]:
    if not vtt_text:
        return []
    text = vtt_text.replace("\r\n", "\n")
    lines = text.split("\n")
    fragments: List[TranscriptFragment] = []
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if "-->" not in line:
            i += 1
            continue

        start_raw, end_raw = [p.strip() for p in line.split("-->", 1)]
        start = _timecode_to_seconds(start_raw.split(" ")[0])
        end = _timecode_to_seconds(end_raw.split(" ")[0])
        duration = max(0.5, end - start)

        i += 1
        cue_lines: List[str] = []
        while i < len(lines):
            cue_line = lines[i].strip()
            if not cue_line:
                break
            if cue_line.startswith("NOTE") or cue_line.startswith("WEBVTT"):
                i += 1
                continue
            cue_line = re.sub(r"<[^>]+>", "", cue_line)
            cue_lines.append(cue_line)
            i += 1

        cue_text = _normalize_fragment_text(" ".join(cue_lines))
        if cue_text:
            fragments.append(
                TranscriptFragment(
                    text=cue_text, start=float(start), duration=float(duration)
                )
            )
        i += 1

    return fragments


def _parse_json3_fragments(raw_text: str) -> List[TranscriptFragment]:
    if not raw_text:
        return []
    try:
        payload = json.loads(raw_text)
    except Exception:
        return []

    events = payload.get("events") or []
    fragments: List[TranscriptFragment] = []
    for event in events:
        segs = event.get("segs") or []
        parts = []
        for seg in segs:
            piece = _normalize_fragment_text((seg or {}).get("utf8", ""))
            if piece:
                parts.append(piece)
        text = _normalize_fragment_text(" ".join(parts))
        if not text:
            continue
        start = float(event.get("tStartMs", 0) or 0) / 1000.0
        duration = float(event.get("dDurationMs", 0) or 0) / 1000.0
        if duration <= 0:
            duration = 2.0
        fragments.append(TranscriptFragment(text=text, start=start, duration=duration))
    return fragments


def _read_url_text(url: str, timeout: float = 20.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
    return raw.decode("utf-8", errors="replace")


def _extract_with_ytdlp(video_id: str) -> List[TranscriptFragment]:
    if YoutubeDL is None:
        return []

    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        with YoutubeDL(
            {
                "skip_download": True,
                "quiet": True,
                "no_warnings": True,
                "nocheckcertificate": True,
                "user_agent": _get_random_ua(),
                "referer": "https://www.youtube.com/",
                "extractor_args": {
                    "youtube": {
                        "player_client": ["web_creator", "ios", "android"],
                        "skip": ["webpage", "authcheck"],
                    }
                },
            }
        ) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        logger.info("yt-dlp metadata extraction failed for %s: %s", video_id, e)
        return []

    subtitle_maps = [
        info.get("subtitles") or {},
        info.get("automatic_captions") or {},
    ]

    language_candidates: List[str] = []
    for code in SUPPORTED_LANGS:
        c = str(code).strip()
        if c and c not in language_candidates:
            language_candidates.append(c)
        base = c.split("-")[0]
        if base and base not in language_candidates:
            language_candidates.append(base)

    def score_track(item: dict) -> tuple:
        ext = str(item.get("ext") or "").lower()
        if ext == "vtt":
            return (0, 0)
        if ext == "json3":
            return (1, 0)
        if ext == "srv3":
            return (2, 0)
        if ext == "ttml":
            return (3, 0)
        return (9, 0)

    for subtitle_map in subtitle_maps:
        if not subtitle_map:
            continue

        keys = list(subtitle_map.keys())
        ordered_languages = [k for k in language_candidates if k in subtitle_map]
        for k in keys:
            if k not in ordered_languages:
                ordered_languages.append(k)

        for lang in ordered_languages:
            tracks = subtitle_map.get(lang) or []
            sorted_tracks = sorted(tracks, key=score_track)
            for track in sorted_tracks:
                track_url = track.get("url")
                if not track_url:
                    continue
                ext = str(track.get("ext") or "").lower()
                try:
                    raw_text = _read_url_text(track_url)
                    fragments: List[TranscriptFragment] = []
                    if ext == "json3":
                        fragments = _parse_json3_fragments(raw_text)
                    else:
                        fragments = _parse_vtt_fragments(raw_text)
                        if not fragments and raw_text.lstrip().startswith("{"):
                            fragments = _parse_json3_fragments(raw_text)

                    if fragments:
                        logger.info(
                            "yt-dlp transcript fallback succeeded for %s (lang=%s ext=%s chunks=%d)",
                            video_id,
                            lang,
                            ext or "unknown",
                            len(fragments),
                        )
                        return fragments
                except Exception as e:
                    logger.info(
                        "yt-dlp track fetch failed for %s (lang=%s ext=%s): %s",
                        video_id,
                        lang,
                        ext or "unknown",
                        e,
                    )
                    continue

    return []


def _is_rate_limited_error(err: Exception) -> bool:
    msg = str(err).lower()
    # Detect HTTP 429, explicit rate-limit messages, and YouTube IP/request blocks.
    if "429" in msg or "too many requests" in msg:
        return True
    if "ip" in msg and "block" in msg:
        return True
    if isinstance(err, (IpBlocked, RequestBlocked)):
        return True
    return False


def _is_empty_xml_error(err: Exception) -> bool:
    msg = str(err).lower()
    return "no element found" in msg or isinstance(err, XmlParseError)


def _run_with_backoff(video_id: str, stage: str, fn, retries: int = 3):
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            result = fn()
            if not result:
                raise ValueError("Empty response body from YouTube")
            return result
        except Exception as e:
            last_exc = e
            is_rate_limited = _is_rate_limited_error(e)
            is_empty_xml = _is_empty_xml_error(e) or isinstance(e, ValueError)
            if not (is_rate_limited or is_empty_xml):
                raise

            if is_rate_limited:
                wait_s = min(8.0, 1.5 * (2**attempt))
                logger.warning(
                    "YouTube rate-limited during %s for %s (attempt %d/%d). Retrying in %.1fs",
                    stage,
                    video_id,
                    attempt + 1,
                    retries,
                    wait_s,
                )
            else:
                wait_s = min(5.0, 2.0 * (attempt + 1))
                logger.info(
                    "YouTube returned empty XML during %s for %s (attempt %d/%d). Retrying in %.1fs",
                    stage,
                    video_id,
                    attempt + 1,
                    retries,
                    wait_s,
                )
            time.sleep(wait_s)
    if last_exc:
        raise last_exc
    result = fn()
    if not result:
        raise ValueError(
            f"Direct fetch for {video_id} during {stage} returned empty result"
        )
    return result


def extract_video_id(url_or_id: str) -> str:
    """Extract YouTube video ID from a URL or return as-is if already an ID."""
    pattern = r"(?:v=|/|be/)([0-9A-Za-z_-]{11})"
    m = re.search(pattern, url_or_id)
    return m.group(1) if m else url_or_id


def parse_published_at(iso_ts: Optional[str]) -> str:
    if not iso_ts:
        return "Unknown"
    try:
        if iso_ts.endswith("Z"):
            iso_ts = iso_ts.replace("Z", "+00:00")
        return datetime.fromisoformat(iso_ts).date().isoformat()
    except Exception:
        try:
            return datetime.strptime(iso_ts, "%Y-%m-%dT%H:%M:%SZ").date().isoformat()
        except Exception:
            return "Unknown"


def fetch_video_metadata(video_id: str) -> Dict[str, str]:
    """Fetch video metadata using YouTube Data API v3."""
    default = {
        "video_id": video_id,
        "title": "Unknown",
        "channel": "Unknown",
        "date": "Unknown",
        "description": "",
    }
    try:
        if not GOOGLE_API_KEY:
            logger.warning("GOOGLE_API_KEY not found; returning placeholder metadata.")
            return default

        youtube = build(
            "youtube",
            "v3",
            developerKey=GOOGLE_API_KEY,
            cache_discovery=False,
        )
        response = youtube.videos().list(part="snippet", id=video_id).execute()
        items = response.get("items", [])
        if not items:
            return default

        snippet = items[0].get("snippet", {})
        return {
            "video_id": video_id,
            "title": snippet.get("title", "Unknown"),
            "channel": snippet.get("channelTitle", "Unknown"),
            "date": parse_published_at(snippet.get("publishedAt")),
            "description": snippet.get("description", ""),
        }
    except Exception as e:
        logger.exception("Error fetching metadata: %s", e)
        return default


def fetch_transcript_fragments(video_id: str):
    """Fetch transcript fragments via youtube_transcript_api direct flow."""
    cached = _load_transcript_cache(video_id)
    if cached:
        _clear_last_error(video_id)
        _RATE_LIMIT_UNTIL.pop(video_id, None)
        logger.info(
            "Using cached transcript for %s (%d fragments)", video_id, len(cached)
        )
        return cached

    now = time.time()
    blocked_until = float(_RATE_LIMIT_UNTIL.get(video_id, 0.0) or 0.0)
    if blocked_until > now:
        retry_in = int(max(1, blocked_until - now))
        _set_last_error(
            video_id,
            f"YouTube transcript API is temporarily rate-limited for this video. Retry in {retry_in}s.",
        )
        return []

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": _get_random_ua(),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
        }
    )

    api = YouTubeTranscriptApi(http_client=session)

    try:
        logger.info("Attempting prioritized transcript fetch for %s", video_id)
        prioritized_raw = _run_with_backoff(
            video_id,
            "prioritized transcript fetch",
            lambda: api.fetch(video_id, languages=SUPPORTED_LANGS),
            retries=3,
        )
        prioritized = _normalize_fragments(prioritized_raw)
        if prioritized:
            _clear_last_error(video_id)
            _RATE_LIMIT_UNTIL.pop(video_id, None)
            _save_transcript_cache(video_id, prioritized)
            return prioritized
    except Exception as e:
        logger.info(
            "Prioritized fetch failed for %s: %s. Attempting broad fallback...",
            video_id,
            e,
        )
        if _is_rate_limited_error(e):
            _RATE_LIMIT_UNTIL[video_id] = time.time() + 45
            _set_last_error(
                video_id,
                "YouTube transcript API rate-limited this request (429). Please wait about a minute and retry.",
            )

    try:
        transcript_list = _run_with_backoff(
            video_id,
            "transcript list fetch",
            lambda: list(api.list(video_id)),
            retries=3,
        )

        # 1) English-first fallback (from your proven working logic).
        for t in transcript_list:
            code = str(getattr(t, "language_code", "")).lower()
            if code.startswith("en"):
                try:
                    raw = _run_with_backoff(
                        video_id,
                        f"english track fetch ({getattr(t, 'language_code', 'unknown')})",
                        lambda t=t: t.fetch(),
                        retries=3,
                    )
                    snippets = _normalize_fragments(raw)
                    if snippets:
                        logger.info(
                            "Fallback transcript fetched for %s from English track (%s)",
                            video_id,
                            getattr(t, "language_code", "unknown"),
                        )
                        _clear_last_error(video_id)
                        _RATE_LIMIT_UNTIL.pop(video_id, None)
                        _save_transcript_cache(video_id, snippets)
                        return snippets
                except Exception as track_err:
                    if _is_rate_limited_error(track_err):
                        _RATE_LIMIT_UNTIL[video_id] = time.time() + 60
                        _set_last_error(
                            video_id,
                            "YouTube transcript API rate-limited this request (429). Please wait about a minute and retry.",
                        )
                        return []
                    logger.info(
                        "Skipping English transcript track (%s) for %s due to fetch error: %s",
                        getattr(t, "language_code", "unknown"),
                        video_id,
                        track_err,
                    )
                    continue

        # 2) First available track fallback.
        for t in transcript_list:
            try:
                raw = _run_with_backoff(
                    video_id,
                    f"first-available track fetch ({getattr(t, 'language_code', 'unknown')})",
                    lambda t=t: t.fetch(),
                    retries=2,
                )
                snippets = _normalize_fragments(raw)
                if snippets:
                    logger.info(
                        "Fallback transcript fetched for %s from first available track (%s)",
                        video_id,
                        getattr(t, "language_code", "unknown"),
                    )
                    _clear_last_error(video_id)
                    _RATE_LIMIT_UNTIL.pop(video_id, None)
                    _save_transcript_cache(video_id, snippets)
                    return snippets
            except Exception as track_err:
                if _is_rate_limited_error(track_err):
                    _RATE_LIMIT_UNTIL[video_id] = time.time() + 60
                    _set_last_error(
                        video_id,
                        "YouTube transcript API rate-limited this request (429). Please wait about a minute and retry.",
                    )
                    return []
                logger.info(
                    "Skipping transcript track (%s) for %s due to fetch error: %s",
                    getattr(t, "language_code", "unknown"),
                    video_id,
                    track_err,
                )
                continue

        # 3) Last fallback: let API choose default track without language hints.
        try:
            raw_default = _run_with_backoff(
                video_id,
                "default-track fetch",
                lambda: api.fetch(video_id),
                retries=2,
            )
            default_snippets = _normalize_fragments(raw_default)
            if default_snippets:
                logger.info(
                    "Fallback transcript fetched for %s from default-track fetch",
                    video_id,
                )
                _clear_last_error(video_id)
                _RATE_LIMIT_UNTIL.pop(video_id, None)
                _save_transcript_cache(video_id, default_snippets)
                return default_snippets
        except Exception as default_err:
            logger.info(
                "Default-track fetch failed for %s: %s",
                video_id,
                default_err,
            )

    except TranscriptsDisabled as e:
        logger.warning("Transcripts explicitly disabled for %s", video_id)
        _set_last_error(video_id, str(e))
    except NoTranscriptFound as e:
        logger.warning("No transcript records found for %s", video_id)
        _set_last_error(video_id, str(e))
    except VideoUnplayable as e:
        logger.warning("Video unplayable for transcript API for %s: %s", video_id, e)
        _set_last_error(video_id, str(e))
    except (IpBlocked, RequestBlocked) as e:
        logger.warning("YouTube blocked request for %s: %s", video_id, e)
        _RATE_LIMIT_UNTIL[video_id] = time.time() + 90
        _set_last_error(
            video_id,
            "YouTube is blocking transcript requests from this IP. Please wait a few minutes and retry, or try a different network.",
        )
    except YouTubeRequestFailed as e:
        logger.warning("YouTube request failed for %s: %s", video_id, e)
        if _is_rate_limited_error(e):
            _RATE_LIMIT_UNTIL[video_id] = time.time() + 60
            _set_last_error(
                video_id,
                "YouTube transcript API rate-limited this request (429). Please wait about a minute and retry.",
            )
        else:
            _set_last_error(video_id, str(e))
    except Exception as e:
        logger.exception(
            "Catastrophic failure fetching transcript for %s: %s", video_id, e
        )
        if _is_rate_limited_error(e):
            _RATE_LIMIT_UNTIL[video_id] = time.time() + 60
            _set_last_error(
                video_id,
                "YouTube transcript API rate-limited this request (429). Please wait about a minute and retry.",
            )
            return []
        _set_last_error(video_id, str(e))

    # Final legacy class-method fallback for compatibility.
    try:
        getter = getattr(YouTubeTranscriptApi, "get_transcript", None)
        if callable(getter):
            legacy_raw = _run_with_backoff(
                video_id,
                "legacy get_transcript fallback",
                lambda: getter(video_id, languages=SUPPORTED_LANGS),
                retries=2,
            )
            legacy = _normalize_fragments(legacy_raw)
            if legacy:
                logger.info(
                    "Fetched transcript for %s via legacy get_transcript fallback",
                    video_id,
                )
                _clear_last_error(video_id)
                _RATE_LIMIT_UNTIL.pop(video_id, None)
                _save_transcript_cache(video_id, legacy)
                return legacy
    except Exception:
        pass

    # Fallback via yt-dlp subtitles/automatic captions when XML timedtext parsing fails.
    ytdlp_fragments = _extract_with_ytdlp(video_id)
    if ytdlp_fragments:
        _clear_last_error(video_id)
        _RATE_LIMIT_UNTIL.pop(video_id, None)
        _save_transcript_cache(video_id, ytdlp_fragments)
        return ytdlp_fragments

    _LAST_TRANSCRIPT_ERRORS.setdefault(
        video_id,
        "Transcript retrieval returned no usable content.",
    )
    return []


def get_last_transcript_error(video_id: str) -> str:
    return (_LAST_TRANSCRIPT_ERRORS.get(video_id) or "").strip()


def describe_transcript_issue(video_id: str) -> str:
    err = get_last_transcript_error(video_id)
    lowered = err.lower()

    if err:
        if (
            "rate-limited" in lowered
            or "too many requests" in lowered
            or "429" in lowered
        ):
            return (
                f"YouTube is rate-limiting transcript requests for video {video_id} (429). "
                "Please wait 1-2 minutes and try again."
            )
        if "video is unplayable" in lowered or "videounplayable" in lowered:
            return (
                f"YouTube transcript API marked video {video_id} as unplayable from this environment. "
                "Please retry once, or try a different public YouTube link."
            )
        if (
            "winerror 10013" in lowered
            or "failed to establish a new connection" in lowered
            or "max retries exceeded" in lowered
            or "httpsconnectionpool" in lowered
        ):
            return (
                f"Unable to reach YouTube for video {video_id}. "
                "Please check firewall/proxy/network and try again."
            )
        if "transcripts are disabled" in lowered:
            return f"Transcript is disabled for video {video_id}."
        if "no transcript could be found" in lowered or "notranscriptfound" in lowered:
            return f"No transcript track found for video {video_id}."
        if "no element found" in lowered or "parseerror" in lowered:
            return (
                f"YouTube returned empty caption data for video {video_id}. "
                "Please retry once; if it persists, try another public video link."
            )
        return (
            f"Transcript unavailable for video {video_id}. "
            "Please retry in a minute or try a different public YouTube link."
        )

    return (
        f"Transcript not available for video {video_id}. "
        "Please try another video or try again later."
    )


def ingest_video_to_chunks(video_id: str) -> Tuple[List[Document], int]:
    """
    Fetch transcript, create timestamped documents, and split into chunks.
    Returns (chunks, dynamic_k).
    """
    fragments = fetch_transcript_fragments(video_id)
    fragment_docs = []
    for fragment in fragments:
        fragment_docs.append(
            Document(
                page_content=fragment.text,
                metadata={
                    "video_id": video_id,
                    "start": int(fragment.start),
                    "end": int(fragment.start + fragment.duration),
                },
            )
        )

    total_chars = sum(len(d.page_content) for d in fragment_docs)
    logger.info("Total Transcript Length for %s: %d", video_id, total_chars)

    if not fragment_docs:
        return [], 5

    target_size = max(600, min(1200, int(total_chars / 50)))
    overlap = int(target_size * 0.15)

    raw_docs = []
    current_content = []
    current_start = 0
    current_len = 0

    for i, doc in enumerate(fragment_docs):
        if not current_content:
            current_start = doc.metadata.get("start", 0)
        current_content.append(doc.page_content)
        current_len += len(doc.page_content)
        current_end = doc.metadata.get("end", 0)

        if current_len >= target_size or i == len(fragment_docs) - 1:
            timestamp_label = f"[Timestamp: {int(current_start)}s] "
            raw_docs.append(
                Document(
                    page_content=timestamp_label + " ".join(current_content),
                    metadata={
                        "video_id": video_id,
                        "start": int(current_start),
                        "end": int(current_end),
                    },
                )
            )
            current_content = []
            current_len = 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=target_size, chunk_overlap=overlap
    )
    chunks = splitter.split_documents(raw_docs)

    num_chunks = len(chunks)
    if num_chunks < 20:
        dynamic_k = min(num_chunks, 5)
    else:
        dynamic_k = max(5, min(10, int(math.log2(num_chunks) * 1.5)))

    logger.info(
        "Video %s: chunks=%d, chunk_size=%d, dynamic_k=%d",
        video_id,
        num_chunks,
        target_size,
        dynamic_k,
    )
    return chunks, dynamic_k


def sec_to_mmss(s: int) -> str:
    m = s // 60
    sec = s % 60
    return f"{m:02d}:{sec:02d}"
