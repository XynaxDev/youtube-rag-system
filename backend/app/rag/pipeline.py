"""
Core RAG pipeline: video processing, single-video chat, comparison, summaries.
Orchestrates transcript â†’ chunks â†’ embeddings â†’ retrieval â†’ LLM generation.
"""

import logging
import re
import uuid
from typing import Dict, Optional

from pydantic import BaseModel, Field
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser, PydanticOutputParser
from langchain_community.chat_message_histories import ChatMessageHistory

from app.config import open_router_model
from app.rag.transcript import (
    extract_video_id,
    fetch_video_metadata,
    ingest_video_to_chunks,
)
from app.rag.retriever import (
    create_vectorstore_for_video,
    build_self_query_retriever,
    is_low_quality_text,
)
from app.rag.multi_video_pipeline import (
    run_multi_video_pipeline,
    check_technical_videos_internal,
)
from app.rag.retrieval_helpers import (
    build_focus_query as _build_focus_query,
    doc_timestamp_candidates as _doc_timestamp_candidates,
    expand_with_temporal_neighbors as _expand_with_temporal_neighbors,
    extract_time_seconds as _extract_time_seconds,
    fetch_time_window_docs as _fetch_time_window_docs,
    keyword_match_docs as _keyword_match_docs,
    merge_unique_docs as _merge_unique_docs,
    pick_closest_timestamp as _pick_closest_timestamp,
    pick_evidence_timestamp_for_answer as _pick_evidence_timestamp_for_answer,
    rank_docs_for_query as _rank_docs_for_query,
    strip_time_phrases as _strip_time_phrases,
)
from app.rag.policy_helpers import (
    get_response_policy,
)

logger = logging.getLogger(__name__)

# â”€â”€â”€ In-memory session store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
sessions: Dict[str, dict] = {}


def get_or_create_session(session_id: Optional[str] = None) -> str:
    if session_id and session_id in sessions:
        return session_id
    new_id = session_id or str(uuid.uuid4())
    sessions[new_id] = {
        "history": ChatMessageHistory(),
        "processed_videos": {},
        "summary_cache": {},
        "starter_questions_cache": {},
    }
    return new_id


# â”€â”€â”€ Intent Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _normalize_summary_text(text: str) -> str:
    """Normalize summary to overview + 'Key Takeaways:' bullets."""
    if not text:
        return ""

    cleaned = text.strip()
    cleaned = re.sub(
        r"^\s*(?:\*\*|__)?summary(?:\*\*|__)?\s*[:\-]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    has_takeaways = re.search(
        r"(?im)^\s*(?:\*\*|__)?key\s+takeaways(?:\*\*|__)?\s*:\s*$",
        cleaned,
    )

    if not has_takeaways:
        sentences = [
            s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s and s.strip()
        ]
        if not sentences:
            return cleaned

        overview = " ".join(sentences[:5]).strip()
        tail = [s for s in sentences[5:] if len(s.split()) >= 4]
        if not tail:
            tail = [s for s in sentences[1:6] if len(s.split()) >= 4]
        bullets = tail[:5]

        if bullets:
            bullet_block = "\n".join(f"* {line}" for line in bullets)
            return f"{overview}\n\nKey Takeaways:\n{bullet_block}".strip()
        return overview

    normalized_lines = []
    in_takeaways = False
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if re.match(r"(?i)^(?:\*\*|__)?key\s+takeaways(?:\*\*|__)?\s*:\s*$", line):
            in_takeaways = True
            normalized_lines.append("Key Takeaways:")
            continue
        if in_takeaways and line:
            if re.match(r"^[-\u2022]\s+", line):
                normalized_lines.append("* " + re.sub(r"^[-\u2022]\s+", "", line))
            else:
                normalized_lines.append(raw_line.rstrip())
        else:
            normalized_lines.append(raw_line.rstrip())

    return "\n".join(normalized_lines).strip()


class SummaryPayload(BaseModel):
    summary: str = Field(
        description="4-5 sentence professional overview with no 'Summary:' label."
    )
    questions: list[str] = Field(
        description="Exactly 3 short, video-specific starter questions. Each should be 4-5 words."
    )


