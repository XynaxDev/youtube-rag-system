"""
Pydantic request/response schemas for the API.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel


# ─── Requests ─────────────────────────────────────────────────
class ProcessVideoRequest(BaseModel):
    url: str
    session_id: Optional[str] = None


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


class CleanupRequest(BaseModel):
    session_id: Optional[str] = None
    video_urls: List[str] = []
    drop_persisted: bool = True
    drop_session: bool = False


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
    error_message: Optional[str] = None


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


class CleanupResponse(BaseModel):
    status: str
    removed_video_ids: List[str] = []
    removed_session_entries: int = 0
    removed_summary_entries: int = 0
    removed_starter_entries: int = 0
    removed_persisted_indexes: int = 0
    removed_transcript_caches: int = 0
    session_removed: bool = False


class HealthResponse(BaseModel):
    status: str
