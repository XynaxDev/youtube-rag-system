"""Multi-video comparison pipeline helpers."""

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from app.config import open_router_model
from app.rag.retriever import (
    build_self_query_retriever,
    is_low_quality_text,
)
from app.rag.retrieval_helpers import (
    build_focus_query,
    expand_with_temporal_neighbors,
    keyword_match_docs,
    merge_unique_docs,
    pick_evidence_timestamp_for_answer,
    rank_docs_for_query,
    strip_time_phrases,
)

logger = logging.getLogger(__name__)

STRICT_STUDY_MODE_DIRECTIVE = """
STRICT STUDY MODE ENABLED:
- Use an industry-grade technical analysis style.
- Prioritize concept depth, architecture/process reasoning, trade-offs, and practical implications.
- Use clear markdown sections and concise technical language.
- For regular factual/explanatory questions, answer directly with concise evidence-grounded points.
- Provide recommendation/study-plan format only when the user explicitly asks for recommendation, roadmap, or study plan.
- Do not output fluff or generic motivation language.
"""

COMPARISON_PROMPT = """
You are ClipIQ's senior multi-video analyst.
The user asked: {user_question}

Use only the provided metadata and transcript evidence. Do not use external knowledge.

METADATA_A:
{metadata_a}

METADATA_B:
{metadata_b}

VIDEO A EVIDENCE:
{evidence_a}

VIDEO B EVIDENCE:
{evidence_b}

MODE DIRECTIVE:
{mode_directive}

Rules:
1) Write clean markdown that is easy to scan.
2) Start with:
## Dual Video Summary
3) Then include:
## Video A Snapshot
## Video B Snapshot
## Cross-Video Verdict
4) If learning-context recommendation is enabled, include:
## Recommendation
with chosen video and concise reasons.
5) If study guidance is enabled, include:
## Study Plan
with 4-6 actionable bullets.
6) For non-learning/entertainment context, DO NOT provide study plan and DO NOT provide learning recommendation.
7) Use inline timestamp links for concrete claims whenever available in this exact format:
   [m:ss](https://youtu.be/<video_id>?t=<seconds>s)
8) If information is missing, state: Not found in video transcript or metadata.
9) Keep concise but complete.
"""

DUAL_CHAT_PROMPT = """
You are a dual-video RAG assistant.
The user asked a specific question: {user_question}

METADATA_A:
{metadata_a}

METADATA_B:
{metadata_b}

VIDEO A EVIDENCE:
{evidence_a}

VIDEO B EVIDENCE:
{evidence_b}

MODE DIRECTIVE:
{mode_directive}

QUERY SCOPE:
{query_scope}

QUERY KIND:
{query_kind}

Rules:
1) Answer the specific question directly based ONLY on the evidence provided above. Do NOT write a generic summary or snapshot.
2) Use clean, easy-to-read markdown.
2.1) Never use section headers like "Dual Video Summary", "Video A Snapshot", "Video B Snapshot", or "Cross-Video Verdict".
2.2) Do not output labels like "Technical Verdict" unless the user explicitly asks for a verdict.
3) When query_scope is VIDEO_A_ONLY, answer only from Video A evidence.
4) When query_scope is VIDEO_B_ONLY, answer only from Video B evidence.
5) If the user asks for recommendation/which video to watch/study plan/future-learning guidance:
   - Do NOT return two equal blocks.
   - Return this decision-first structure:
     **Best Video To Watch First:** <Video A or Video B>
     **Why this choice:** 2-4 concise bullets with evidence.
     **Study Plan:** 4-6 actionable bullets.
     **Focus Moments:** 3-6 timestamp links from the most relevant moments.
   - If both are equally useful, say so explicitly and provide a split plan.
6) If query_scope is BOTH and the user is asking a normal factual comparison, you may use two short blocks in this exact order:
   **Video A [{title_a}]**
   **Video B [{title_b}]**
7) For each grounded claim, use one inline timestamp link in this exact format:
   [m:ss](https://youtu.be/<video_id>?t=<seconds>s)
   Never output plain [m:ss] without a link.
7.1) Place timestamp links at the end of the sentence they support.
8) Keep timestamp links only where they add value; avoid timestamp spam.
8.1) For questions like "Why was Video A better?" or "Which was better?", never say you lack Video A/Video B context; compare both videos using available evidence and provide a verdict.
8.2) For VIDEO_A_ONLY/VIDEO_B_ONLY answers, include at least one timestamp link when information is found.
9) If information is missing in a requested video, explicitly say:
   "That is not discussed here in this video."
   Then add one short suggestion grounded in metadata/title.
9.1) If information is missing/not discussed, do NOT include timestamps.
10) For non-comparison questions, format as:
    **Answer:** <2-4 concise lines>
    Then up to 3 short bullet points for support.
10.1) If query_kind is FOCUSED_INFO, keep answer specific and concrete:
      - include named entities (people/org/product) when available,
      - include "what is being built" and "who is building it" if asked,
      - avoid generic definitions unless asked.
10.2) If query_kind is COMMON:
      - Output this structure:
        **Common Themes:**
        - <theme sentence with inline timestamp links at sentence end>
      - Keep 3-5 concise bullets.
      - Use evidence from BOTH videos when available.
      - Prefer pairing one Video A and one Video B timestamp across the bullet list.
11) Be conversational but factual and concise.
"""

