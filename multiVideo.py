import os
import re
import math
import time
import logging
import unicodedata
import threading
from collections import defaultdict
from datetime import datetime
from typing import List, Tuple, Optional, Dict, Union

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import Literal

# YouTube transcript & metadata
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
)
from googleapiclient.discovery import build

# LangChain-like imports (kept as you had them)
from langchain_core.prompts import PromptTemplate
from langchain_ollama import OllamaEmbeddings, ChatOllama
from test2 import open_router_model  # your router model
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_community.vectorstores import Chroma
from langchain_classic.retrievers.self_query.base import SelfQueryRetriever
from langchain_classic.chains.query_constructor.base import (
    AttributeInfo,
    load_query_constructor_runnable,
)
from langchain_community.query_constructors.chroma import ChromaTranslator
from langchain_core.output_parsers import StrOutputParser, PydanticOutputParser
from langchain_community.chat_message_histories import ChatMessageHistory

# load env & logging
load_dotenv()
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# quiet noisy libs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("chromadb").setLevel(logging.WARNING)
logging.getLogger("ollama").setLevel(logging.WARNING)
logging.getLogger("langchain").setLevel(logging.WARNING)

# -------------------------
# Models & embeddings (Safe wrapper)
# -------------------------
model_ep = HuggingFaceEndpoint(repo_id="XiaomiMiMo/MiMo-V2-Flash", temperature=0.5)
model_hf = ChatHuggingFace(llm=model_ep)
model_ollama = ChatOllama(model="llama3.2:3b", temperature=0.5)
model_google = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.4)


class SafeOllamaEmbeddings(OllamaEmbeddings):
    """
    Wrapper around OllamaEmbeddings that sanitizes any NaN/Inf in embedding vectors
    and retries a couple times on transient failures.
    """

    def _sanitize_vector(self, vec):
        sanitized = []

        def _flatten(x):
            if isinstance(x, (list, tuple)):
                for el in x:
                    yield from _flatten(el)
            else:
                yield x

        for v in _flatten(vec):
            try:
                fv = float(v)
                if not math.isfinite(fv):
                    sanitized.append(0.0)
                else:
                    sanitized.append(fv)
            except Exception:
                sanitized.append(0.0)
        return sanitized

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        raw = super().embed_documents(texts)
        return [self._sanitize_vector(v) for v in raw]

    def embed_query(self, text: str) -> List[float]:
        # retry once on transient errors
        for attempt in range(2):
            try:
                raw = super().embed_query(text)
                return self._sanitize_vector(raw)
            except Exception as e:
                logger.debug("embed_query attempt %d failed: %s", attempt + 1, e)
                time.sleep(0.2 * (attempt + 1))
        logger.warning("embed_query failed twice; returning safe zero vector")
        return [0.0]


embeddings = SafeOllamaEmbeddings(model="bge-m3")

# Supported languages hint for transcript fetch
SUPPORTED_LANGS = ["en","hi","es","fr","de","zh-Hans","zh-Hant","ja","ko","ru","pt","it","ar","tr","vi"]

# -------------------------
# Helpers
# -------------------------
def extract_video_id(url_or_id: str) -> str:
    pattern = r"(?:v=|\/)([0-9A-Za-z_-]{11}).*"
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


def sec_to_mmss(s: int) -> str:
    m = s // 60
    sec = s % 60
    return f"{m:02d}:{sec:02d}"


