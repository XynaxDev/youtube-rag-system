"""Dedicated multi-video compare service orchestration."""

import logging
from typing import Optional

from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from app.config import open_router_model
from app.rag.multi_video_pipeline import (
    run_multi_video_pipeline,
    check_technical_videos_internal,
)
from app.rag.pipeline import process_video, sessions
from app.rag.policy_helpers import get_response_policy, is_meta_chat_query

logger = logging.getLogger(__name__)


COMPARE_CHAT_PROMPT = PromptTemplate(
    template="""
    You are a conversational assistant for a dual-video comparison workspace.

    VIDEO A TITLE:
    {video_a_title}

    VIDEO B TITLE:
    {video_b_title}

    CHAT HISTORY:
    {chat_history}

    USER MESSAGE:
    {question}

    Rules:
    - Reply naturally and briefly (1-2 short lines).
    - Do not include timestamps, source labels, links, or markdown headers.
    - If message is acknowledgement/thanks/greeting, reply warmly and concise.
    - If user asks unrelated tasks (coding/math/etc), say you can help only with these videos and ask a video-focused follow-up.
    - Use the same language as the user.
    """,
    input_variables=["video_a_title", "video_b_title", "chat_history", "question"],
)


def compare_videos(
    session_id: str,
    url1: str,
    url2: str,
    question: str,
    study_mode: bool = False,
    is_chat: Optional[bool] = None,
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
        is_chat_mode = is_chat if is_chat is not None else len(history.messages) > 0
        if is_chat_mode:
            policy = get_response_policy(question, history)
            force_meta_chat = is_meta_chat_query(question)
            if policy.route == "CHAT" or force_meta_chat:
                history_str = (
                    "\n".join([f"{m.type}: {m.content}" for m in history.messages[-6:]])
                    if policy.use_history
                    else ""
                )
                chat_chain = COMPARE_CHAT_PROMPT | open_router_model | StrOutputParser()
                chat_result = chat_chain.invoke(
                    {
                        "video_a_title": proc_a.get("metadata", {}).get("title", "Video A"),
                        "video_b_title": proc_b.get("metadata", {}).get("title", "Video B"),
                        "chat_history": history_str,
                        "question": question,
                    }
                )
                history.add_user_message(question)
                history.add_ai_message(chat_result)
                return {
                    "response": chat_result,
                    "intent": "COMPARE",
                    "video_a": proc_a.get("metadata", {}),
                    "video_b": proc_b.get("metadata", {}),
                    "study_mode": study_mode,
                }

        result = run_multi_video_pipeline(
            proc_a, proc_b, question, study_mode=study_mode, is_chat=is_chat_mode
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