INTENT_PROMPT = """
You are classifying whether a dual-video request is in a learning/study context.

USER QUESTION:
{question}

VIDEO A METADATA:
{meta_a}

VIDEO B METADATA:
{meta_b}

VIDEO A EVIDENCE PREVIEW:
{evidence_a}

VIDEO B EVIDENCE PREVIEW:
{evidence_b}

Return structured output only.
is_learning_context=true only when user intent or content context is clearly educational/technical/tutorial/lecture/study-oriented.
For entertainment/interview/game-show/general chat context, return false.
{format_instructions}
"""


class CompareIntent(BaseModel):
    is_learning_context: bool = Field(
        description="Whether this compare request is truly in learning/study context."
    )
    reason: str = Field(description="Short reasoning for the classification.")


def _detect_query_scope(question: str) -> str:
    q = (question or "").lower()
    mentions_a = bool(
        re.search(
            r"\bvideo\s*a\b|\bvdo\s*a\b|\bstream\s*a\b|first\s+video|1st\s+video", q
        )
    )
    mentions_b = bool(
        re.search(
            r"\bvideo\s*b\b|\bvdo\s*b\b|\bstream\s*b\b|second\s+video|2nd\s+video", q
        )
    )
    comparative_intent = bool(
        re.search(
            r"\b(compare|comparison|better|best|worse|vs|versus|difference|different|which\s+video|which\s+one|unified\s+verdict|cross[-\s]?video)\b",
            q,
        )
    )
    # Literal scope should win over comparative wording.
    if mentions_a and mentions_b:
        return "BOTH"
    if mentions_a:
        return "VIDEO_A_ONLY"
    if mentions_b:
        return "VIDEO_B_ONLY"
    if comparative_intent:
        return "BOTH"
    return "BOTH"


def _is_comparative_question(question: str) -> bool:
    q = (question or "").lower()
    return bool(
        re.search(
            r"\b(compare|comparison|better|best|worse|vs|versus|difference|different|which\s+video|which\s+one|unified\s+verdict|cross[-\s]?video)\b",
            q,
        )
    )


def _is_focused_info_question(question: str) -> bool:
    q = (question or "").lower()
    if _is_comparative_question(q):
        return False
    return bool(
        re.search(
            r"\b(what|who|where|when|how|explain|talking about|discuss|creating|built|building|emotional intelligence|generative|ai)\b",
            q,
        )
    )


def _is_common_theme_question(question: str) -> bool:
    q = (question or "").lower()
    return bool(
        re.search(
            r"\b(common|shared|similarit(?:y|ies)|overlap|both\s+videos|in\s+both|what\s+is\s+common|things\s+discussed\s+in\s+both)\b",
            q,
        )
    )


def _tokenize_for_side_scoring(text: str) -> List[str]:
    if not text:
        return []
    tokens = re.findall(r"\w+", text.casefold(), flags=re.UNICODE)
    return [tok for tok in tokens if len(tok) > 1 and not tok.isdigit()]