# -------------------------
# YouTube metadata fetcher (googleapiclient)
# -------------------------
def fetch_video_metadata(video_id: str) -> Dict[str, str]:
    try:
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("GOOGLE_API_KEY not found; returning placeholder metadata.")
            return {
                "video_id": video_id,
                "title": "Unknown",
                "channel": "Unknown",
                "date": "Unknown",
                "description": "",
            }
        youtube = build("youtube", "v3", developerKey=api_key)
        response = youtube.videos().list(part="snippet", id=video_id).execute()
        items = response.get("items", [])
        if not items:
            return {
                "video_id": video_id,
                "title": "Unknown",
                "channel": "Unknown",
                "date": "Unknown",
                "description": "",
            }
        snippet = items[0].get("snippet", {})
        title = snippet.get("title", "Unknown")
        channel = snippet.get("channelTitle", "Unknown")
        published_at = parse_published_at(snippet.get("publishedAt"))
        description = snippet.get("description", "")
        return {
            "video_id": video_id,
            "title": title,
            "channel": channel,
            "date": published_at,
            "description": description,
        }
    except Exception as e:
        logger.exception("Error fetching metadata: %s", e)
        return {
            "video_id": video_id,
            "title": "Unknown",
            "channel": "Unknown",
            "date": "Unknown",
            "description": "",
        }


# -------------------------
# Transcript ingestion & chunking (unchanged core logic)
# -------------------------
def fetch_transcript_fragments(video_id: str):
    api = YouTubeTranscriptApi()
    try:
        return api.fetch(video_id, languages=SUPPORTED_LANGS)
    except TranscriptsDisabled:
        logger.warning(f"Transcripts disabled for {video_id}")
        return []
    except NoTranscriptFound:
        logger.warning(f"No transcript for {video_id}")
        return []
    except Exception as e:
        logger.exception("Error fetching transcript: %s", e)
        return []


def ingest_video_to_chunks(video_id: str) -> Tuple[List[Document], int]:
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
    logger.info(f"Total Transcript Length for {video_id}: {total_chars}")

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


# -------------------------
# Multilingual-safe chunk validator (prevents NaN embeddings)
# -------------------------
def validate_chunks_for_embeddings(chunks: List[Document]) -> List[Document]:
    """
    Multilingual-safe chunk validator + embedding numeric check.
    Strategy:
      - Remove control chars only
      - Normalize Unicode
      - Minimum semantic length check
      - Try embeddings with retry; check numeric finiteness
      - On failure, merge with previous validated chunk
    """
    validated_chunks: List[Document] = []

    for chunk in chunks:
        content = (chunk.page_content or "").strip()
        if not content:
            continue

        # remove control characters only (unicode category C)
        content = "".join(ch for ch in content if unicodedata.category(ch)[0] != "C")
        content = " ".join(content.split())
        if len(content) < 15:
            continue

        # canonical normalize (NFKC)
        content = unicodedata.normalize("NFKC", content)

        # attempt embedding with small retry
        success = False
        vec = None
        for attempt in range(2):
            try:
                vec = embeddings.embed_query(content)
                # flatten and check numeric values
                flat = []

                def _flatten(x):
                    if isinstance(x, (list, tuple)):
                        for el in x:
                            _flatten(el)
                    else:
                        flat.append(float(x))

                _flatten(vec)
                if not flat:
                    raise ValueError("empty embedding")
                if any(not math.isfinite(v) for v in flat):
                    raise ValueError("embedding contains NaN/Inf")
                success = True
                break
            except Exception as e:
                logger.debug(
                    "Embedding attempt %d failed for chunk start=%s: %s",
                    attempt + 1,
                    chunk.metadata.get("start"),
                    e,
                )
                time.sleep(0.15 * (attempt + 1))

        if success:
            validated_chunks.append(Document(page_content=content, metadata=chunk.metadata))
        else:
            # merge with previous if possible to preserve context
            logger.debug("Embedding failed for chunk start=%s -> merging/skip", chunk.metadata.get("start"))
            if validated_chunks:
                prev = validated_chunks[-1]
                merged = prev.page_content + " " + content
                validated_chunks[-1] = Document(page_content=merged, metadata=prev.metadata)
            else:
                # nothing to merge into: skip
                continue

    logger.info("✅ Validated %d/%d chunks for embedding", len(validated_chunks), max(1, len(chunks)))
    return validated_chunks


