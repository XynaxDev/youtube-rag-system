"""Helper utilities for retrieval ranking and timestamp grounding."""

import math
import re
from difflib import SequenceMatcher
from typing import Optional


def extract_time_seconds(query: str) -> Optional[int]:
    """Parse explicit time mentions like 10:30, 10 min, 10mins, 630s."""
    if not query:
        return None
    q = query.lower()
    mmss = re.search(r"\b(\d{1,2}):(\d{2})\b", q)
    if mmss:
        return int(mmss.group(1)) * 60 + int(mmss.group(2))

    mins = re.search(r"\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b", q)
    if mins:
        return int(mins.group(1)) * 60

    secs = re.search(r"\b(\d{1,5})\s*[-]?\s*(?:s|sec|secs|second|seconds)\b", q)
    if secs:
        return int(secs.group(1))

    return None


def strip_time_phrases(query: str) -> str:
    """Remove explicit time phrases so semantic retrieval focuses on topic words."""
    if not query:
        return ""
    cleaned = query.lower()
    cleaned = re.sub(r"\b\d{1,2}:\d{2}\b", " ", cleaned)
    cleaned = re.sub(r"\b\d{1,3}\s*[-]?\s*(?:min|mins|minute|minutes)\b", " ", cleaned)
    cleaned = re.sub(r"\b\d{1,5}\s*[-]?\s*(?:s|sec|secs|second|seconds)\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def fetch_time_window_docs(vectorstore, base_query: str, sec: int, k: int):
    """Try multiple metadata filter shapes for Chroma compatibility."""
    attempts = [
        {"$and": [{"start": {"$lte": sec}}, {"end": {"$gte": sec}}]},
        {"start": {"$lte": sec}, "end": {"$gte": sec}},
    ]
    for where in attempts:
        try:
            docs = vectorstore.similarity_search(base_query, k=k, filter=where)
            if docs:
                return docs
        except Exception:
            continue
    return []


def doc_timestamp_candidates(doc) -> list[int]:
    """Collect candidate timestamps for a chunk from metadata and embedded labels."""
    candidates: list[int] = []

    start = doc.metadata.get("start")
    if isinstance(start, (int, float)):
        candidates.append(int(start))

    for m in re.finditer(r"\[Timestamp:\s*(\d+)\s*s\]", doc.page_content or "", flags=re.IGNORECASE):
        try:
            candidates.append(int(m.group(1)))
        except Exception:
            continue

    seen = set()
    deduped = []
    for ts in candidates:
        if ts in seen:
            continue
        seen.add(ts)
        deduped.append(ts)

    return deduped


def _doc_identity(doc) -> tuple[int, int, str]:
    return (
        int(doc.metadata.get("start", 0)),
        int(doc.metadata.get("end", 0)),
        (doc.page_content or "")[:160],
    )


def merge_unique_docs(*doc_lists):
    """Merge multiple document lists while preserving first-seen order."""
    merged = []
    seen = set()
    for docs in doc_lists:
        if not docs:
            continue
        for d in docs:
            key = _doc_identity(d)
            if key in seen:
                continue
            seen.add(key)
            merged.append(d)
    return merged


def expand_with_temporal_neighbors(seed_docs, all_chunks, radius: int = 1, max_docs: int = 24):
    """Expand seed docs with nearby transcript chunks by timeline position."""
    if not seed_docs or not all_chunks:
        return []

    ordered_chunks = sorted(
        all_chunks,
        key=lambda d: (
            int(d.metadata.get("start", 0)),
            int(d.metadata.get("end", 0)),
        ),
    )

    index_map = {_doc_identity(d): idx for idx, d in enumerate(ordered_chunks)}
    neighbor_indexes = set()

    for d in seed_docs:
        idx = index_map.get(_doc_identity(d))
        if idx is None:
            continue
        start_idx = max(0, idx - radius)
        end_idx = min(len(ordered_chunks) - 1, idx + radius)
        for i in range(start_idx, end_idx + 1):
            neighbor_indexes.add(i)

    expanded = [ordered_chunks[i] for i in sorted(neighbor_indexes)]
    return expanded[:max_docs]


def pick_closest_timestamp(target: int, docs) -> Optional[int]:
    """Pick the closest available timestamp across candidate docs."""
    pool: list[int] = []
    for d in docs:
        pool.extend(doc_timestamp_candidates(d))
    if not pool:
        return None
    return min(pool, key=lambda ts: abs(ts - target))


def _extract_number_tokens(text: str) -> set[str]:
    return set(re.findall(r"\b\d+\b", text or ""))


def _extract_key_phrases(text: str) -> list[str]:
    if not text:
        return []
    phrases: list[str] = []
    seen = set()
    for phrase in re.findall(r"[\"“”']([^\"“”']{3,80})[\"“”']", text):
        p = " ".join(phrase.split()).strip()
        if len(p.split()) >= 2:
            k = p.casefold()
            if k not in seen:
                seen.add(k)
                phrases.append(p)
    for phrase in re.findall(r"\b(?:[A-Z][\w'-]+\s+){1,3}[A-Z][\w'-]+\b", text):
        p = " ".join(phrase.split()).strip()
        if len(p.split()) >= 2:
            k = p.casefold()
            if k not in seen:
                seen.add(k)
                phrases.append(p)
    return phrases


def _tokenize_for_matching(text: str) -> list[str]:
    if not text:
        return []
    raw_tokens = re.findall(r"\w+", text.casefold(), flags=re.UNICODE)
    deduped: list[str] = []
    seen = set()
    for tok in raw_tokens:
        if tok.isdigit():
            continue
        if len(tok) == 1 and tok.isascii():
            continue
        if tok in seen:
            continue
        seen.add(tok)
        deduped.append(tok)
    return deduped


def _collect_overlap_tokens(query_tokens: list[str], token_set: set[str]) -> list[str]:
    if not query_tokens or not token_set:
        return []
    overlap: list[str] = []
    candidates = list(token_set)
    for tok in query_tokens:
        if tok in token_set:
            overlap.append(tok)
            continue
        if len(tok) < 3:
            continue
        prefix = tok[:3]
        for cand in candidates:
            if len(cand) < 3:
                continue
            # Handle clipped forms like "prep" -> "preparing" without hardcoded vocab.
            if len(tok) <= 4 and cand.startswith(tok) and len(cand) >= len(tok) + 2:
                overlap.append(tok)
                break
            if len(cand) <= 4 and tok.startswith(cand) and len(tok) >= len(cand) + 2:
                overlap.append(tok)
                break
            if abs(len(cand) - len(tok)) > 7:
                continue
            if prefix != cand[:3]:
                continue
            ratio = SequenceMatcher(None, tok, cand).ratio()
            if ratio >= 0.68:
                overlap.append(tok)
                break
    return overlap


def pick_evidence_timestamp_for_answer(
    question: str,
    answer: str,
    docs,
    fallback_timestamp: int,
) -> int:
    """Pick timestamp from the doc that best supports the generated answer."""
    if not docs:
        return int(fallback_timestamp)
    q_tokens = _tokenize_for_matching(question)
    a_tokens = _tokenize_for_matching(answer)
    q_nums = _extract_number_tokens(question)
    a_nums = _extract_number_tokens(answer)
    key_phrases = _extract_key_phrases(question) + _extract_key_phrases(answer)
    all_tokens = []
    seen_all = set()
    for tok in q_tokens + a_tokens:
        if tok in seen_all:
            continue
        seen_all.add(tok)
        all_tokens.append(tok)

    total_docs = max(1, len(docs))
    doc_freq = {tok: 0 for tok in all_tokens}
    doc_token_sets = []
    for d in docs:
        token_set = set(_tokenize_for_matching(d.page_content or ""))
        doc_token_sets.append(token_set)
        for tok in all_tokens:
            if tok in token_set:
                doc_freq[tok] += 1

    weights = {}
    for tok, freq in doc_freq.items():
        if freq <= 0:
            continue
        idf = math.log((1 + total_docs) / (1 + freq)) + 1.0
        weights[tok] = idf * (1.0 + min(len(tok), 12) * 0.03)

    best_doc = None
    best_key = None
    for idx, d in enumerate(docs):
        content = d.page_content or ""
        content_cf = content.casefold()
        token_set = doc_token_sets[idx]
        if not token_set:
            continue
        doc_nums = _extract_number_tokens(content)
        q_overlap = _collect_overlap_tokens(q_tokens, token_set)
        a_overlap = _collect_overlap_tokens(a_tokens, token_set)
        q_weight = sum(weights.get(tok, 0.0) for tok in q_overlap)
        a_weight = sum(weights.get(tok, 0.0) for tok in a_overlap)
        phrase_hits = sum(1 for p in key_phrases if p and p.casefold() in content_cf)

        num_overlap_answer = len(a_nums & doc_nums)
        num_overlap_query = len(q_nums & doc_nums)
        start = int(d.metadata.get("start", 0))
        proximity = -abs(start - int(fallback_timestamp))
        score = (
            num_overlap_answer * 8.0
            + num_overlap_query * 5.0
            + a_weight * 2.0
            + q_weight * 1.3
            + phrase_hits * 6.0
        )
        tie_break = -start
        key = (
            score,
            phrase_hits,
            num_overlap_answer + num_overlap_query,
            a_weight + q_weight,
            proximity,
            tie_break,
            -idx,
        )

        if best_key is None or key > best_key:
            best_key = key
            best_doc = d

    if best_doc is None:
        return int(fallback_timestamp)
    candidates = doc_timestamp_candidates(best_doc)
    if candidates:
        return int(candidates[0])
    return int(best_doc.metadata.get("start", fallback_timestamp))


def build_focus_query(chunks, query: str, max_terms: int = 8) -> str:
    """Build a compact, transcript-adaptive semantic query from the user's message."""
    query_tokens = _tokenize_for_matching(query)
    if not query_tokens:
        return query.strip()

    total_docs = max(1, len(chunks))
    doc_freq = {tok: 0 for tok in query_tokens}
    for d in chunks:
        token_set = set(_tokenize_for_matching(d.page_content or ""))
        for tok in query_tokens:
            if tok in token_set:
                doc_freq[tok] += 1

    scored = []
    for idx, tok in enumerate(query_tokens):
        freq = doc_freq.get(tok, 0)
        if freq > 0:
            idf = math.log((1 + total_docs) / (1 + freq)) + 1.0
            score = idf + min(len(tok), 12) * 0.05
        else:
            if len(tok) < 6:
                continue
            score = 2.0 + min(len(tok), 12) * 0.04
        scored.append((score, -idx, tok))
    if not scored:
        return query.strip()

    scored.sort(reverse=True)
    top_tokens = [tok for _, _, tok in scored[:max_terms]]
    return " ".join(top_tokens).strip() or query.strip()


def keyword_match_docs(chunks, query: str, max_docs: int = 4):
    """Transcript-adaptive lexical fallback without language-specific stopwords."""
    query_tokens = _tokenize_for_matching(query)
    if not query_tokens:
        return []
    query_set = set(query_tokens)
    if not query_set:
        return []

    total_docs = max(1, len(chunks))
    doc_freq = {tok: 0 for tok in query_tokens}
    chunk_tokens: list[set[str]] = []
    for d in chunks:
        token_set = set(_tokenize_for_matching(d.page_content or ""))
        chunk_tokens.append(token_set)
        for tok in query_set & token_set:
            doc_freq[tok] += 1

    max_freq = max(1, int(total_docs * 0.6))
    weights = {
        tok: (math.log((1 + total_docs) / (1 + freq)) + 1.0)
        for tok, freq in doc_freq.items()
        if 0 < freq <= max_freq
    }
    if not weights:
        return []

    scored = []
    for d, token_set in zip(chunks, chunk_tokens):
        if not token_set:
            continue
        overlap = [tok for tok in _collect_overlap_tokens(query_tokens, token_set) if tok in weights]
        if not overlap:
            continue
        score = sum(weights[tok] for tok in overlap)
        coverage = len(overlap)
        start = int(d.metadata.get("start", 0))
        scored.append((score, coverage, -start, d))
    if not scored:
        return []

    scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    return [item[3] for item in scored[:max_docs]]


def rank_docs_for_query(docs, query: str, max_docs: int = 8):
    """Rank a candidate doc set against the query using transcript-adaptive token overlap."""
    if not docs:
        return []
    query_tokens = _tokenize_for_matching(query)
    if not query_tokens:
        return docs[:max_docs]

    query_set = set(query_tokens)
    total_docs = max(1, len(docs))
    doc_freq = {tok: 0 for tok in query_tokens}
    token_sets: list[set[str]] = []
    for d in docs:
        token_set = set(_tokenize_for_matching(d.page_content or ""))
        token_sets.append(token_set)
        for tok in query_set & token_set:
            doc_freq[tok] += 1

    max_freq = max(1, int(total_docs * 0.6))
    weights = {
        tok: (math.log((1 + total_docs) / (1 + freq)) + 1.0)
        for tok, freq in doc_freq.items()
        if 0 < freq <= max_freq
    }
    if not weights:
        return docs[:max_docs]

    scored = []
    for d, token_set in zip(docs, token_sets):
        overlap = [tok for tok in _collect_overlap_tokens(query_tokens, token_set) if tok in weights]
        if not overlap:
            continue
        score = sum(weights[tok] for tok in overlap)
        coverage = len(overlap)
        start = int(d.metadata.get("start", 0))
        scored.append((score, coverage, -start, d))
    if not scored:
        return docs[:max_docs]

    scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    return [item[3] for item in scored[:max_docs]]