# â”€â”€â”€ RAG Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
RAG_PROMPT = PromptTemplate(
    template="""
    You are a helpful YouTube AI assistant.
    PRIMARY TASK (STRICTLY FOLLOW):
    - Your primary goal is to answer the [USER QUESTION] provided below.
    - Use the [CHAT HISTORY] only for context when needed.
    - Do not answer old questions from chat history.

    VIDEO CONTENT:
    {context}

    CHAT HISTORY:
    {chat_history}

    USER QUESTION: 
    {question}

    RESPONSE POLICY:
    {timestamp_guidance}
    {precision_guidance}

    INSTRUCTIONS:
    1. Answer using only [VIDEO CONTENT].
    2. If information is not present in the provided evidence for a video-related question, clearly say it is not covered and briefly mention the video theme: {video_summary}.
    3. Before concluding "not covered", re-check the evidence for direct factual statements (numbers, durations, dates, names) relevant to the user question.
    4. Do not append raw links, source labels, or footer boilerplate.
    5. For factual queries, provide a direct answer plus 1-2 concise supporting lines grounded in evidence.
    6. If the user provides a quoted/pasted line to explain, address all major claims in that line (people, numbers, events, context), not just one part.
    7. Keep the response concise, conversational, and in the same language as the user question.
    8. Do not infer causes or motivations that are not explicitly stated in the evidence.
    9. For timeline/duration questions, if wording differs but intent is adjacent (for example preparing/making/filming/production), use the closest directly supported timeline fact and explicitly state the exact evidence wording.
    10. If the question asks "how/why" and no directly related evidence exists even after adjacent-intent mapping, explicitly say the direct explanation is not stated.
    11. If the user asks for unrelated tasks (for example coding, debugging, math solving, translation, or writing outside this video), do not perform the task and respond with one short sentence only, without summarizing the video.
    12. For ordered or verification questions (for example first/last/true/false claims), resolve using chronology in the evidence and explicitly match the asked person/subject before answering.
    """,
    input_variables=[
        "context",
        "question",
        "chat_history",
        "video_summary",
        "timestamp_guidance",
        "precision_guidance",
    ],
)

CHAT_PROMPT = PromptTemplate(
    template="""
    You are a conversational assistant for a YouTube video Q&A experience.

    VIDEO CONTEXT:
    {video_summary}

    CHAT HISTORY:
    {chat_history}

    USER MESSAGE:
    {question}

    Rules:
    - Reply naturally and briefly.
    - Keep it conversational and helpful.
    - Do not include timestamps, source labels, or links.
    - If the user asks for video details, invite a specific follow-up question.
    - If the user asks for unrelated tasks (coding, debugging, math solving, translation, or general writing), do not do that task; respond that you can only help with this video's content and ask a video-specific follow-up.
    - Never output code blocks or step-by-step solutions for non-video tasks.
    - For unrelated tasks, keep response to one short sentence and do not summarize prior chat context.
    - Use the same language as the user.
    """,
    input_variables=["video_summary", "chat_history", "question"],
)


# â”€â”€â”€ Core Pipeline Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def process_video(session_id: str, video_url: str) -> dict:
    """Process a video: fetch metadata, transcript, chunk, embed, store."""
    session = sessions[session_id]
    video_id = extract_video_id(video_url)

    # Return cached only when a usable transcript/vector index exists.
    cached = session["processed_videos"].get(video_id)
    if cached and cached.get("chunks") and cached.get("vectorstore") is not None:
        return cached

    metadata = fetch_video_metadata(video_id)
    chunks, dynamic_k = ingest_video_to_chunks(video_id)

    vectorstore = None
    if chunks:
        vectorstore = create_vectorstore_for_video(
            video_id, chunks, collection_name=f"youtube-{video_id}"
        )

    result = {
        "video_id": video_id,
        "metadata": metadata,
        "chunks": chunks,
        "dynamic_k": dynamic_k,
        "vectorstore": vectorstore,
    }
    # Avoid sticky "no transcript" cache from transient fetch failures.
    if chunks and vectorstore is not None:
        session["processed_videos"][video_id] = result
    return result