# -------------------------
# Vectorstore creation (per-video) with validation
# -------------------------
def create_vectorstore_for_video(video_id: str, chunks: List[Document], collection_name: Optional[str] = None) -> Optional[Chroma]:
    if collection_name is None:
        collection_name = f"youtube-transcript-{video_id}"
    for c in chunks:
        c.metadata.setdefault("video_id", video_id)

    validated = validate_chunks_for_embeddings(chunks)

    if not validated:
        logger.warning("No valid chunks after validation for video %s — skipping vectorstore creation.", video_id)
        return None

    vector_store = Chroma.from_documents(validated, embeddings, collection_name=collection_name)
    return vector_store


# -------------------------
# Query constructor & SelfQueryRetriever factory
# -------------------------
metadata_field_info = [
    AttributeInfo(
        name="start",
        description="The start time of the video segment in seconds (integer).",
        type="integer",
    ),
    AttributeInfo(
        name="end",
        description="The end time of the video segment in seconds (integer).",
        type="integer",
    ),
    AttributeInfo(
        name="video_id",
        description="The unique YouTube video identifier.",
        type="string",
    ),
]

document_content_description = "Transcript segments from a YouTube video"

query_constructor = load_query_constructor_runnable(
    llm=open_router_model,
    document_contents=document_content_description,
    attribute_info=metadata_field_info,
)


def build_self_query_retriever(vectorstore: Chroma, dynamic_k: int, verbose: bool = False) -> SelfQueryRetriever:
    retriever = SelfQueryRetriever(
        query_constructor=query_constructor,
        vectorstore=vectorstore,
        structured_query_translator=ChromaTranslator(),
        search_kwargs={"k": dynamic_k},
        verbose=verbose,
    )
    return retriever


# -------------------------
# Retrieval cache + locks (session-level)
# -------------------------
retrieval_cache = {}
retrieval_locks = defaultdict(threading.Lock)

# -------------------------
# Chunk quality detector & evidence formatter
# -------------------------
def is_low_quality_text(s: str, min_len: int = 15) -> bool:
    """
    Heuristic to detect low-quality fragments (garbled text).
    - language-agnostic (uses isalpha / isdigit checks)
    - conservative: prefer to keep reasonable content
    """
    if not s:
        return True
    txt = s.strip()
    if len(txt) < min_len:
        return True

    tokens = txt.split()
    if not tokens:
        return True

    # ratio of single-char tokens
    one_char = sum(1 for t in tokens if len(t) == 1)
    if one_char / max(1, len(tokens)) > 0.25:
        return True

    # tokens that lack letters or digits
    non_alnum = sum(1 for t in tokens if not any(ch.isalpha() or ch.isdigit() for ch in t))
    if non_alnum / max(1, len(tokens)) > 0.4:
        return True

    # repeated punctuation sequences
    if re.search(r"[,.\?\!]{3,}", txt):
        return True

    # too many numeric-only tokens
    numeric_tokens = sum(1 for t in tokens if re.fullmatch(r"[\d,.\-]+", t))
    if numeric_tokens / max(1, len(tokens)) > 0.6:
        return True

    return False


def format_evidence(docs: List[Document], filter_low_quality: bool = True) -> Tuple[str, Dict[str, int]]:
    """
    Formats retrieved docs into evidence text for the prompt.
    Returns (evidence_str, stats).
    """
    if not docs:
        return "No transcript evidence found.", {"kept": 0, "dropped": 0}

    kept_lines = []
    dropped = 0
    kept = 0

    for d in docs:
        content = d.page_content.strip().replace("\n", " ")
        if filter_low_quality and is_low_quality_text(content):
            dropped += 1
            continue
        s = int(d.metadata.get("start", 0))
        ts = sec_to_mmss(s)
        quote = content
        if len(quote) > 280:
            quote = quote[:277] + "..."
        kept_lines.append(f"[{ts}] {quote}")
        kept += 1

    if kept == 0:
        return "No good transcript evidence found (most retrieved segments were low-quality).", {"kept": kept, "dropped": dropped}

    return "\n".join(kept_lines), {"kept": kept, "dropped": dropped}


