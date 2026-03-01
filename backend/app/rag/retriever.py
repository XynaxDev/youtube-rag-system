"""
Vector store creation and self-query retriever setup.
Extracted from singleVideo.py / multiVideo.py.
"""

import re
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

from app.config import open_router_model
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
        "Rule 3: ALWAYS convert minutes:seconds to total seconds (min * 60 + sec). "
        "Rule 4: Remove time-related keywords (e.g., '12:00', 'minutes', 'seconds') from the semantic search query part.",
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


def create_vectorstore_for_video(
    video_id: str,
    chunks: List[Document],
    collection_name: Optional[str] = None,
) -> Optional[Chroma]:
    """Create a Chroma vector store for a video's transcript chunks."""
    if collection_name is None:
        collection_name = f"youtube-transcript-{video_id}"

    for c in chunks:
        c.metadata.setdefault("video_id", video_id)

    validated = validate_chunks_for_embeddings(chunks)
    if not validated:
        logger.warning("No valid chunks after validation for video %s", video_id)
        return None

    return Chroma.from_documents(validated, embeddings, collection_name=collection_name)


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
