"""Policy routing helpers for chat intent and timestamp behavior."""

import logging
from typing import Literal

from pydantic import BaseModel, Field
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_community.chat_message_histories import ChatMessageHistory

from app.config import open_router_model

logger = logging.getLogger(__name__)


class ResponsePolicy(BaseModel):
    route: Literal["SUMMARY", "RAG", "CHAT"] = Field(
        description="Route for the user message: SUMMARY, RAG, or CHAT."
    )
    include_timestamps: bool = Field(
        default=False,
        description="Whether timestamp sources should be returned for this answer."
    )
    retrieval_focus: Literal["GENERAL", "PRECISE"] = Field(
        default="GENERAL",
        description="Use PRECISE when the question asks for exact factual details (numbers, durations, counts, dates, names)."
    )
    use_history: bool = Field(
        default=False,
        description="Whether prior chat history is needed to interpret the current user request."
    )


class AnswerSupport(BaseModel):
    status: Literal["SUPPORTED", "NOT_FOUND_OR_OUT_OF_SCOPE"] = Field(
        description="Whether the assistant answer is actually supported by video evidence for the user request."
    )


class MetaChatDecision(BaseModel):
    is_meta_chat: bool = Field(
        description="Whether the user message is conversational/meta-assistant and should bypass retrieval."
    )


def get_response_policy(query: str, history: ChatMessageHistory) -> ResponsePolicy:
    recent_history = "\n".join(
        [f"{m.type}: {m.content}" for m in history.messages[-4:]]
    )
    parser = PydanticOutputParser(pydantic_object=ResponsePolicy)

    router_instruction = """
    You are an expert response policy router for a YouTube assistant.
    Classify the new request and decide whether timestamps should be included.

    CONVERSATION HISTORY:
    {history}

    NEW REQUEST:
    {query}

    Output rules:
    - route=CHAT for conversational flow (gratitude, acknowledgement, greeting, short social follow-up).
    - route=CHAT for assistant-meta questions (capabilities/about-you/how-can-you-help/what-can-you-do).
      include_timestamps=false.
    - route=SUMMARY for broad overview requests of the whole video.
      include_timestamps=false.
    - route=RAG for specific video-grounded questions and factual follow-ups.
      include_timestamps=false by default.
    - For factual verification/claim-check requests (e.g., whether someone said/did something), set include_timestamps=true.
    - For specific segment explanation requests (explaining a quoted/pasted line or a concrete moment), set include_timestamps=true.
    - If the user asks for where/when/moment/timestamp/location-in-video, keep route=RAG and set include_timestamps=true.
    - If unclear, choose route=RAG and include_timestamps=false.
    - retrieval_focus=PRECISE when the request asks for exact factual detail (for example explicit quantities, durations, exact figures, counts, dates, strict verification, ordered/sequence facts, or exact "how much/how long/for how many" style asks in any language).
    - Otherwise retrieval_focus=GENERAL.
    - If the user asks for unrelated tasks outside this video (coding, debugging, math solving, translation, or general writing), choose route=CHAT.
    - use_history=true ONLY if the user explicitly refers to prior turns (for example: that/this/earlier/again/then with clear conversational reference).
    - For standalone questions, set use_history=false even if previous turns exist.

    {format_instructions}
    """

    prompt = PromptTemplate(
        template=router_instruction,
        input_variables=["history", "query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )

    chain = prompt | open_router_model | parser
    try:
        return chain.invoke({"history": recent_history, "query": query})
    except Exception as e:
        logger.exception("Policy router parsing error: %s. Defaulting to RAG/no timestamps.", e)
        return ResponsePolicy(route="RAG", include_timestamps=False, retrieval_focus="GENERAL", use_history=False)


def is_meta_chat_query(query: str) -> bool:
    """Model-driven classifier for conversational/meta queries that should not trigger retrieval."""
    parser = PydanticOutputParser(pydantic_object=MetaChatDecision)
    prompt = PromptTemplate(
        template="""
You are classifying a user message for a video Q&A assistant.

USER MESSAGE:
{query}

Mark is_meta_chat=true if this is primarily:
- social acknowledgement/chit-chat (thanks, okay, greetings, appreciation),
- assistant capability/about-you question (what can you do/how can you help),
- control flow chat that does not request specific video evidence.

Mark is_meta_chat=false if user asks for video facts, moments, timestamps, comparisons, or explanations grounded in video content.

Return only structured output.
{format_instructions}
""",
        input_variables=["query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    chain = prompt | open_router_model | parser
    try:
        return bool(chain.invoke({"query": query}).is_meta_chat)
    except Exception as e:
        logger.exception("Meta-chat classification error: %s. Defaulting to False.", e)
        return False


def classify_answer_support(question: str, answer: str, video_summary: str) -> AnswerSupport:
    """Classify whether an answer is supported by video evidence for source/timestamp emission."""
    parser = PydanticOutputParser(pydantic_object=AnswerSupport)
    prompt = PromptTemplate(
        template="""
You are validating whether an assistant answer is supported by a video's content.

VIDEO CONTEXT:
{video_summary}

USER QUESTION:
{question}

ASSISTANT ANSWER:
{answer}

Decision rules:
- SUPPORTED: answer provides concrete video-grounded information that addresses the user question.
- NOT_FOUND_OR_OUT_OF_SCOPE: answer says information is missing/not discussed OR question is unrelated to this video scope.

Return only the structured output.
{format_instructions}
""",
        input_variables=["video_summary", "question", "answer"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )

    chain = prompt | open_router_model | parser
    try:
        return chain.invoke(
            {
                "video_summary": video_summary,
                "question": question,
                "answer": answer,
            }
        )
    except Exception as e:
        logger.exception("Answer support classification error: %s. Defaulting to SUPPORTED.", e)
        return AnswerSupport(status="SUPPORTED")