# -------------------------
# RAG & COMPARISON prompts (improved)
# -------------------------
RAG_PROMPT = PromptTemplate(
    template="""
You are a helpful YouTube AI assistant. PRIMARY TASK: answer the USER QUESTION using ONLY the provided VIDEO CONTENT evidence and metadata.

VIDEO CONTENT:
{context}

CHAT HISTORY:
{chat_history}

USER QUESTION:
{question}

INSTRUCTIONS:
- If you include a timestamped quote, append a source link like: Source: https://youtu.be/{video_id}?t={seconds}s
- If transcript evidence is missing for the requested fact, explicitly say "Not found in video transcript or metadata."
- Keep responses brief, factual, and grounded in the evidence or metadata only.
""",
    input_variables=["context", "question", "video_id", "seconds", "chat_history", "video_summary"],
)

COMPARISON_PROMPT = """
You are an expert YouTube comparison analyst. The user asked: {user_question}

Before answering:
- Inspect METADATA_A and METADATA_B and the provided evidence blocks.
- For each video, INFER a short "Channel/Topic focus" from the title + description + channel name (1 short line). If uncertain, say "unknown".
- Use ONLY the provided metadata and evidence. Do NOT use external knowledge.

METADATA_A:
{metadata_a}

METADATA_B:
{metadata_b}

VIDEO A EVIDENCE (top retrieved chunks):
{evidence_a}

VIDEO B EVIDENCE (top retrieved chunks):
{evidence_b}

GUIDELINES:
1) Start with a 1-3 sentence SHORT ANSWER that directly responds to the user's question.
2) If user asked "which is better / which to study / which is more relevant":
   - Provide a DECISION block with:
     - preferred_video: A / B / TIE / INSUFFICIENT_DATA
     - reasons: 3 concise bullets (at least one referencing metadata date or channel)
     - evidence: 2 lines with [mm:ss] short quotes
     - confidence: 0-100
3) If user asked a factual question, answer strictly from evidence and include SOURCES with timestamps.
4) ALWAYS mention missing or noisy transcripts and whether you relied on metadata only.
5) Provide "Channel focus — Video A: ..." and "Channel focus — Video B: ..." near the top.
6) If a video is judged educational (lecture/tutorial), include STUDY_TIPS for that video (4-6 actionable bullets). Otherwise omit study tips.
7) Tie-break rules: evidence presence -> recency (metadata.date) -> channel authority.
8) Do not hallucinate. If requested facts are not in evidence/metadata, say "Not found in video transcript or metadata."

OUTPUT FORMAT:
- Channel focus lines
- SHORT ANSWER (1-3 sentences)
- DECISION (if applicable)
- SOURCES / EVIDENCE
- STUDY_TIPS (if applicable)
Keep responses concise and factual.
"""


# -------------------------
# Dual video summary (keeps sampling logic)
# -------------------------
def get_dual_video_summary(chunks_a, chunks_b, metadata_a: Dict, metadata_b: Dict):
    MAX_CHARS = 500000

    def prepare_text(chunks, label):
        total_text = " ".join([c.page_content for c in chunks])
        if len(total_text) > MAX_CHARS:
            logger.info("%s is massive (%d chars). Using Smart Sampling...", label, len(total_text))
            step = len(total_text) // MAX_CHARS + 1
            sampled_chunks = chunks[::step]
            return " ".join([c.page_content for c in sampled_chunks])
        else:
            logger.info("%s is standard size. Using full transcript...", label)
            return total_text

    text_a = prepare_text(chunks_a, "Video A")
    text_b = prepare_text(chunks_b, "Video B")

    combined_prompt = f"""
You are a professional YouTube learning analyst.

We have TWO videos. Your task:

1) Structured summary of Video A:
   - 4-5 sentence overview
   - Key takeaways (3-6 bullets)
   - Mention main topics and style (tutorial/theory/demo)

2) Structured summary of Video B:
   - 4-5 sentence overview
   - Key takeaways (3-6 bullets)
   - Mention main topics and style

3) Comparative overview:
   - Major topic overlaps
   - Key differences
   - Tell user which is more recent (use metadata) if the vdos is about study or tech or any kind of learning stuff.

In last invite user to ask more questions related to the videos.

METADATA_A:
Title: {metadata_a.get("title")}
Channel: {metadata_a.get("channel")}
Date: {metadata_a.get("date")}

VIDEO A CONTENT:
{text_a}

METADATA_B:
Title: {metadata_b.get("title")}
Channel: {metadata_b.get("channel")}
Date: {metadata_b.get("date")}

VIDEO B CONTENT:
{text_b}
"""
    res = open_router_model.invoke(combined_prompt)
    return res.content


