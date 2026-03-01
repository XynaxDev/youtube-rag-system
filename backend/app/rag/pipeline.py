"""
Core RAG pipeline: video processing, single-video chat, comparison, summaries.
Orchestrates transcript → chunks → embeddings → retrieval → LLM generation.
"""

import logging
import uuid
from typing import Dict, Optional, Literal

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
    format_evidence,
    is_low_quality_text,
)

logger = logging.getLogger(__name__)

# ─── In-memory session store ─────────────────────────────────
sessions: Dict[str, dict] = {}


def get_or_create_session(session_id: Optional[str] = None) -> str:
    if session_id and session_id in sessions:
        return session_id
    new_id = session_id or str(uuid.uuid4())
    sessions[new_id] = {
        "history": ChatMessageHistory(),
        "processed_videos": {},
        "summary_cache": {},
    }
    return new_id


# ─── Intent Router ───────────────────────────────────────────
class Router(BaseModel):
    route: Literal["SUMMARY", "RAG"] = Field(
        description="The user's intent: 'SUMMARY' for broad overviews, 'RAG' for specific questions."
    )


class MultiRouter(BaseModel):
    route: Literal["SUMMARY", "RAG", "COMPARE", "DUAL_SUMMARY"] = Field(
        description="User intent: SUMMARY, RAG, COMPARE, or DUAL_SUMMARY"
    )