def _side_relevance_score(
    question: str,
    docs: List[Any],
    meta: Dict[str, Any],
) -> float:
    tokens = _tokenize_for_side_scoring(question)
    if not tokens:
        return 0.0

    score = 0.0
    meta_blob = (
        f"{meta.get('title', '')} "
        f"{meta.get('description', '')} "
        f"{meta.get('channel', '')}"
    ).casefold()
    score += 1.2 * sum(1 for tok in tokens if tok in meta_blob)

    for idx, doc in enumerate(docs[:6]):
        content = (doc.page_content or "").casefold()
        overlap = sum(1 for tok in tokens if tok in content)
        score += overlap / (idx + 1)

    return score


def _infer_primary_side_for_question(
    question: str,
    docs_a: List[Any],
    docs_b: List[Any],
    meta_a: Dict[str, Any],
    meta_b: Dict[str, Any],
) -> Optional[str]:
    if docs_a and not docs_b:
        return "A"
    if docs_b and not docs_a:
        return "B"
    if not docs_a and not docs_b:
        return None

    score_a = _side_relevance_score(question, docs_a, meta_a)
    score_b = _side_relevance_score(question, docs_b, meta_b)

    if score_a >= score_b * 1.12 and (score_a - score_b) >= 0.8:
        return "A"
    if score_b >= score_a * 1.12 and (score_b - score_a) >= 0.8:
        return "B"
    return None


def _suggestion_from_meta(meta: Dict[str, Any]) -> str:
    title = str(meta.get("title") or "this video").strip()
    short_title = title[:80].rstrip()
    if short_title:
        return f"You can ask about {short_title}."
    return "You can ask about the main discussion in this video."


def _not_discussed_message(meta: Dict[str, Any]) -> str:
    return f"That is not discussed here in this video. {_suggestion_from_meta(meta)}"


def _metadata_block(meta: Dict[str, Any], stats: Dict[str, int]) -> str:
    return (
        f"video_id: {meta.get('video_id')}\n"
        f"title: {meta.get('title')}\n"
        f"channel: {meta.get('channel')}\n"
        f"date: {meta.get('date')}\n"
        f"description: {str(meta.get('description', ''))[:450]}\n"
        f"evidence_kept: {stats.get('kept', 0)}\n"
        f"evidence_dropped: {stats.get('dropped', 0)}"
    )