# -------------------------
# Core flows
# -------------------------
def process_and_store_video(video_url_or_id: str, collection_name: Optional[str] = None) -> Dict:
    """
    Process a video: fetch metadata, fetch transcript fragments, chunk, build vectorstore.
    """
    video_id = extract_video_id(video_url_or_id)
    metadata = fetch_video_metadata(video_id)
    chunks, dynamic_k = ingest_video_to_chunks(video_id)
    if not chunks:
        logger.info("No chunks for video %s", video_id)
        return {"video_id": video_id, "metadata": metadata, "chunks": [], "dynamic_k": dynamic_k, "vectorstore": None}
    collection = collection_name or f"youtube-{video_id}"
    vectorstore = create_vectorstore_for_video(video_id, chunks, collection_name=collection)
    return {"video_id": video_id, "metadata": metadata, "chunks": chunks, "dynamic_k": dynamic_k, "vectorstore": vectorstore}


def answer_question_single(video_url_or_id: str, user_question: str, history: Optional[ChatMessageHistory] = None) -> str:
    """
    Ensures video processed, uses SelfQueryRetriever + quality filter, and returns RAG answer (string).
    Falls back to metadata-only honest response if evidence poor.
    """
    if history is None:
        history = ChatMessageHistory()

    processed = process_and_store_video(video_url_or_id)
    video_id = processed["video_id"]
    metadata = processed["metadata"]
    chunks = processed["chunks"]
    dynamic_k = processed["dynamic_k"]
    vectorstore = processed["vectorstore"]

    if not chunks or vectorstore is None:
        return f"Transcript not available for video {video_id}. Please enable captions or provide a transcript."

    retriever = build_self_query_retriever(vectorstore, dynamic_k, verbose=False)
    try:
        retrieved_docs = retriever.get_relevant_documents(user_question)
    except Exception:
        try:
            retrieved_docs = retriever.invoke(user_question)
        except Exception as e:
            logger.exception("SelfQueryRetriever retrieval failed: %s", e)
            return "Error retrieving relevant documents."

    evidence_text, stats = format_evidence(retrieved_docs, filter_low_quality=True)
    logger.info("Evidence kept=%d dropped=%d", stats["kept"], stats["dropped"])

    # If we have no good evidence, fallback to metadata-only prompt
    if stats["kept"] == 0:
        title = metadata.get("title", "Unknown")
        channel = metadata.get("channel", "Unknown")
        date = metadata.get("date", "Unknown")
        desc = metadata.get("description", "")

        fallback_prompt = f"""
You are an assistant. The user asked: "{user_question}"

I attempted to search the video's transcript, but the transcript appears corrupted or missing.
Use ONLY the video metadata below to respond honestly and helpfully. If the metadata does not contain the requested info, say you can't find it in the video.

METADATA:
title: {title}
channel: {channel}
date: {date}
description: {desc}

Task:
- If the user's question is general (e.g., 'what does the video talk about?'), provide a short summary based on metadata (1-3 sentences).
- If the user's question asks for a factual detail not present in metadata (e.g., 'who is Virat Kohli?'), explicitly say: 'Not found in video transcript or metadata.'
- Keep the reply brief and do NOT hallucinate.
"""
        fallback_resp = open_router_model.invoke(fallback_prompt)
        history.add_user_message(user_question)
        history.add_ai_message(fallback_resp.content)
        return fallback_resp.content

    # We have usable evidence -> build context and call RAG
    good_docs = [d for d in retrieved_docs if not is_low_quality_text(d.page_content)]
    context_text = "\n\n".join([f"[{d.metadata['start']}s]: {d.page_content}" for d in good_docs])
    seconds = int(good_docs[0].metadata["start"]) if good_docs else 0

    history_str = "\n".join([f"{m.type}: {m.content}" for m in history.messages[-6:]])

    rag_chain = RAG_PROMPT | open_router_model | StrOutputParser()
    try:
        result = rag_chain.invoke({
            "context": context_text,
            "chat_history": history_str,
            "question": user_question,
            "video_id": video_id,
            "seconds": seconds,
            "video_summary": metadata.get("title", "this video"),
        })
        history.add_user_message(user_question)
        history.add_ai_message(result)
        return result
    except Exception as e:
        logger.exception("RAG generation failed: %s", e)
        return "Error generating an answer."


