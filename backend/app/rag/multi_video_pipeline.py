"""Multi-video comparison pipeline helpers."""

import logging
import re
from typing import Any, Dict, List

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
    keyword_match_docs,
    merge_unique_docs,
    rank_docs_for_query,
    strip_time_phrases,
)

logger = logging.getLogger(__name__)

STRICT_STUDY_MODE_DIRECTIVE = """
STRICT STUDY MODE ENABLED:
- Use an industry-grade technical analysis style.
- Prioritize concept depth, architecture/process reasoning, trade-offs, and practical implications.
- Use clear markdown sections and concise technical language.
- Include:
  1) a technical verdict,
  2) a confidence score (/100),
  3) a concrete study plan with actionable next steps.
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
with chosen video, reasons, and confidence/100.
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

Rules:
1) Answer the specific question directly based ONLY on the evidence provided above. Do NOT write a generic summary or snapshot.
2) Use clean, easy-to-read markdown.
2.1) Never use section headers like "Dual Video Summary", "Video A Snapshot", "Video B Snapshot", "Cross-Video Verdict", or "Recommendation".
3) When query_scope is VIDEO_A_ONLY, answer only from Video A evidence.
4) When query_scope is VIDEO_B_ONLY, answer only from Video B evidence.
5) When query_scope is BOTH, answer with two short blocks in this exact order:
   **Video A [{title_a}]**
   **Video B [{title_b}]**
6) For each grounded claim, use one inline timestamp link in this exact format:
   [m:ss](https://youtu.be/<video_id>?t=<seconds>s)
   Never output plain [m:ss] without a link.
7) If information is missing in a requested video, explicitly say:
   "That is not discussed here in this video."
   Then add one short suggestion grounded in metadata/title.
8) Be conversational but factual and concise.
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
    if mentions_a and not mentions_b:
        return "VIDEO_A_ONLY"
    if mentions_b and not mentions_a:
        return "VIDEO_B_ONLY"
    return "BOTH"


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


def _retrieve_docs_for_video(proc: Dict[str, Any], question: str):
    vectorstore = proc.get("vectorstore")
    chunks = proc.get("chunks") or []
    if vectorstore is None or not chunks:
        return []

    dynamic_k = int(proc.get("dynamic_k") or 5)
    retrieval_k = max(6, dynamic_k + 1)
    query = question.strip() or "video summary"

    docs: List[Any] = []
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
    return ranked or good[: min(max(6, retrieval_k), 10)]


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

    docs_a = _retrieve_docs_for_video(proc_a, question)
    docs_b = _retrieve_docs_for_video(proc_b, question)

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
    )

    res = open_router_model.invoke(prompt_text)
    response_text = (res.content if hasattr(res, "content") else str(res)).strip()
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

    docs_a = _retrieve_docs_for_video(
        proc_a, "technical analytical educational deep tutorial"
    )
    docs_b = _retrieve_docs_for_video(
        proc_b, "technical analytical educational deep tutorial"
    )

    evidence_a_text, _, _ = _format_evidence_with_links(docs_a, "")
    evidence_b_text, _, _ = _format_evidence_with_links(docs_b, "")

    intent = _classify_compare_intent(
        question="Is this technical, educational, or highly analytical content?",
        meta_a=meta_a,
        meta_b=meta_b,
        evidence_a_preview=evidence_a_text,
        evidence_b_preview=evidence_b_text,
    )
    return intent.is_learning_context
