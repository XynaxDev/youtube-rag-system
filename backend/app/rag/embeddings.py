"""
Safe embedding wrapper and chunk validation logic.
Extracted from singleVideo.py / multiVideo.py.
"""

import math
import time
import unicodedata
import logging
from typing import List

from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document

from app.config import OLLAMA_EMBEDDING_MODEL

logger = logging.getLogger(__name__)


class SafeOllamaEmbeddings(OllamaEmbeddings):
    """
    Wrapper around OllamaEmbeddings that sanitizes NaN/Inf in vectors
    and retries on transient failures.
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
                sanitized.append(fv if math.isfinite(fv) else 0.0)
            except Exception:
                sanitized.append(0.0)
        return sanitized

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        raw = super().embed_documents(texts)
        return [self._sanitize_vector(v) for v in raw]

    def embed_query(self, text: str) -> List[float]:
        last_exception = None
        for attempt in range(2):
            try:
                raw = super().embed_query(text)
                return self._sanitize_vector(raw)
            except Exception as e:
                last_exception = e
                logger.debug("embed_query attempt %d failed: %s", attempt + 1, e)
                time.sleep(0.2 * (attempt + 1))

        if last_exception:
            raise last_exception
        return []


# ─── Global embeddings instance ──────────────────────────────
embeddings = SafeOllamaEmbeddings(model=OLLAMA_EMBEDDING_MODEL)


def validate_chunks_for_embeddings(
    chunks: List[Document],
) -> List[Document]:
    """
    Validates chunks by attempting embeddings, removing garbled text,
    merging failed chunks with neighbors.
    """
    validated_chunks: List[Document] = []

    for chunk in chunks:
        content = (chunk.page_content or "").strip()
        if not content:
            continue

        # Remove control characters (unicode category C)
        content = "".join(ch for ch in content if unicodedata.category(ch)[0] != "C")
        content = " ".join(content.split())
        if len(content) < 15:
            continue

        # Canonical normalize (NFKC)
        content = unicodedata.normalize("NFKC", content)

        # Attempt embedding with retry
        success = False
        for attempt in range(2):
            try:
                vec = embeddings.embed_query(content)
                flat = []

                def _flatten(x):
                    if isinstance(x, (list, tuple)):
                        for el in x:
                            _flatten(el)
                    else:
                        flat.append(float(x))

                _flatten(vec)
                if not flat or len(flat) < 100:
                    raise ValueError("invalid embedding length")
                if any(not math.isfinite(v) for v in flat):
                    raise ValueError("embedding contains NaN/Inf")
                success = True
                break
            except Exception:
                time.sleep(0.15 * (attempt + 1))

        if success:
            validated_chunks.append(
                Document(page_content=content, metadata=chunk.metadata)
            )
        else:
            # Merge with previous validated chunk
            if validated_chunks:
                prev = validated_chunks[-1]
                merged = prev.page_content + " " + content
                validated_chunks[-1] = Document(
                    page_content=merged, metadata=prev.metadata
                )

    logger.info(
        "Validated %d/%d chunks for embedding",
        len(validated_chunks),
        max(1, len(chunks)),
    )
    return validated_chunks
