/**
 * ClipIQ API Service Layer
 * Handles all communication with the FastAPI backend.
 */

const API_BASE = import.meta.env.VITE_API_URL || "";
const GENERIC_SERVER_ERROR = "We have some server issue. We will get back soon.";

// ─── Types ───────────────────────────────────────────────────

export interface ProcessVideoResponse {
  session_id: string;
  video_id: string;
  title: string;
  channel: string;
  date: string;
  description: string;
  status: string;
  chunk_count: number;
}

export interface ChatResponse {
  response: string;
  intent: string;
  sources: Array<{ timestamp: number; video_id: string }>;
}

export interface SummaryResponse {
  summary: string;
  video_info: {
    video_id: string;
    title: string;
    channel: string;
    date: string;
    description: string;
  };
  starter_questions: string[];
}

export interface CompareResponse {
  response: string;
  intent: string;
  video_a?: Record<string, string>;
  video_b?: Record<string, string>;
  study_mode?: boolean;
}

export interface CheckTechnicalResponse {
  is_technical: boolean;
}

// ─── API Functions ───────────────────────────────────────────

async function apiFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
      console.error("API request failed", { endpoint, status: res.status, detail: errorData.detail });
      throw new Error(GENERIC_SERVER_ERROR);
    }

    return res.json();
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_SERVER_ERROR) {
      throw error;
    }
    console.error("Network/API error", { endpoint, error });
    throw new Error(GENERIC_SERVER_ERROR);
  }
}

/**
 * Process a YouTube video — fetch transcript, create embeddings.
 */
export async function processVideo(url: string): Promise<ProcessVideoResponse> {
  return apiFetch<ProcessVideoResponse>("/api/process", { url });
}

/**
 * Chat with a processed video using RAG.
 */
export async function chatWithVideo(
  sessionId: string,
  videoUrl: string,
  message: string
): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    session_id: sessionId,
    video_url: videoUrl,
    message,
  });
}

/**
 * Get a full AI summary of a video.
 */
export async function summarizeVideo(
  sessionId: string,
  videoUrl: string
): Promise<SummaryResponse> {
  return apiFetch<SummaryResponse>("/api/summary", {
    session_id: sessionId,
    video_url: videoUrl,
  });
}

/**
 * Compare two videos.
 */
export async function compareVideos(
  sessionId: string,
  url1: string,
  url2: string,
  question: string = "Compare both videos and tell me which one is better for learning.",
  studyMode: boolean = false,
  isChat: boolean = false
): Promise<CompareResponse> {
  return apiFetch<CompareResponse>("/api/compare", {
    session_id: sessionId,
    url1,
    url2,
    question,
    study_mode: studyMode,
    is_chat: isChat,
  });
}

export async function checkTechnicalVideos(
  sessionId: string,
  url1: string,
  url2: string
): Promise<CheckTechnicalResponse> {
  return apiFetch<CheckTechnicalResponse>("/api/check-technical", {
    session_id: sessionId,
    url1,
    url2,
  });
}

/**
 * Health check.
 */
export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/health`);
  return res.json();
}
