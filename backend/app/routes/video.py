"""
API route endpoints for the ClipIQ backend.
"""

import logging
from fastapi import APIRouter, HTTPException

from app.schemas import (
    ProcessVideoRequest,
    ProcessVideoResponse,
    ChatRequest,
    ChatResponse,
    SummaryRequest,
    SummaryResponse,
    CompareRequest,
    CompareResponse,
    HealthResponse,
)
from app.rag.pipeline import (
    get_or_create_session,
    process_video,
    chat_with_video,
    summarize_video,
    compare_videos,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return {"status": "ok"}


@router.post("/process", response_model=ProcessVideoResponse)
async def process_video_endpoint(req: ProcessVideoRequest):
    """Process a YouTube video: fetch transcript, create embeddings."""
    try:
        session_id = get_or_create_session()
        result = process_video(session_id, req.url)

        metadata = result["metadata"]
        chunks = result["chunks"]

        return ProcessVideoResponse(
            session_id=session_id,
            video_id=result["video_id"],
            title=metadata.get("title", "Unknown"),
            channel=metadata.get("channel", "Unknown"),
            date=metadata.get("date", "Unknown"),
            description=metadata.get("description", ""),
            status="processed" if chunks else "no_transcript",
            chunk_count=len(chunks),
        )
    except Exception as e:
        logger.exception("Error processing video: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    """Chat with a processed video using RAG."""
    try:
        # Ensure session exists
        get_or_create_session(req.session_id)
        result = chat_with_video(req.session_id, req.video_url, req.message)
        return ChatResponse(**result)
    except Exception as e:
        logger.exception("Error in chat: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/summary", response_model=SummaryResponse)
async def summary_endpoint(req: SummaryRequest):
    """Get a full AI summary of a video."""
    try:
        get_or_create_session(req.session_id)
        result = summarize_video(req.session_id, req.video_url)
        return SummaryResponse(**result)
    except Exception as e:
        logger.exception("Error generating summary: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare", response_model=CompareResponse)
async def compare_endpoint(req: CompareRequest):
    """Compare two videos using RAG evidence and metadata."""
    try:
        get_or_create_session(req.session_id)
        result = compare_videos(req.session_id, req.url1, req.url2, req.question)
        return CompareResponse(**result)
    except Exception as e:
        logger.exception("Error comparing videos: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