def chat_with_video(session_id: str, video_url: str, message: str) -> dict:
    """Single-video RAG chat with intent routing."""
    session = sessions[session_id]
    history = session["history"]
    video_id = extract_video_id(video_url)

    # Ensure video is processed
    processed = process_video(session_id, video_url)
    metadata = processed["metadata"]
    chunks = processed["chunks"]
    vectorstore = processed["vectorstore"]
    video_focus = metadata.get("title", "this video")

    if not chunks or vectorstore is None:
        return {
            "response": f"Transcript not available for video {video_id}. Please provide a video with captions.",
            "intent": "ERROR",
            "sources": [],
        }

    policy = get_response_policy(message, history)
    intent = policy.route
    include_timestamps = policy.include_timestamps
    retrieval_focus = policy.retrieval_focus
    use_history = policy.use_history
    is_precise = retrieval_focus == "PRECISE" or include_timestamps
    # Precise factual queries should return a grounded timestamp source.
    include_timestamps = include_timestamps or is_precise
    logger.info(
        "Detected policy: route=%s include_timestamps=%s retrieval_focus=%s use_history=%s",
        intent,
        include_timestamps,
        retrieval_focus,
        use_history,
    )

    if intent == "SUMMARY":
        # Check cache
        if video_id not in session["summary_cache"]:
            session["summary_cache"][video_id] = _get_universal_summary(
                chunks, metadata
            )
        summary = session["summary_cache"][video_id]
        history.add_user_message(message)
        history.add_ai_message(summary)
        return {"response": summary, "intent": "SUMMARY", "sources": []}

    if intent == "CHAT":
        history_str = (
            "\n".join([f"{m.type}: {m.content}" for m in history.messages[-6:]])
            if use_history
            else ""
        )
        chat_chain = CHAT_PROMPT | open_router_model | StrOutputParser()
        try:
            chat_result = chat_chain.invoke(
                {
                    "video_summary": metadata.get("title", "this video"),
                    "chat_history": history_str,
                    "question": message,
                }
            )
            history.add_user_message(message)
            history.add_ai_message(chat_result)
            return {"response": chat_result, "intent": "CHAT", "sources": []}
        except Exception as e:
            logger.exception("Chat generation failed: %s", e)
            return {
                "response": "Error generating a conversational response.",
                "intent": "ERROR",
                "sources": [],
            }

    # RAG mode
    retrieval_query = message
    retrieval_k = max(6, processed["dynamic_k"] + 1) + (2 if is_precise else 0)
    retriever = build_self_query_retriever(vectorstore, retrieval_k)
    retrieved_docs = []
    try:
        retrieved_docs = retriever.invoke(retrieval_query)
    except Exception as e:
        logger.exception(
            "Self-query retrieval failed: %s. Continuing with fallback retrieval paths.",
            e,
        )
        retrieved_docs = []

    # Dense semantic retrieval as a second signal (self-query can miss some factual spans).
    dense_query = _strip_time_phrases(message) or message
    focus_query = _build_focus_query(processed["chunks"], dense_query)
    dense_docs = []
    dense_focus_docs = []
    diverse_docs = []
    try:
        dense_docs = vectorstore.similarity_search(
            dense_query,
            k=retrieval_k,
        )
    except Exception:
        dense_docs = []
    try:
        if focus_query and focus_query != dense_query:
            dense_focus_docs = vectorstore.similarity_search(
                focus_query,
                k=min(retrieval_k + 2, 12),
            )
    except Exception:
        dense_focus_docs = []
    try:
        if focus_query:
            diverse_docs = vectorstore.max_marginal_relevance_search(
                focus_query,
                k=min(retrieval_k + 2, 12),
                fetch_k=min(max(retrieval_k * 4, 20), 40),
            )
    except Exception:
        diverse_docs = []

    # Dynamic lexical fallback: recover specific discussion moments (entities/terms) when semantic retrieval misses.
    lexical_docs = _keyword_match_docs(
        chunks=processed["chunks"],
        query=message,
        max_docs=max(4, retrieval_k),
    )
    lexical_focus_docs = _keyword_match_docs(
        chunks=processed["chunks"],
        query=focus_query,
        max_docs=max(3, retrieval_k // 2),
    )

    # Time-aware supplemental retrieval: add a time-window search when timestamp response is requested.
    time_seconds = _extract_time_seconds(message)
    time_docs = []
    if include_timestamps and time_seconds is not None:
        time_docs = _fetch_time_window_docs(
            vectorstore=vectorstore,
            base_query=dense_query or "video context",
            sec=time_seconds,
            k=retrieval_k,
        )

    retrieved_docs = _merge_unique_docs(
        retrieved_docs,
        dense_docs,
        dense_focus_docs,
        diverse_docs,
        lexical_docs,
        lexical_focus_docs,
        time_docs,
    )

    # Filter and format: preserve retriever output when quality heuristics are strict.
    good_docs = [d for d in retrieved_docs if not is_low_quality_text(d.page_content)]
    if not good_docs and retrieved_docs:
        good_docs = retrieved_docs

    if not good_docs:
        guarded = f"That isn't discussed here. This video focuses on {video_focus}."
        history.add_user_message(message)
        history.add_ai_message(guarded)
        return {"response": guarded, "intent": "RAG", "sources": []}

    # Rank by relevance first, then add nearby timeline neighbors.
    ranking_query = focus_query or dense_query or message
    seed_docs = (
        _rank_docs_for_query(
            good_docs,
            ranking_query,
            max_docs=min(max(6, retrieval_k), 10),
        )
        or good_docs[: min(max(6, retrieval_k), 10)]
    )
    if is_precise:
        numeric_docs = [d for d in good_docs if re.search(r"\d", d.page_content or "")]
        precise_docs = _rank_docs_for_query(
            numeric_docs,
            ranking_query,
            max_docs=min(max(4, retrieval_k // 2), 8),
        )
        seed_docs = _merge_unique_docs(seed_docs, precise_docs)

    expanded_docs = _expand_with_temporal_neighbors(
        seed_docs=seed_docs,
        all_chunks=processed["chunks"],
        radius=1 if not is_precise else 3,
        max_docs=max(14, retrieval_k * 2),
    )

    context_docs = _merge_unique_docs(seed_docs, expanded_docs)
    if not context_docs:
        context_docs = seed_docs or good_docs[: max(8, retrieval_k)]

    # Keep relevance-first order so the model sees strongest evidence first.
    context_docs = context_docs[: max(12, retrieval_k * 2)]

    context_text = "\n\n".join(
        [f"[{d.metadata['start']}s]: {d.page_content}" for d in context_docs]
    )
    history_str = (
        "\n".join([f"{m.type}: {m.content}" for m in history.messages[-6:]])
        if use_history
        else ""
    )
    # Ground timestamp on the top relevance seed (not the earliest timeline chunk).
    primary_doc = (
        seed_docs[0] if seed_docs else (context_docs[0] if context_docs else None)
    )
    top_candidates = _doc_timestamp_candidates(primary_doc) if primary_doc else []
    if top_candidates:
        timestamp = int(top_candidates[0])
    elif primary_doc is not None:
        timestamp = int(primary_doc.metadata.get("start", 0))
    else:
        timestamp = 0
    timestamp_guidance = (
        "Include one relevant timestamp naturally in the answer using evidence-grounded mm:ss format. "
        "Do not invent timestamps, and do not append links or source footer."
        if include_timestamps
        else "Do not include timestamps, links, or source footer."
    )
    precision_guidance = (
        "User requests precise factual detail. Prefer exact values and directly supported figures from evidence. "
        "Only say 'not covered' after checking all provided evidence for explicit facts."
        if is_precise
        else "Answer normally from the provided evidence."
    )

    try:
        rag_chain = RAG_PROMPT | open_router_model | StrOutputParser()
        result = rag_chain.invoke(
            {
                "context": context_text,
                "question": message,
                "chat_history": history_str,
                "video_summary": metadata.get("title", "this video"),
                "timestamp_guidance": timestamp_guidance,
                "precision_guidance": precision_guidance,
            }
        )
        history.add_user_message(message)
        history.add_ai_message(result)

        # Return one grounded timestamp source for RAG answers when evidence exists.
        # CHAT/SUMMARY routes still return no sources.
        sources = []
        mentioned_ts = _extract_time_seconds(result)
        chosen_ts = timestamp
        candidate_docs = _merge_unique_docs(seed_docs, context_docs, good_docs)
        evidence_ts = _pick_evidence_timestamp_for_answer(
            question=message,
            answer=result,
            docs=processed["chunks"],
            fallback_timestamp=timestamp,
        )
        if mentioned_ts is not None:
            aligned = _pick_closest_timestamp(mentioned_ts, candidate_docs)
            # Keep UI chip synchronized with explicit answer timestamps.
            # If nearest evidence point is close, snap to it; otherwise prefer lexical evidence.
            if aligned is not None and abs(aligned - mentioned_ts) <= 120:
                chosen_ts = aligned
            elif include_timestamps:
                chosen_ts = evidence_ts
            else:
                chosen_ts = mentioned_ts
        else:
            chosen_ts = evidence_ts
        should_emit_source = bool(candidate_docs)
        if should_emit_source:
            sources = [{"timestamp": int(chosen_ts), "video_id": video_id}]

        return {"response": result, "intent": "RAG", "sources": sources}
    except Exception as e:
        logger.exception("RAG generation failed: %s", e)
        return {
            "response": "Error generating an answer.",
            "intent": "ERROR",
            "sources": [],
        }


def summarize_video(session_id: str, video_url: str) -> dict:
    """Get a full summary of a video."""
    session = sessions[session_id]
    video_id = extract_video_id(video_url)

    processed = process_video(session_id, video_url)
    metadata = processed["metadata"]
    chunks = processed["chunks"]

    if not chunks:
        return {
            "summary": f"Transcript not available for video {video_id}.",
            "video_info": metadata,
            "starter_questions": [],
        }

    if video_id not in session["summary_cache"]:
        payload = _get_summary_payload(chunks, metadata)
        session["summary_cache"][video_id] = payload.summary
        session["starter_questions_cache"][video_id] = payload.questions
    elif video_id not in session["starter_questions_cache"]:
        session["starter_questions_cache"][video_id] = _get_starter_questions(
            session["summary_cache"][video_id], metadata
        )

    return {
        "summary": session["summary_cache"][video_id],
        "video_info": metadata,
        "starter_questions": session["starter_questions_cache"][video_id],
    }


def compare_videos(
    session_id: str, url1: str, url2: str, question: str, study_mode: bool = False
) -> dict:
    """Compare two videos using the dedicated multi-video pipeline."""
    session = sessions[session_id]
    history = session["history"]

    proc_a = process_video(session_id, url1)
    proc_b = process_video(session_id, url2)

    vs_a = proc_a["vectorstore"]
    vs_b = proc_b["vectorstore"]

    if vs_a is None and vs_b is None:
        return {
            "response": "Transcripts missing for both videos. Cannot compare.",
            "intent": "ERROR",
            "study_mode": False,
        }

    try:
        is_chat = len(history.messages) > 0
        result = run_multi_video_pipeline(
            proc_a, proc_b, question, study_mode=study_mode, is_chat=is_chat
        )
        response_text = result["response"]
        history.add_user_message(question)
        history.add_ai_message(response_text)
        return {
            "response": response_text,
            "intent": "COMPARE",
            "video_a": result["video_a"],
            "video_b": result["video_b"],
            "study_mode": result["study_mode"],
        }
    except Exception as e:
        logger.exception("Multi-video comparison failed: %s", e)
        return {
            "response": "Error during comparison.",
            "intent": "ERROR",
            "study_mode": False,
        }


def check_technical_videos(session_id: str, url1: str, url2: str) -> bool:
    """Check if either video has deep technical/analytical content for study mode."""
    proc_a = process_video(session_id, url1)
    proc_b = process_video(session_id, url2)
    return check_technical_videos_internal(proc_a, proc_b)


# â”€â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _get_universal_summary(chunks, metadata) -> str:
    MAX_CHARS = 500000
    total_text = " ".join([c.page_content for c in chunks])

    if len(total_text) > MAX_CHARS:
        step = len(total_text) // MAX_CHARS + 1
        sampled = chunks[::step]
        final_text = " ".join([c.page_content for c in sampled])
    else:
        final_text = total_text

    title = metadata.get("title", "this video")
    res = open_router_model.invoke(f"""
    You are an elite executive intelligence analyst. 
    Video Title: {title}

    STRICT FORMATTING RULES:
    1. Start directly with a high-level, 4-5 sentence professional overview of the video's core mission and content. Do not prepend any label like "Summary:".
    2. Then add a standalone heading exactly as "Key Takeaways:" followed by a bulleted list (using '*' for bullets) of the most important specific insights.
    3. DO NOT use technical jargon like "transcript" or "chunks".
    4. DO NOT include any source links or timestamps in this summary.
    5. Keep the language sophisticated yet direct.

    VIDEO CONTENT:
    {final_text}
    
    """)
    content = res.content if hasattr(res, "content") else str(res)
    return _normalize_summary_text(content)


def _get_starter_questions(summary_text: str, metadata: dict) -> list[str]:
    """Generate short, video-specific starter prompts without hardcoded fallbacks."""
    title = metadata.get("title", "this video")
    try:
        res = open_router_model.invoke(
            f"""
You are generating chat starter prompts for a YouTube video assistant.
Video title: {title}
Video summary:
{summary_text}

Rules:
- Return exactly 3 prompts.
- Each prompt should be one line, 4-5 words, specific to this video.
- At least one prompt should ask about a timestamp/moment.
- Do not return numbering, bullets, markdown, or quotes.
- End each prompt with a question mark.
"""
        )
        raw = res.content if hasattr(res, "content") else str(res)
        lines = [ln.strip(" -*0123456789.\t") for ln in raw.splitlines() if ln.strip()]
        cleaned: list[str] = []
        for ln in lines:
            text = " ".join(ln.split())
            if len(text) < 8:
                continue
            if not text.endswith("?"):
                text = f"{text}?"
            words = [w for w in re.findall(r"[A-Za-z0-9']+", text) if w]
            if len(words) < 4 or len(words) > 6:
                continue
            cleaned.append(text)
        unique = []
        seen = set()
        for q in cleaned:
            key = q.lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(q)
            if len(unique) == 3:
                break
        if len(unique) == 3:
            return unique
    except Exception:
        pass

    return []


def _get_summary_payload(chunks, metadata) -> SummaryPayload:
    """Generate summary + short starter questions together in structured JSON."""
    MAX_CHARS = 500000
    total_text = " ".join([c.page_content for c in chunks])
    if len(total_text) > MAX_CHARS:
        step = len(total_text) // MAX_CHARS + 1
        sampled = chunks[::step]
        final_text = " ".join([c.page_content for c in sampled])
    else:
        final_text = total_text

    title = metadata.get("title", "this video")
    parser = PydanticOutputParser(pydantic_object=SummaryPayload)
    prompt = PromptTemplate(
        template="""
You are an elite executive intelligence analyst.
Video Title: {title}

Return ONLY a JSON object with keys:
- summary: full executive summary with:
  1) a high-level 4-5 sentence overview
  2) a standalone heading exactly "Key Takeaways:"
  3) 4-7 concise bullet points using '*' characters
  Do not prefix with "Summary:".
- questions: exactly 3 short, video-specific starter questions.

Rules for questions:
- Each question must be 4-5 words.
- Natural human phrasing.
- At least one must reference a timestamp/moment.
- End each with '?'.
- No numbering, no markdown.

Avoid technical jargon and avoid source links/timestamps in the summary body.

VIDEO CONTENT:
{video_content}

{format_instructions}
""",
        input_variables=["title", "video_content"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    chain = prompt | open_router_model | parser
    try:
        payload = chain.invoke({"title": title, "video_content": final_text})
        questions = payload.questions if isinstance(payload.questions, list) else []
        cleaned = []
        for q in questions:
            text = " ".join(str(q).split())
            if not text:
                continue
            if not text.endswith("?"):
                text = f"{text}?"
            words = [w for w in re.findall(r"[A-Za-z0-9']+", text) if w]
            if 4 <= len(words) <= 6:
                cleaned.append(text)
        dedup = []
        seen = set()
        for q in cleaned:
            k = q.lower()
            if k in seen:
                continue
            seen.add(k)
            dedup.append(q)
            if len(dedup) == 3:
                break
        summary_text = _normalize_summary_text((payload.summary or "").strip())
        # Guard: if structured summary comes back too short, fallback to richer formatter.
        if len(summary_text.split()) < 70:
            summary_text = _get_universal_summary(chunks, metadata)

        if len(dedup) < 3:
            fallback_questions = _get_starter_questions(summary_text, metadata)
            if fallback_questions:
                dedup = fallback_questions[:3]

        return SummaryPayload(summary=summary_text, questions=dedup)
    except Exception:
        summary = _get_universal_summary(chunks, metadata)
        questions = _get_starter_questions(summary, metadata)
        return SummaryPayload(summary=summary, questions=questions)