def get_structured_docs(vectorstore_id: str, retriever, user_query: str, k: int):
    """
    Simple retrieval wrapper using only SelfQueryRetriever.
    Caches per (vectorstore_id, query).
    """
    cache_key = f"{vectorstore_id}__{user_query}"
    if cache_key in retrieval_cache:
        logger.debug("Retrieval cache hit for key=%s", cache_key)
        return retrieval_cache[cache_key][:k]

    lock = retrieval_locks[cache_key]
    acquired = lock.acquire(blocking=False)
    if not acquired:
        # another retrieval in progress for the same key; try quick fallback
        logger.debug("Another retrieval in progress for key=%s; attempting fast fallback", cache_key)
        if cache_key in retrieval_cache:
            return retrieval_cache[cache_key][:k]
        try:
            docs = retriever.get_relevant_documents(user_query)
            # dedupe by (video_id, start)
            seen = set()
            merged = []
            for d in docs:
                key = (d.metadata.get("video_id"), d.metadata.get("start"))
                if key in seen:
                    continue
                seen.add(key)
                merged.append(d)
            retrieval_cache[cache_key] = merged[:k]
            return retrieval_cache[cache_key]
        except Exception as e:
            logger.exception("Fallback retrieval failed: %s", e)
            return []

    try:
        try:
            docs = retriever.get_relevant_documents(user_query)
        except Exception:
            try:
                docs = retriever.invoke(user_query)
            except Exception as e:
                logger.exception("SelfQueryRetriever failed: %s", e)
                docs = []

        # Deduplicate and trim
        final = []
        seen_keys = set()
        for d in docs:
            key = (d.metadata.get("video_id"), int(d.metadata.get("start", 0)))
            if key in seen_keys:
                continue
            seen_keys.add(key)
            final.append(d)
            if len(final) >= k:
                break

        retrieval_cache[cache_key] = final
        logger.debug("Cached retrieval for key=%s -> %d docs", cache_key, len(final))
        return final
    finally:
        lock.release()


