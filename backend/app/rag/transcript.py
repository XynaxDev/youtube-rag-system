"""
Transcript extraction, video metadata fetching, and document chunking.
Extracted from singleVideo.py / multiVideo.py.
"""

import os
import re
import math
import logging
from datetime import datetime
from typing import List, Tuple, Dict, Optional

from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
)
from googleapiclient.discovery import build
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import GOOGLE_API_KEY

logger = logging.getLogger(__name__)

SUPPORTED_LANGS = [
    "en",
    "hi",
    "es",
    "fr",
    "de",
    "zh-Hans",
    "zh-Hant",
    "ja",
    "ko",
    "ru",
    "pt",
    "it",
    "ar",
    "tr",
    "vi",
]


def extract_video_id(url_or_id: str) -> str:
    """Extract YouTube video ID from a URL or return as-is if already an ID."""
    pattern = r"(?:v=|\/|be\/)([0-9A-Za-z_-]{11})"
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

        youtube = build("youtube", "v3", developerKey=GOOGLE_API_KEY)
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
    """Fetch transcript fragments from YouTube."""
    api = YouTubeTranscriptApi()
    try:
        return api.fetch(video_id, languages=SUPPORTED_LANGS)
    except TranscriptsDisabled:
        logger.warning("Transcripts disabled for %s", video_id)
        return []
    except NoTranscriptFound:
        logger.warning("No transcript for %s", video_id)
        return []
    except Exception as e:
        logger.exception("Error fetching transcript: %s", e)
        return []


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
