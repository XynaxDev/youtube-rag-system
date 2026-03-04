"""
Vector store creation and self-query retriever setup.
"""

import re
import math
import logging
from typing import List, Optional, Dict, Tuple

from langchain_core.documents import Document
from langchain_community.vectorstores import Chroma
from langchain_classic.retrievers.self_query.base import SelfQueryRetriever
from langchain_classic.chains.query_constructor.base import (
    AttributeInfo,
    load_query_constructor_runnable,
)
from langchain_community.query_constructors.chroma import ChromaTranslator

from app.config import open_router_model, CHROMA_PERSIST_DIR
from app.rag.embeddings import embeddings, validate_chunks_for_embeddings
from app.rag.transcript import sec_to_mmss

logger = logging.getLogger(__name__)

# ─── Metadata schema for SelfQueryRetriever ──────────────────
metadata_field_info = [
    AttributeInfo(
        name="start",
        description="The start time of the video segment in seconds (integer). "
        "Rule 1: If user asks for 'at 12:00', use (start <= 720). "
        "Rule 2: If user asks for 'after 12:00', use (start >= 720). "
        "Rule 3: If user asks for '10 min' or '10 minutes', convert to 600 seconds. "
        "Rule 4: ALWAYS convert minutes:seconds to total seconds (min * 60 + sec). "
        "Rule 5: Remove time-related keywords (e.g., '12:00', 'minutes', 'seconds') from the semantic search query part.",
        type="integer",
    ),
    AttributeInfo(
        name="end",
        description="The end time of the video segment in seconds (integer). "
        "Rule 1: If user asks for 'at 12:00', use (end >= 720).",
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


def _resolve_collection_name(video_id: str, collection_name: Optional[str]) -> str:
    return collection_name or f"youtube-transcript-{video_id}"


def create_vectorstore_for_video(
    video_id: str,
    chunks: List[Document],
    collection_name: Optional[str] = None,
) -> Optional[Chroma]:
    """Create a Chroma vector store for a video's transcript chunks."""
    collection_name = _resolve_collection_name(video_id, collection_name)

    # Reuse persisted index if already present.
    existing, existing_docs, _ = load_persisted_video_index(video_id, collection_name)
    if existing is not None and existing_docs:
        logger.info(
            "Reusing persisted vector index for %s (collection=%s, chunks=%d)",
            video_id,
            collection_name,
            len(existing_docs),
        )
        return existing

    for c in chunks:
        c.metadata.setdefault("video_id", video_id)

    validated = validate_chunks_for_embeddings(chunks)
    if not validated:
        logger.warning("No valid chunks after validation for video %s", video_id)
        return None

    return Chroma.from_documents(
        validated,
        embeddings,
        collection_name=collection_name,
        persist_directory=CHROMA_PERSIST_DIR,
    )


def build_self_query_retriever(
    vectorstore: Chroma, dynamic_k: int, verbose: bool = False
) -> SelfQueryRetriever:
    """Build a SelfQueryRetriever for timestamp-aware retrieval."""
    return SelfQueryRetriever(
        query_constructor=query_constructor,
        vectorstore=vectorstore,
        structured_query_translator=ChromaTranslator(),
        search_kwargs={"k": dynamic_k},
        verbose=verbose,
    )


def _dynamic_k_from_count(num_chunks: int) -> int:
    if num_chunks < 20:
        return min(max(1, num_chunks), 5)
    return max(5, min(10, int(math.log2(num_chunks) * 1.5)))


def load_persisted_video_index(
    video_id: str,
    collection_name: Optional[str] = None,
) -> Tuple[Optional[Chroma], List[Document], int]:
    """Load an existing persisted Chroma collection for a video if available."""
    collection_name = _resolve_collection_name(video_id, collection_name)

    try:
        vectorstore = Chroma(
            collection_name=collection_name,
            embedding_function=embeddings,
            persist_directory=CHROMA_PERSIST_DIR,
        )
        count = int(vectorstore._collection.count()) if vectorstore._collection else 0
        if count <= 0:
            return None, [], 5

        raw = vectorstore.get(include=["documents", "metadatas"])
        docs: List[Document] = []
        documents = raw.get("documents") or []
        metadatas = raw.get("metadatas") or []
        for i, text in enumerate(documents):
            if not text:
                continue
            md = dict(metadatas[i] if i < len(metadatas) and metadatas[i] else {})
            md.setdefault("video_id", video_id)
            docs.append(Document(page_content=text, metadata=md))

        if not docs:
            # Keep vectorstore available even if metadata fetch failed.
            return vectorstore, [], _dynamic_k_from_count(count)

        docs.sort(key=lambda d: int((d.metadata or {}).get("start", 0) or 0))
        return vectorstore, docs, _dynamic_k_from_count(len(docs))
    except Exception as e:
        logger.debug("No persisted index available for %s: %s", video_id, e)
        return None, [], 5


def delete_persisted_video_index(
    video_id: str,
    collection_name: Optional[str] = None,
) -> bool:
    """Delete a video's persisted Chroma collection."""
    collection_name = _resolve_collection_name(video_id, collection_name)

    try:
        vectorstore = Chroma(
            collection_name=collection_name,
            embedding_function=embeddings,
            persist_directory=CHROMA_PERSIST_DIR,
        )
        vectorstore.delete_collection()
        logger.info(
            "Deleted persisted vector index for %s (collection=%s)",
            video_id,
            collection_name,
        )
        return True
    except Exception as e:
        logger.debug(
            "Unable to delete persisted vector index for %s (collection=%s): %s",
            video_id,
            collection_name,
            e,
        )
        return False


# ─── Evidence formatting ─────────────────────────────────────
def is_low_quality_text(s: str, min_len: int = 15) -> bool:
    """Heuristic to detect low-quality / garbled transcript fragments."""
    if not s:
        return True
    txt = s.strip()
    if len(txt) < min_len:
        return True
    tokens = txt.split()
    if not tokens:
        return True
    one_char = sum(1 for t in tokens if len(t) == 1)
    if one_char / max(1, len(tokens)) > 0.25:
        return True
    non_alnum = sum(
        1 for t in tokens if not any(ch.isalpha() or ch.isdigit() for ch in t)
    )
    if non_alnum / max(1, len(tokens)) > 0.4:
        return True
    if re.search(r"[,.\?\!]{3,}", txt):
        return True
    numeric_tokens = sum(1 for t in tokens if re.fullmatch(r"[\d,.\-]+", t))
    if numeric_tokens / max(1, len(tokens)) > 0.6:
        return True
    return False


def format_evidence(
    docs: List[Document], filter_low_quality: bool = True
) -> Tuple[str, Dict[str, int]]:
    """Format retrieved docs into evidence text for the LLM prompt."""
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
        quote = content[:277] + "..." if len(content) > 280 else content
        kept_lines.append(f"[{ts}] {quote}")
        kept += 1

    if kept == 0:
        return (
            "No good transcript evidence found (most retrieved segments were low-quality).",
            {"kept": kept, "dropped": dropped},
        )

    return "\n".join(kept_lines), {"kept": kept, "dropped": dropped}