def compare_videos(video_a_url_or_id: str, video_b_url_or_id: str, user_question: str, top_k: int = 5, history: Optional[ChatMessageHistory] = None) -> str:
    """
    Compare two videos: process both, retrieve evidence using SelfQueryRetriever,
    pass evidence + metadata to COMPARISON_PROMPT, and return LLM response.
    """
    if history is None:
        history = ChatMessageHistory()

    proc_a = process_and_store_video(video_a_url_or_id, collection_name=f"youtube-{extract_video_id(video_a_url_or_id)}")
    proc_b = process_and_store_video(video_b_url_or_id, collection_name=f"youtube-{extract_video_id(video_b_url_or_id)}")

    meta_a = proc_a["metadata"]
    meta_b = proc_b["metadata"]
    chunks_a = proc_a["chunks"]
    chunks_b = proc_b["chunks"]
    vs_a = proc_a["vectorstore"]
    vs_b = proc_b["vectorstore"]
    k_a = proc_a["dynamic_k"] or 5
    k_b = proc_b["dynamic_k"] or 5

    if (not chunks_a or vs_a is None) and (not chunks_b or vs_b is None):
        return "INSUFFICIENT_DATA: Transcripts missing for both videos. Please provide videos with captions or transcripts."

    retr_a = build_self_query_retriever(vs_a, k_a, verbose=False) if vs_a else None
    retr_b = build_self_query_retriever(vs_b, k_b, verbose=False) if vs_b else None

    vectorstore_id_a = f"youtube-{extract_video_id(video_a_url_or_id)}"
    vectorstore_id_b = f"youtube-{extract_video_id(video_b_url_or_id)}"

    docs_a = get_structured_docs(vectorstore_id_a, retr_a, user_question, top_k)
    docs_b = get_structured_docs(vectorstore_id_b, retr_b, user_question, top_k)

    evidence_a_text, stats_a = format_evidence(docs_a, filter_low_quality=True)
    evidence_b_text, stats_b = format_evidence(docs_b, filter_low_quality=True)

    metadata_a_str = (
        f"video_id: {meta_a.get('video_id')}\n"
        f"title: {meta_a.get('title')}\n"
        f"channel: {meta_a.get('channel')}\n"
        f"date: {meta_a.get('date')}\n"
        f"description: {meta_a.get('description','')[:400]}\n"
        f"(evidence_kept: {stats_a['kept']}, evidence_dropped: {stats_a['dropped']})"
    )
    metadata_b_str = (
        f"video_id: {meta_b.get('video_id')}\n"
        f"title: {meta_b.get('title')}\n"
        f"channel: {meta_b.get('channel')}\n"
        f"date: {meta_b.get('date')}\n"
        f"description: {meta_b.get('description','')[:400]}\n"
        f"(evidence_kept: {stats_b['kept']}, evidence_dropped: {stats_b['dropped']})"
    )

    note = ""
    if stats_a["kept"] == 0 or stats_b["kept"] == 0:
        note = "NOTE: One or both videos have poor-quality transcripts (many segments were dropped). Rely more on metadata.\n\n"

    prompt_text = note + COMPARISON_PROMPT.format(
        user_question=user_question,
        metadata_a=metadata_a_str,
        metadata_b=metadata_b_str,
        evidence_a=evidence_a_text,
        evidence_b=evidence_b_text,
    )

    try:
        res = open_router_model.invoke(prompt_text)
        history.add_user_message(user_question)
        history.add_ai_message(res.content)
        return res.content
    except Exception as e:
        logger.exception("Comparison model invocation failed: %s", e)
        return "Error: comparison model invocation failed."


# -------------------------
# Router / Intent model (LLM-backed, Pydantic)
# -------------------------
class RouterModel(BaseModel):
    route: Literal["SUMMARY", "RAG", "COMPARE", "DUAL_SUMMARY"] = Field(
        description="User intent: SUMMARY, RAG, COMPARE, DUAL_SUMMARY"
    )


