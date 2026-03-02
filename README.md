# 🎬 ClipIQ — YouTube Video Intelligence Engine

<p align="center">
  <strong>AI-powered YouTube video analysis using RAG (Retrieval-Augmented Generation)</strong>
</p>

ClipIQ extracts transcripts from YouTube videos, builds semantic search indexes, and lets you ask questions, get summaries, and compare videos — all powered by LLMs and vector search.

---

## ✨ Features

- **🎯 Single-Video RAG** — Ask any question about a video and get timestamp-linked answers
- **🔄 Dual-Video Comparison** — Compare two videos side-by-side with AI analysis
- **📝 AI Summaries** — Get instant video summaries with key takeaways
- **💬 Chat Interface** — Conversational follow-ups with context memory
- **🌍 Multilingual** — Supports 15+ languages via YouTube's transcript API
- **⚡ Smart Chunking** — Adaptive chunk sizing based on video length
- **🛡️ Safe Embeddings** — Handles garbled captions and NaN vectors gracefully

## 🏗️ Architecture

```
YoutubeRAGSystem/
├── backend/          # FastAPI server
│   ├── app/
│   │   ├── config.py        # Environment & model configuration
│   │   ├── schemas.py       # Pydantic request/response models
│   │   ├── rag/
│   │   │   ├── embeddings.py  # SafeOllamaEmbeddings + validation
│   │   │   ├── transcript.py  # YouTube transcript & metadata
│   │   │   ├── retriever.py   # Vector store & self-query retriever
│   │   │   └── pipeline.py    # RAG orchestration & session mgmt
│   │   └── routes/
│   │       └── video.py       # API endpoints
│   └── main.py              # FastAPI entry point
├── frontend/         # React + Vite + Tailwind v4
│   └── src/
│       ├── pages/           # Landing, Dashboard, Summarize, Compare
│       ├── components/      # Sidebar, Layout, BottomNav
│       └── lib/api.ts       # Backend API client
├── notebooks/        # Jupyter notebooks (core logic reference)
│   ├── singleVideo.ipynb
│   └── multiVideo.ipynb
└── .env.example      # Environment template
```

## 🚀 Quick Start

### Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **Ollama** with `bge-m3` model: `ollama pull bge-m3`
- API keys: OpenRouter, Google (YouTube Data API v3)

### 1. Clone & configure

```bash
git clone https://github.com/XynaxDev/youtube-rag-system.git
cd YoutubeRAGSystem
cp .env.example backend/.env
# Edit backend/.env with your API keys
```

### 2. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/process` | Process a YouTube video |
| `POST` | `/api/chat` | Chat with a processed video |
| `POST` | `/api/summary` | Get video summary |
| `POST` | `/api/compare` | Compare two videos |

## 🔧 Tech Stack

**Backend:** FastAPI · LangChain · ChromaDB · Ollama (BGE-M3) · OpenRouter LLM  
**Frontend:** React 19 · Vite 6 · Tailwind CSS v4 · Lucide Icons · Framer Motion  
**AI/ML:** Self-Query Retriever · RAG Pipeline · Intent Routing · Safe Embedding Wrapper

## 📓 Notebooks

The `notebooks/` directory contains Jupyter notebooks showing the core RAG logic:
- `singleVideo.ipynb` — Single-video transcript → embeddings → Q&A pipeline
- `multiVideo.ipynb` — Dual-video comparison with metadata + evidence analysis

## 📝 License

Open Source — MIT License
