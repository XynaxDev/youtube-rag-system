"""
Pydantic request/response schemas for the API.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel


# ─── Requests ─────────────────────────────────────────────────
class ProcessVideoRequest(BaseModel):
    url: str


class ChatRequest(BaseModel):
    session_id: str
    video_url: str
    message: str


class SummaryRequest(BaseModel):
    session_id: str
    video_url: str


class CompareRequest(BaseModel):
    session_id: str
    url1: str
    url2: str
    question: str = "Compare both videos and tell me which one is better for learning."
    study_mode: bool = False
    is_chat: Optional[bool] = None


class CheckTechnicalRequest(BaseModel):
    session_id: str
    url1: str
    url2: str


# ─── Responses ────────────────────────────────────────────────
class ProcessVideoResponse(BaseModel):
    session_id: str
    video_id: str
    title: str
    channel: str
    date: str
    description: str
    status: str
    chunk_count: int


class ChatResponse(BaseModel):
    response: str
    intent: str
    sources: List[Dict[str, Any]] = []


class SummaryResponse(BaseModel):
    summary: str
    video_info: Dict[str, str]
    starter_questions: List[str] = []


class CompareResponse(BaseModel):
    response: str
    intent: str
    video_a: Optional[Dict[str, str]] = None
    video_b: Optional[Dict[str, str]] = None
    study_mode: Optional[bool] = None


class CheckTechnicalResponse(BaseModel):
    is_technical: bool


class HealthResponse(BaseModel):
    status: str