def get_intent(user_query: str, history: Optional[ChatMessageHistory] = None, secondary_provided: bool = False) -> str:
    """
    LLM-backed router using PydanticOutputParser. No hardcoded trigger lists.
    """
    if history is None:
        history = ChatMessageHistory()
    recent_history = "\n".join([f"{m.type}: {m.content}" for m in history.messages[-4:]])

    parser = PydanticOutputParser(pydantic_object=RouterModel)
    router_instruction = """
You are an expert query router. Based on the conversation history and the new request,
choose one intent: SUMMARY, RAG, COMPARE, or DUAL_SUMMARY.

- SUMMARY: high-level overview of a single video.
- RAG: specific question / timestamp retrieval about a single video.
- COMPARE: comparison / decision between two videos.
- DUAL_SUMMARY: summarize both videos.

Context:
SECONDARY_PROVIDED: {secondary}
CONVERSATION_HISTORY:
{history}
NEW_REQUEST:
{query}

Return a JSON object matching the schema.
{format_instructions}
"""
    prompt = PromptTemplate(
        template=router_instruction,
        input_variables=["history", "query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    chain = prompt | open_router_model | parser

    try:
        intent_obj = chain.invoke({"history": recent_history, "query": user_query, "secondary": str(secondary_provided)})
        return intent_obj.route
    except Exception as e:
        logger.exception("Router LLM error: %s. Defaulting to RAG.", e)
        return "RAG"


# -------------------------
# Agent orchestrator (two-video MVP)
# -------------------------
def handle_user_query(primary_video_url_or_id: str, secondary_video_url_or_id: str, user_query: str, history: Optional[ChatMessageHistory] = None) -> Dict[str, Union[str, dict]]:
    if history is None:
        history = ChatMessageHistory()

    if not primary_video_url_or_id or not secondary_video_url_or_id:
        return {"intent": "ERROR", "response": "Both primary and secondary video URLs/IDs are required for this MVP.", "meta": {}}

    intent = get_intent(user_query, history=history, secondary_provided=True)
    logger.info("Detected intent: %s", intent)

    if intent == "DUAL_SUMMARY":
        proc_a = process_and_store_video(primary_video_url_or_id, collection_name=f"youtube-{extract_video_id(primary_video_url_or_id)}")
        proc_b = process_and_store_video(secondary_video_url_or_id, collection_name=f"youtube-{extract_video_id(secondary_video_url_or_id)}")
        chunks_a = proc_a["chunks"]
        chunks_b = proc_b["chunks"]
        meta_a = proc_a["metadata"]
        meta_b = proc_b["metadata"]

        if (not chunks_a or proc_a["vectorstore"] is None) and (not chunks_b or proc_b["vectorstore"] is None):
            resp = "INSUFFICIENT_DATA: Transcripts missing for both videos. Cannot summarize."
            history.add_user_message(user_query)
            history.add_ai_message(resp)
            return {"intent": intent, "response": resp, "meta": {}}

        dual_summary = get_dual_video_summary(chunks_a, chunks_b, meta_a, meta_b)
        history.add_user_message(user_query)
        history.add_ai_message(dual_summary)
        return {"intent": intent, "response": dual_summary, "meta": {}}

    if intent == "COMPARE":
        comp_resp = compare_videos(primary_video_url_or_id, secondary_video_url_or_id, user_question=user_query, top_k=5, history=history)
        return {"intent": intent, "response": comp_resp, "meta": {}}

    # RAG path: decide which video to target based on user mentions (generic heuristic) — otherwise default to primary
    q = user_query.lower()
    chosen = primary_video_url_or_id
    if any(tok in q for tok in ["second", "video b", "video 2", "secondary"]):
        chosen = secondary_video_url_or_id

    rag_resp = answer_question_single(chosen, user_query, history=history)
    return {"intent": "RAG", "response": rag_resp, "meta": {}}


# -------------------------
# Chat loop (requires TWO videos)
# -------------------------
def chat_loop():
    print("=== YouTube RAG & Compare Chat (MVP: two videos required) ===")
    while True:
        primary = input("Primary video URL or ID: ").strip()
        if primary:
            break
        print("Primary video is required.")
    while True:
        secondary = input("Secondary video URL or ID (required): ").strip()
        if secondary and secondary != primary:
            break
        if not secondary:
            print("Secondary video is required.")
        else:
            print("Secondary must be different from primary. Please enter another video.")

    print("\nReady. Type your question about both videos. Type 'exit' to quit.")
    history = ChatMessageHistory()
    while True:
        try:
            query = input("\nUser: ").strip()
        except EOFError:
            break
        if not query:
            continue
        if query.lower() in ["exit", "quit"]:
            print("Goodbye.")
            break

        out = handle_user_query(primary, secondary, query, history=history)
        intent = out.get("intent")
        resp = out.get("response")
        print(f"\nAI ({intent}):\n{resp}\n")


if __name__ == "__main__":
    chat_loop()