def _sec_to_mmss(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def _format_evidence_with_links(docs, fallback_video_id: str):
    """Format evidence and include clickable timestamp links."""
    if not docs:
        return "No transcript evidence found.", {"kept": 0, "dropped": 0}, []

    kept = 0
    dropped = 0
    lines: List[str] = []
    link_refs: List[Dict[str, str]] = []

    for d in docs:
        content = (d.page_content or "").strip().replace("\n", " ")
        if is_low_quality_text(content):
            dropped += 1
            continue

        start = int(d.metadata.get("start", 0))
        ts = _sec_to_mmss(start)
        video_id = str(d.metadata.get("video_id") or fallback_video_id or "")
        if not video_id:
            continue
        link = f"https://youtu.be/{video_id}?t={start}s"
        quote = content[:220] + "..." if len(content) > 220 else content
        lines.append(f"- [{ts}]({link}) {quote}")
        link_refs.append({"ts": ts, "link": link, "quote": quote})
        kept += 1

    if kept == 0:
        return (
            "No good transcript evidence found (most retrieved segments were low-quality).",
            {"kept": 0, "dropped": dropped},
            [],
        )

    return "\n".join(lines), {"kept": kept, "dropped": dropped}, link_refs


def _classify_compare_intent(
    question: str,
    meta_a: Dict[str, Any],
    meta_b: Dict[str, Any],
    evidence_a_preview: str,
    evidence_b_preview: str,
) -> CompareIntent:
    parser = PydanticOutputParser(pydantic_object=CompareIntent)
    prompt = PromptTemplate(
        template=INTENT_PROMPT,
        input_variables=["question", "meta_a", "meta_b", "evidence_a", "evidence_b"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    chain = prompt | open_router_model | parser
    try:
        return chain.invoke(
            {
                "question": question,
                "meta_a": str(meta_a)[:1000],
                "meta_b": str(meta_b)[:1000],
                "evidence_a": evidence_a_preview[:1200],
                "evidence_b": evidence_b_preview[:1200],
            }
        )
    except Exception as e:
        logger.exception("Multi-video intent classification failed: %s", e)
        # Safe fallback: no learning-mode assumptions.
        return CompareIntent(is_learning_context=False, reason="fallback")


def _build_evidence_links_section(
    refs_a: List[Dict[str, str]],
    refs_b: List[Dict[str, str]],
) -> str:
    lines: List[str] = ["## Evidence Links"]
    if refs_a:
        lines.append("### Video A")
        for item in refs_a[:4]:
            lines.append(f"- [{item['ts']}]({item['link']})")
    if refs_b:
        lines.append("### Video B")
        for item in refs_b[:4]:
            lines.append(f"- [{item['ts']}]({item['link']})")
    return "\n".join(lines)


def _has_timestamp_link(text: str) -> bool:
    if not text:
        return False
    return bool(
        re.search(
            r"\[\d{1,2}:[0-5]\d\]\(https?://youtu\.be/[^)\s]+\)",
            text,
            flags=re.IGNORECASE,
        )
    )


def _build_grounded_timestamp_link(
    question: str,
    answer: str,
    docs: List[Any],
    video_id: str,
) -> Optional[str]:
    if not docs:
        return None

    resolved_video_id = str(video_id or "").strip()
    if not resolved_video_id:
        for d in docs:
            meta_video_id = str((d.metadata or {}).get("video_id") or "").strip()
            if meta_video_id:
                resolved_video_id = meta_video_id
                break
    if not resolved_video_id:
        return None

    fallback = 0
    for d in docs:
        try:
            fallback = int((d.metadata or {}).get("start", 0) or 0)
            break
        except Exception:
            continue

    sec = int(
        pick_evidence_timestamp_for_answer(
            question=question,
            answer=answer,
            docs=docs,
            fallback_timestamp=fallback,
        )
    )
    ts = _sec_to_mmss(sec)
    return f"[{ts}](https://youtu.be/{resolved_video_id}?t={sec}s)"


def _append_inline_timestamp(text: str, timestamp_link: str) -> str:
    if not text or not timestamp_link:
        return text

    lines = text.splitlines()
    for idx, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^\*\*Source:\*\*", line, flags=re.IGNORECASE):
            continue
        if re.match(r"^#{1,6}\s", line):
            continue
        if re.match(r"^[-*]\s", line):
            continue
        if timestamp_link in line:
            return text
        lines[idx] = f"{raw.rstrip()} {timestamp_link}"
        return "\n".join(lines).strip()

    return f"{text.rstrip()} {timestamp_link}".strip()


def _strip_timestamp_links(text: str) -> str:
    if not text:
        return text
    cleaned = re.sub(r"\s*\[\d{1,2}:[0-5]\d\]\(\s*https?://youtu\.be/[^)\s]+\s*\)", "", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def _looks_not_found_response(text: str) -> bool:
    if not text:
        return False
    lowered = text.lower()
    markers = [
        "that is not discussed here in this video",
        "not discussed",
        "not directly addressed",
        "not covered",
        "not mentioned",
        "not found in video transcript",
    ]
    return any(marker in lowered for marker in markers)


def _dedupe_timestamp_links(text: str) -> str:
    """Keep the first occurrence of each exact timestamp URL and drop duplicates."""
    if not text:
        return text

    pattern = re.compile(r"\[(\d{1,2}:[0-5]\d)\]\(\s*(https?://youtu\.be/[^)\s]+)\s*\)")
    seen_urls = set()
    out: List[str] = []
    last_idx = 0

    for m in pattern.finditer(text):
        start, end = m.span()
        label = m.group(1)
        url = m.group(2).strip()
        out.append(text[last_idx:start])
        if url not in seen_urls:
            out.append(f"[{label}]({url})")
            seen_urls.add(url)
        last_idx = end

    out.append(text[last_idx:])
    cleaned = "".join(out)
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _append_dual_common_links(
    text: str,
    link_a: Optional[str],
    link_b: Optional[str],
) -> str:
    links = [lnk for lnk in [link_a, link_b] if lnk]
    if not text or not links:
        return text

    lines = text.splitlines()
    for idx, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^#{1,6}\s", line):
            continue
        if re.match(r"^\*\*Common Themes:\*\*\s*$", line, flags=re.IGNORECASE):
            continue
        if re.match(r"^[-*]\s", line):
            # Put links at the end of the first bullet sentence.
            line_text = raw.rstrip()
            for lnk in links:
                if lnk not in line_text:
                    line_text = f"{line_text} {lnk}"
            lines[idx] = line_text
            return "\n".join(lines).strip()

        line_text = raw.rstrip()
        for lnk in links:
            if lnk not in line_text:
                line_text = f"{line_text} {lnk}"
        lines[idx] = line_text
        return "\n".join(lines).strip()

    return f"{text.rstrip()} {' '.join(links)}".strip()


def _is_explicit_scope_request(question: str, query_scope: str) -> bool:
    q = (question or "").lower()
    if query_scope == "VIDEO_A_ONLY":
        return bool(
            re.search(
                r"\bvideo\s*a\b|\bvdo\s*a\b|\bstream\s*a\b|first\s+video|1st\s+video",
                q,
            )
        )
    if query_scope == "VIDEO_B_ONLY":
        return bool(
            re.search(
                r"\bvideo\s*b\b|\bvdo\s*b\b|\bstream\s*b\b|second\s+video|2nd\s+video",
                q,
            )
        )
    return False


def _with_scope_source_header(text: str, query_scope: str, question: str) -> str:
    if query_scope == "VIDEO_A_ONLY":
        header = "**Source:** Discussed in Video A."
    elif query_scope == "VIDEO_B_ONLY":
        header = "**Source:** Discussed in Video B."
    else:
        return text

    # If the user already asked explicitly for Video A/Video B, avoid redundant source header.
    if _is_explicit_scope_request(question, query_scope):
        return text

    stripped = (text or "").strip()
    if not stripped:
        return header
    if re.match(r"(?is)^\s*\*\*source:\*\*", stripped):
        return stripped
    return f"{header}\n\n{stripped}"


def _strip_source_header(text: str) -> str:
    if not text:
        return text
    cleaned = re.sub(
        r"(?im)^\s*(?:\*\*)?source(?:\*\*)?\s*:\s*discussed\s+in\s+video\s+[ab]\.?\s*$",
        "",
        text,
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _ensure_answer_prefix(text: str) -> str:
    if not text:
        return "Answer: "
    stripped = text.strip()
    if re.match(r"(?is)^\s*(?:\*\*)?answer(?:\*\*)?\s*:", stripped):
        return stripped
    return f"Answer: {stripped}"


def _remove_opposite_scope_section(text: str, query_scope: str) -> str:
    if not text:
        return text
    if query_scope == "VIDEO_A_ONLY":
        return re.sub(r"(?is)\n*\*\*Video B[^\n]*\*\*.*$", "", text).strip()
    if query_scope == "VIDEO_B_ONLY":
        return re.sub(r"(?is)\n*\*\*Video A[^\n]*\*\*.*$", "", text).strip()
    return text


def _collect_validation_docs(proc: Dict[str, Any], meta: Dict[str, Any]):
    """Collect broader evidence for study-mode validation to reduce false negatives."""
    broad_query = (
        f"{meta.get('title', '')} {meta.get('description', '')} "
        "main discussion process reasoning methodology constraints timeline"
    ).strip()
    docs_primary = _retrieve_docs_for_video(
        proc, "technical analytical educational tutorial process explanation"
    )
    docs_broad = _retrieve_docs_for_video(proc, broad_query)
    return merge_unique_docs(docs_primary, docs_broad)


def _has_rich_evidence(stats_a: Dict[str, int], stats_b: Dict[str, int]) -> bool:
    """
    Permissive fallback:
    if retrieval surfaces substantial grounded content, allow study mode.
    This prevents strict intent false negatives on process-heavy interviews.
    """
    kept_a = int(stats_a.get("kept", 0))
    kept_b = int(stats_b.get("kept", 0))
    kept_total = kept_a + kept_b
    return kept_total >= 8 or kept_a >= 5 or kept_b >= 5


def _retrieve_docs_for_video(proc: Dict[str, Any], question: str, fast_mode: bool = False):
    vectorstore = proc.get("vectorstore")
    chunks = proc.get("chunks") or []
    if vectorstore is None or not chunks:
        return []

    dynamic_k = int(proc.get("dynamic_k") or 5)
    retrieval_k = max(4, dynamic_k if fast_mode else dynamic_k + 1)
    query = question.strip() or "video summary"

    docs: List[Any] = []
    if not fast_mode:
        try:
            retr = build_self_query_retriever(vectorstore, retrieval_k)
            docs = retr.invoke(query) or []
        except Exception as e:
            logger.exception("Multi-video self-query failed: %s", e)
            docs = []

    dense_query = strip_time_phrases(query) or query
    focus_query = build_focus_query(chunks, dense_query)

    dense_docs = []
    focus_docs = []
    try:
        dense_docs = vectorstore.similarity_search(dense_query, k=retrieval_k)
    except Exception:
        dense_docs = []
    try:
        if focus_query and focus_query != dense_query:
            focus_docs = vectorstore.similarity_search(
                focus_query, k=min(retrieval_k + 2, 12)
            )
    except Exception:
        focus_docs = []

    lexical_docs = keyword_match_docs(
        chunks=chunks,
        query=query,
        max_docs=max(4, retrieval_k),
    )
    lexical_focus_docs = keyword_match_docs(
        chunks=chunks,
        query=focus_query,
        max_docs=max(3, retrieval_k // 2),
    )

    merged = merge_unique_docs(
        docs, dense_docs, focus_docs, lexical_docs, lexical_focus_docs
    )
    good = [d for d in merged if not is_low_quality_text(d.page_content)]
    if not good and merged:
        good = merged
    if not good:
        return []

    ranked = rank_docs_for_query(
        good,
        focus_query or dense_query or query,
        max_docs=min(max(6, retrieval_k), 10),
    )
    seed = ranked or good[: min(max(6, retrieval_k), 10)]
    expanded = expand_with_temporal_neighbors(
        seed_docs=seed,
        all_chunks=chunks,
        radius=1 if fast_mode else 2,
        max_docs=min(max(8, retrieval_k * 2), 16 if fast_mode else 18),
    )
    contextual = merge_unique_docs(seed, expanded)
    return contextual or seed


def run_multi_video_pipeline(
    proc_a: Dict[str, Any],
    proc_b: Dict[str, Any],
    question: str,
    study_mode: bool = False,
    is_chat: bool = False,
) -> Dict[str, Any]:
    """Generate one comparison answer from two processed videos."""
    meta_a = proc_a.get("metadata", {})
    meta_b = proc_b.get("metadata", {})
    video_id_a = str(meta_a.get("video_id") or "")
    video_id_b = str(meta_b.get("video_id") or "")
    query_scope = _detect_query_scope(question) if is_chat else "BOTH"
    original_query_scope = query_scope
    query_kind = (
        "COMPARATIVE"
        if _is_comparative_question(question)
        else (
            "COMMON"
            if _is_common_theme_question(question)
            else ("FOCUSED_INFO" if _is_focused_info_question(question) else "GENERAL")
        )
    )

    scoped_query = is_chat and query_scope in {"VIDEO_A_ONLY", "VIDEO_B_ONLY"}
    scoped_fast_mode = not scoped_query

    # Chat path optimization: fetch only needed side for literal scoped queries.
    if is_chat and query_scope == "VIDEO_A_ONLY":
        docs_a = _retrieve_docs_for_video(proc_a, question, fast_mode=scoped_fast_mode)
        docs_b = []
    elif is_chat and query_scope == "VIDEO_B_ONLY":
        docs_a = []
        docs_b = _retrieve_docs_for_video(proc_b, question, fast_mode=scoped_fast_mode)
    else:
        docs_a = _retrieve_docs_for_video(proc_a, question, fast_mode=is_chat)
        docs_b = _retrieve_docs_for_video(proc_b, question, fast_mode=is_chat)
    missing_side_note = ""

    if is_chat and query_scope == "BOTH" and not _is_comparative_question(question):
        primary_side = _infer_primary_side_for_question(
            question=question,
            docs_a=docs_a,
            docs_b=docs_b,
            meta_a=meta_a,
            meta_b=meta_b,
        )
        if primary_side == "A":
            query_scope = "VIDEO_A_ONLY"
            if not docs_b:
                missing_side_note = "**Video B:** That is not discussed here in this video."
        elif primary_side == "B":
            query_scope = "VIDEO_B_ONLY"
            if not docs_a:
                missing_side_note = "**Video A:** That is not discussed here in this video."

    # If only one side has usable evidence, route to that side and explicitly note the missing side.
    if is_chat and query_scope == "BOTH":
        if docs_a and not docs_b:
            query_scope = "VIDEO_A_ONLY"
            missing_side_note = "**Video B:** That is not discussed here in this video."
        elif docs_b and not docs_a:
            query_scope = "VIDEO_B_ONLY"
            missing_side_note = "**Video A:** That is not discussed here in this video."

    if is_chat:
        if query_scope == "VIDEO_A_ONLY" and not docs_a:
            response_text = _not_discussed_message(meta_a)
            return {
                "response": response_text,
                "study_mode": False,
                "video_a": meta_a,
                "video_b": meta_b,
            }
        if query_scope == "VIDEO_B_ONLY" and not docs_b:
            response_text = _not_discussed_message(meta_b)
            return {
                "response": response_text,
                "study_mode": False,
                "video_a": meta_a,
                "video_b": meta_b,
            }
        if query_scope == "BOTH" and not docs_a and not docs_b:
            response_text = (
                f"**Video A [{meta_a.get('title', 'Video A')}]**\n"
                f"{_not_discussed_message(meta_a)}\n\n"
                f"**Video B [{meta_b.get('title', 'Video B')}]**\n"
                f"{_not_discussed_message(meta_b)}"
            )
            return {
                "response": response_text,
                "study_mode": False,
                "video_a": meta_a,
                "video_b": meta_b,
            }

    evidence_a_text, stats_a, refs_a = _format_evidence_with_links(docs_a, video_id_a)
    evidence_b_text, stats_b, refs_b = _format_evidence_with_links(docs_b, video_id_b)

    if is_chat and query_scope == "VIDEO_A_ONLY":
        evidence_b_text = "Not requested by user."
    elif is_chat and query_scope == "VIDEO_B_ONLY":
        evidence_a_text = "Not requested by user."

    if is_chat:
        mode_directive = (
            STRICT_STUDY_MODE_DIRECTIVE.strip()
            if study_mode
            else "Chat mode: answer directly and only from provided evidence. Do not generate full comparison templates."
        )
    else:
        intent = _classify_compare_intent(
            question=question,
            meta_a=meta_a,
            meta_b=meta_b,
            evidence_a_preview=evidence_a_text,
            evidence_b_preview=evidence_b_text,
        )
        if study_mode:
            mode_directive = STRICT_STUDY_MODE_DIRECTIVE.strip()
        else:
            mode_directive = (
                "This is LEARNING context: you may include Recommendation and Study Plan."
                if intent.is_learning_context
                else "This is NON-LEARNING context: do not include Study Plan and do not include learning recommendation."
            )

    template = DUAL_CHAT_PROMPT if is_chat else COMPARISON_PROMPT
    prompt_text = template.format(
        user_question=question,
        metadata_a=_metadata_block(meta_a, stats_a),
        metadata_b=_metadata_block(meta_b, stats_b),
        evidence_a=evidence_a_text,
        evidence_b=evidence_b_text,
        mode_directive=mode_directive,
        title_a=meta_a.get("title", "Video A"),
        title_b=meta_b.get("title", "Video B"),
        query_scope=query_scope,
        query_kind=query_kind,
    )

    res = open_router_model.invoke(prompt_text)
    response_text = (res.content if hasattr(res, "content") else str(res)).strip()

    if is_chat:
        response_text = _remove_opposite_scope_section(response_text, query_scope)
        if _is_explicit_scope_request(question, query_scope):
            response_text = _strip_source_header(response_text)
        else:
            response_text = _with_scope_source_header(response_text, query_scope, question)
        if query_scope == "VIDEO_A_ONLY" and not _has_timestamp_link(response_text):
            fallback_link = _build_grounded_timestamp_link(
                question=question,
                answer=response_text,
                docs=docs_a,
                video_id=video_id_a,
            )
            if fallback_link and not _looks_not_found_response(response_text):
                response_text = _append_inline_timestamp(response_text, fallback_link)
        elif query_scope == "VIDEO_B_ONLY" and not _has_timestamp_link(response_text):
            fallback_link = _build_grounded_timestamp_link(
                question=question,
                answer=response_text,
                docs=docs_b,
                video_id=video_id_b,
            )
            if fallback_link and not _looks_not_found_response(response_text):
                response_text = _append_inline_timestamp(response_text, fallback_link)
        elif query_scope == "BOTH" and query_kind == "COMMON" and not _has_timestamp_link(response_text):
            link_a = _build_grounded_timestamp_link(
                question=question,
                answer=response_text,
                docs=docs_a,
                video_id=video_id_a,
            )
            link_b = _build_grounded_timestamp_link(
                question=question,
                answer=response_text,
                docs=docs_b,
                video_id=video_id_b,
            )
            response_text = _append_dual_common_links(response_text, link_a, link_b)
        if original_query_scope == "BOTH" and missing_side_note:
            response_text = f"{response_text}\n\n{missing_side_note}"
        if _looks_not_found_response(response_text):
            response_text = _strip_timestamp_links(response_text)
        response_text = _ensure_answer_prefix(response_text)
        response_text = _dedupe_timestamp_links(response_text)

    response_text = re.sub(
        r"(?im)^\s*(?:\*\*)?confidence\s*score(?:\*\*)?\s*:\s*.*$",
        "",
        response_text,
    ).strip()

    if not is_chat and not re.search(
        r"(?im)^\s{0,3}##\s*Evidence Links\b", response_text
    ):
        evidence_links = _build_evidence_links_section(refs_a, refs_b)
        if len(evidence_links.splitlines()) > 1:
            response_text = f"{response_text}\n\n{evidence_links}".strip()

    study_mode_detected = (
        bool(re.search(r"(?im)^\s{0,3}(?:##\s*)?Study\s+Plan\b", response_text))
        or study_mode
    )
    return {
        "response": response_text,
        "study_mode": study_mode_detected,
        "video_a": meta_a,
        "video_b": meta_b,
    }


def check_technical_videos_internal(
    proc_a: Dict[str, Any], proc_b: Dict[str, Any]
) -> bool:
    meta_a = proc_a.get("metadata", {})
    meta_b = proc_b.get("metadata", {})

    docs_a = _collect_validation_docs(proc_a, meta_a)
    docs_b = _collect_validation_docs(proc_b, meta_b)

    evidence_a_text, stats_a, _ = _format_evidence_with_links(docs_a, "")
    evidence_b_text, stats_b, _ = _format_evidence_with_links(docs_b, "")

    intent = _classify_compare_intent(
        question=(
            "Is either video suitable for study mode because it contains "
            "technical, educational, process-oriented, or analytical discussion?"
        ),
        meta_a=meta_a,
        meta_b=meta_b,
        evidence_a_preview=evidence_a_text,
        evidence_b_preview=evidence_b_text,
    )
    if intent.is_learning_context:
        return True

    secondary_intent = _classify_compare_intent(
        question=(
            "Even if this is not a tutorial, does either video include concrete "
            "workflow/process reasoning, constraints, or production-method details "
            "that benefit deeper comparative analysis?"
        ),
        meta_a=meta_a,
        meta_b=meta_b,
        evidence_a_preview=evidence_a_text,
        evidence_b_preview=evidence_b_text,
    )
    if secondary_intent.is_learning_context:
        return True

    return _has_rich_evidence(stats_a, stats_b)