def get_intent(
    query: str, history: ChatMessageHistory, multi_mode: bool = False
) -> str:
    recent_history = "\n".join(
        [f"{m.type}: {m.content}" for m in history.messages[-4:]]
    )

    router_class = MultiRouter if multi_mode else Router
    parser = PydanticOutputParser(pydantic_object=router_class)

    router_instruction = """
    You are an expert query router. Based on the conversation history and the new request,
    determine the user's intent.

    CONVERSATION HISTORY:
    {history}

    NEW REQUEST:
    {query}

    Rules:
    - If the request is a follow-up or asks for specific details, pick RAG.
    - If the request is a greeting like "hi" or "hello", pick RAG.
    - If the request asks for a general overview, pick SUMMARY.
    - If comparing two videos, pick COMPARE.
    - If asking to summarize both videos, pick DUAL_SUMMARY.

    {format_instructions}
    """

    prompt = PromptTemplate(
        template=router_instruction,
        input_variables=["history", "query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )

    chain = prompt | open_router_model | parser
    try:
        intent_obj = chain.invoke({"history": recent_history, "query": query})
        return intent_obj.route
    except Exception as e:
        logger.exception("Router parsing error: %s. Defaulting to RAG.", e)
        return "RAG"


# ─── RAG Prompt ──────────────────────────────────────────────
RAG_PROMPT = PromptTemplate(
    template="""
    You are a helpful YouTube AI assistant. 
    PRIMARY TASK(STRICTLY FOLLOW):
    - Your primary goal is to answer the [USER QUESTION] provided below.
    - Use the [CHAT HISTORY] ONLY for context (e.g., if the user refers to a previous point). 
    - DO NOT answer OLD questions from the chat history and do not greet again and again.

    VIDEO CONTENT:
    {context}

    CHAT HISTORY:
    {chat_history}

    USER QUESTION: 
    {question}

    INSTRUCTIONS:
    1. GENERAL CONVERSATION & GREETINGS:
       - Reply naturally and warmly.
       - Acknowledge that you are here to help with the video. You can mention that the video is about: {video_summary}
       - DO NOT include Source Links for general chat.
    
    2. TIMESTAMP QUERIES:
       - If the user asks about a specific time (e.g., "at 54:00"), use the closest available segments in the [VIDEO CONTENT].
       - Answer based on that content naturally. Simply state what is being discussed in that portion of the video.
       
    3. VIDEO QUESTIONS (INFORMATION FOUND):
       - Answer using ONLY the [VIDEO CONTENT] provided.
       - (CRITICAL) You MUST always append the source link at the end of your response,\nSource: https://youtu.be/{video_id}?t={seconds}s
       - Use the 'seconds' variable provided to you for the link.

    4. VIDEO QUESTIONS (INFORMATION NOT FOUND):
       - If the user asks about something not in the video, politely explain that it's not covered. 
       - Briefly mention the general theme of the video ({video_summary}) to be helpful and invite related questions.
       - DO NOT provide a source link if the answer is not found.
    
    5. PERSONAL OPINIONS (NOT GENERAL QUESTIONS):
       - If the user asks for YOUR personal view or opinion, start by saying: "As an AI assistant, I don't have personal opinions. However, based on the video content..." and then proceed to answer using the transcript content.

    6. FORMATTING:
       - Keep responses conversational, helpful, and grounded.
       - Respond in the same language as the [USER QUESTION].
    """,
    input_variables=[
        "context",
        "question",
        "video_id",
        "seconds",
        "chat_history",
        "video_summary",
    ],
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


# ─── Core Pipeline Functions ─────────────────────────────────
def process_video(session_id: str, video_url: str) -> dict:
    """Process a video: fetch metadata, transcript, chunk, embed, store."""
    session = sessions[session_id]
    video_id = extract_video_id(video_url)

    # Return cached if already processed
    if video_id in session["processed_videos"]:
        return session["processed_videos"][video_id]

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

    if not chunks or vectorstore is None:
        return {
            "response": f"Transcript not available for video {video_id}. Please provide a video with captions.",
            "intent": "ERROR",
            "sources": [],
        }

    # Determine intent
    intent = get_intent(message, history)
    logger.info("Detected intent: %s", intent)

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

    # RAG mode
    retriever = build_self_query_retriever(vectorstore, processed["dynamic_k"])
    try:
        retrieved_docs = retriever.invoke(message)
    except Exception as e:
        logger.exception("Retrieval failed: %s", e)
        return {
            "response": "Error retrieving relevant documents.",
            "intent": "ERROR",
            "sources": [],
        }

    # Filter and format
    good_docs = [d for d in retrieved_docs if not is_low_quality_text(d.page_content)]
    context_text = "\n\n".join(
        [f"[{d.metadata['start']}s]: {d.page_content}" for d in good_docs]
    )
    timestamp = int(good_docs[0].metadata["start"]) if good_docs else 0

    history_str = "\n".join([f"{m.type}: {m.content}" for m in history.messages[-6:]])

    rag_chain = RAG_PROMPT | open_router_model | StrOutputParser()
    try:
        result = rag_chain.invoke(
            {
                "context": context_text,
                "question": message,
                "video_id": video_id,
                "seconds": timestamp,
                "chat_history": history_str,
                "video_summary": metadata.get("title", "this video"),
            }
        )
        history.add_user_message(message)
        history.add_ai_message(result)

        sources = [
            {"timestamp": d.metadata.get("start", 0), "video_id": video_id}
            for d in good_docs[:3]
        ]
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
        }

    if video_id not in session["summary_cache"]:
        session["summary_cache"][video_id] = _get_universal_summary(chunks, metadata)

    return {
        "summary": session["summary_cache"][video_id],
        "video_info": metadata,
    }


def compare_videos(session_id: str, url1: str, url2: str, question: str) -> dict:
    """Compare two videos using RAG evidence and metadata."""
    session = sessions[session_id]
    history = session["history"]

    proc_a = process_video(session_id, url1)
    proc_b = process_video(session_id, url2)

    meta_a, meta_b = proc_a["metadata"], proc_b["metadata"]
    vs_a, vs_b = proc_a["vectorstore"], proc_b["vectorstore"]

    if vs_a is None and vs_b is None:
        return {
            "response": "Transcripts missing for both videos. Cannot compare.",
            "intent": "ERROR",
        }

    # Retrieve evidence from both
    evidence_a_text = "No evidence available."
    evidence_b_text = "No evidence available."

    if vs_a:
        retr_a = build_self_query_retriever(vs_a, proc_a["dynamic_k"] or 5)
        try:
            docs_a = retr_a.invoke(question)
            evidence_a_text, _ = format_evidence(docs_a)
        except Exception:
            pass

    if vs_b:
        retr_b = build_self_query_retriever(vs_b, proc_b["dynamic_k"] or 5)
        try:
            docs_b = retr_b.invoke(question)
            evidence_b_text, _ = format_evidence(docs_b)
        except Exception:
            pass

    metadata_a_str = (
        f"video_id: {meta_a.get('video_id')}\n"
        f"title: {meta_a.get('title')}\n"
        f"channel: {meta_a.get('channel')}\n"
        f"date: {meta_a.get('date')}\n"
        f"description: {meta_a.get('description', '')[:400]}"
    )
    metadata_b_str = (
        f"video_id: {meta_b.get('video_id')}\n"
        f"title: {meta_b.get('title')}\n"
        f"channel: {meta_b.get('channel')}\n"
        f"date: {meta_b.get('date')}\n"
        f"description: {meta_b.get('description', '')[:400]}"
    )

    prompt_text = COMPARISON_PROMPT.format(
        user_question=question,
        metadata_a=metadata_a_str,
        metadata_b=metadata_b_str,
        evidence_a=evidence_a_text,
        evidence_b=evidence_b_text,
    )

    try:
        res = open_router_model.invoke(prompt_text)
        history.add_user_message(question)
        history.add_ai_message(res.content)
        return {
            "response": res.content,
            "intent": "COMPARE",
            "video_a": meta_a,
            "video_b": meta_b,
        }
    except Exception as e:
        logger.exception("Comparison failed: %s", e)
        return {"response": "Error during comparison.", "intent": "ERROR"}


# ─── Internal helpers ─────────────────────────────────────────
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
        Summarize this YouTube video professionally.
        Video Title: {title}

        Provide a concise 4-5 sentence overview followed by key takeaways in bullet points
        and mention all the key topics covered in the video.
        Don't include the youtube source link in the summary.

        VIDEO CONTENT:
        {final_text}
    """)
    return res.content
