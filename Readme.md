# Smart MoM

The AI-powered meeting intelligence platform — record, transcribe, summarise, and chat with your meetings.

[![Backend](https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2014-black?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Node](https://img.shields.io/badge/node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/database-MongoDB%20Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)
[![Redis](https://img.shields.io/badge/broker-Redis%207-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![OpenAI](https://img.shields.io/badge/AI-GPT--4o-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com)
[![Qdrant](https://img.shields.io/badge/vector--db-Qdrant-FF4B4B?style=flat-square&logo=qdrant&logoColor=white)](https://qdrant.tech)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![AWS S3](https://img.shields.io/badge/storage-AWS%20S3-FF9900?style=flat-square&logo=amazon-s3&logoColor=white)](https://aws.amazon.com/s3)
[![FFmpeg](https://img.shields.io/badge/audio-ffmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![version](https://img.shields.io/badge/version-3.0.0-brightgreen?style=flat-square)](https://github.com)
[![docs](https://img.shields.io/badge/docs-Swagger%20UI-85EA2D?logo=swagger&logoColor=black)](https://beside-hiking-billion-count.trycloudflare.com/docs)
[![redoc](https://img.shields.io/badge/docs-ReDoc-8A2BE2?logo=readme&logoColor=white)](https://beside-hiking-billion-count.trycloudflare.com/redoc)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![version](https://img.shields.io/badge/version-3.0.0-brightgreen)](https://github.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com)

[![Frontend](https://img.shields.io/badge/🌐%20Frontend%20Link-Click%20Here-0078D4?style=flat-square)](https://beside-hiking-billion-count.trycloudflare.com)
[![Backend API](https://img.shields.io/badge/⚙️%20Backend%20Link-Click%20Here-009688?style=flat-square)](https://instant-jenny-occupational-nutten.trycloudflare.com)
[![Swagger Docs](https://img.shields.io/badge/📖%20Swagger%20UI-/docs-85EA2D?style=flat-square)](https://instant-jenny-occupational-nutten.trycloudflare.com/docs)
[![ReDoc](https://img.shields.io/badge/📄%20ReDoc-/redoc-8A2BE2?style=flat-square)](https://instant-jenny-occupational-nutten.trycloudflare.com/redoc)
[![Mobile App](https://img.shields.io/badge/📱%20Mobile%20App-Download%20APK-34A853?style=flat-square&logo=google-drive&logoColor=white)](https://drive.google.com/file/d/1l-tRbB9faUegjjlWR9hwVsLwf2iIZ1Jp/view?usp=drive_link)

[Architecture](#architecture-overview) | [Backend](#backend) | [Frontend](#frontend) | [API Reference](#api-reference) | [Authentication](#authentication) | [Deployment](#deployment)

---------------------------------------------

**Stack:** FastAPI · Next.js 14 · MongoDB Atlas · Redis · Celery · OpenAI GPT-4o · Qdrant · AWS S3 · ffmpeg<br>
**Platforms:** Web Browser · Mobile (iOS/Android via expo-audio)

---------------------------------------------

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Repository Structure](#repository-structure)
4. [Backend](#backend)
   - [Prerequisites](#backend-prerequisites)
   - [Environment Variables](#backend-environment-variables)
   - [Running Locally (without Docker)](#running-locally-without-docker)
   - [Running with Docker Compose](#running-with-docker-compose)
   - [API Reference](#api-reference)
   - [Audio Storage Backends](#audio-storage-backends)
   - [Audio Chunk Merging](#audio-chunk-merging)
   - [Background Task Queues](#background-task-queues)
   - [Error Logging](#error-logging)
   - [Project Structure](#backend-project-structure)
   - [Detailed Architecture Diagram](#detailed-architecture-diagram)
5. [Frontend](#frontend)
   - [Prerequisites](#frontend-prerequisites)
   - [Environment Variables](#frontend-environment-variables)
   - [Running Locally](#running-locally)
   - [Running with Docker](#running-with-docker)
   - [Pages & Features](#pages--features)
   - [State Management](#state-management)
   - [Project Structure](#frontend-project-structure)
6. [Authentication](#authentication)
7. [Deployment](#deployment)
8. [System Dependencies](#system-dependencies)
9. [Known Limitations](#known-limitations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Clients                            │
│   Web Browser (Next.js :3015)  │  Mobile App (Expo)     │
└────────────────┬────────────────┴──────────┬────────────┘
                 │  REST + SSE               │  REST
                 ▼                           ▼
┌────────────────────────────────────────────────────────┐
│              FastAPI Backend  (:3014)                   │
│  Auth · Meetings · Chat · Diagrams · Admin · Stats      │
└──────┬────────────┬──────────────────┬─────────────────┘
       │            │                  │
       ▼            ▼                  ▼
  MongoDB Atlas   Redis          Celery Workers
  (data store)  (broker +     (llm-generate /
                 blacklist)    embed-chunks /
                               diagram-gen)
                    │
          ┌─────────┼──────────┐
          ▼         ▼          ▼
       OpenAI    Qdrant     AWS S3
     (GPT-4o /  Cloud     (audio files)
      Embeddings) (vector DB)
```

**Request flow for a meeting:**

1. Client records audio and uploads chunks via `POST /api/v1/meetings/{id}/chunks`
2. Client calls `POST /api/v1/meetings/{id}/merge-chunks` when recording ends
3. Backend detects audio format (WebM or MP4) and merges correctly using ffmpeg (mobile) or naive concat (web)
4. A separate transcription service sends the transcript via `PATCH /api/v1/meetings/{id}`
5. Backend automatically indexes the transcript into Qdrant for RAG
6. User generates MoM / Summary / Key Points / Diagram on demand via `POST /api/v1/meetings/{id}/generate/{type}`
7. User chats with their meetings via the streaming `POST /api/chat` SSE endpoint

---

## Technology Stack

### Backend
| Component | Technology |
|-----------|-----------|
| API Framework | FastAPI 0.x (Python 3.11) |
| ASGI Server | Uvicorn with standard extras |
| Database | MongoDB Atlas (Motor async driver) |
| Cache / Broker | Redis 7 |
| Task Queue | Celery |
| AI / LLM | OpenAI GPT-4o, GPT-4o-mini |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Vector Store | Qdrant Cloud |
| Audio Storage | AWS S3 (IAM role) or Local Filesystem |
| Audio Merging | ffmpeg (system binary) |
| Auth | JWT (python-jose) + Argon2 password hashing |
| OAuth | Google OAuth 2.0 |
| Containerisation | Docker + Docker Compose |

### Frontend
| Component | Technology |
|-----------|-----------|
| Framework | Next.js 14.2 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v3 |
| Auth | NextAuth v5 (beta) |
| Server State | TanStack React Query v5 |
| Client State | Redux Toolkit v2 |
| HTTP Client | Axios |
| Diagrams | Mermaid.js v11 |
| Icons | Lucide React |
| Toasts | React Hot Toast |

---

## Repository Structure

```
jitamxb-int-meetmind-final-v1/
├── backend/
│   ├── Dockerfile
│   ├── Dockerfile.celery
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── .env.example
│   ├── .dockerignore
│   └── app/
│       ├── main.py
│       ├── auth/
│       │   ├── jwt.py
│       │   └── routes.py
│       ├── core/
│       │   ├── audio_merge.py
│       │   ├── config.py
│       │   ├── s3_utils.py
│       │   └── storage.py
│       ├── db/
│       │   ├── database.py
│       │   ├── qdrant_client.py
│       │   └── redis_client.py
│       ├── models/
│       │   ├── meeting.py
│       │   ├── serializers.py
│       │   └── user.py
│       ├── routes/
│       │   ├── admin.py
│       │   ├── chat.py
│       │   ├── diagrams.py
│       │   ├── meetings.py
│       │   └── stats.py
│       └── worker/
│           ├── celery_app.py
│           └── tasks/
│               ├── diagram_gen.py
│               ├── embed_chunks.py
│               └── llm_generate.py
│
└── frontend/
    ├── Dockerfile
    ├── next.config.js
    ├── package.json
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── .env.local.example
    └── src/
        ├── auth.ts
        ├── middleware.ts
        ├── app/
        │   ├── api/auth/[...nextauth]/route.ts
        │   ├── auth/callback/page.tsx
        │   ├── auth/error/page.tsx
        │   ├── dashboard/
        │   │   ├── admin/page.tsx
        │   │   ├── chat/page.tsx
        │   │   ├── layout.tsx
        │   │   ├── meetings/[id]/page.tsx
        │   │   ├── meetings/page.tsx
        │   │   ├── page.tsx
        │   │   └── record/page.tsx
        │   ├── login/page.tsx
        │   ├── globals.css
        │   ├── layout.tsx
        │   └── providers.tsx
        ├── components/
        │   ├── chat/ChatInterface.tsx
        │   ├── diagram/MermaidRenderer.tsx
        │   └── layout/Sidebar.tsx
        ├── hooks/
        │   ├── useChatStream.ts
        │   ├── useDiagramStatus.ts
        │   ├── useMeetings.ts
        │   └── useNavPrefetch.ts
        ├── lib/
        │   └── api.ts
        ├── store/
        │   ├── hooks.ts
        │   ├── index.ts
        │   └── slices/
        │       ├── meetingsSlice.ts
        │       ├── sessionSlice.ts
        │       └── uiSlice.ts
        └── types/
            └── index.ts
```

---

## Backend

### Backend Prerequisites

- Python 3.11+
- Redis 7 (local or remote)
- MongoDB Atlas account (free tier works)
- Qdrant Cloud account (free tier works)
- OpenAI API key
- AWS account with S3 bucket (or use local storage mode)
- Google Cloud project with OAuth 2.0 credentials
- **ffmpeg** installed on the host (required for mobile audio merging)
  ```bash
  # Ubuntu / Debian
  sudo apt-get install -y ffmpeg

  # macOS
  brew install ffmpeg
  ```

---

### Backend Environment Variables

Copy `.env.example` to `.env` and fill in every value:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | ✅ | — | MongoDB Atlas connection string |
| `MONGO_DB_NAME` | ❌ | `meetmind` | Database name |
| `REDIS_URL` | ❌ | `redis://localhost:6379/0` | Redis connection URL |
| `JWT_SECRET` | ✅ | — | Random 64-char secret for signing JWTs |
| `JWT_ALGORITHM` | ❌ | `HS256` | JWT signing algorithm |
| `JWT_EXPIRE_DAYS` | ❌ | `7` | Token validity in days |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | ✅ | — | e.g. `http://localhost:3014/auth/google/callback` |
| `OPENAI_API_KEY` | ✅ | — | OpenAI API key (`sk-...`) |
| `AWS_DEFAULT_REGION` | ❌ | `ap-south-1` | AWS region for S3 |
| `S3_BUCKET` | ❌ | `vyom-backend-1` | S3 bucket name |
| `QDRANT_URL` | ✅ | — | Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | ✅ | — | Qdrant Cloud API key |
| `QDRANT_COLLECTION` | ❌ | `Transcript-mom` | Qdrant collection name |
| `EMBEDDING_MODEL` | ❌ | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | ❌ | `1536` | Embedding vector dimensions |
| `CHUNK_SIZE_TOKENS` | ❌ | `500` | RAG chunk size in tokens |
| `CHUNK_OVERLAP_TOKENS` | ❌ | `50` | RAG chunk overlap in tokens |
| `AUDIO_STORAGE_BACKEND` | ❌ | `s3` | `s3` or `local` |
| `AUDIO_LOCAL_PATH` | ❌ | `./audio_files` | Path for local audio storage |
| `CORS_ORIGINS` | ❌ | `http://localhost:3015,http://localhost:3002` | Comma-separated allowed origins |
| `BACKEND1_HMAC_SECRET` | ❌ | — | HMAC secret for transcript callback verification |
| `ENVIRONMENT` | ❌ | `production` | `development` or `production` |
| `ERROR_LOG_TTL_HOURS` | ❌ | `72` | How long captured `error_logs` documents live before MongoDB's TTL index auto-deletes them |

> **AWS Authentication:** The backend uses IAM instance roles on EC2 — no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` are needed or should be stored. On local development with local storage mode, AWS credentials are not required at all.

---

### Running Locally (without Docker)

```bash
cd backend

# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate       # Linux / macOS
# .venv\Scripts\activate        # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in all required values

# 4. Start Redis (if not already running)
redis-server &

# 5. Start the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 3014 --reload

# 6. Start the Celery worker (separate terminal)
celery -A app.worker.celery_app.celery_app worker \
  --queues=llm-generate,embed-chunks,diagram-gen \
  --loglevel=info \
  --concurrency=2
```

The API will be available at `http://localhost:3014`.<br>
Interactive Swagger docs: `http://localhost:3014/docs`<br>
ReDoc documentation: `http://localhost:3014/redoc`

---

### Running with Docker Compose

```bash
cd backend

# 1. Configure environment
cp .env.example .env
# Edit .env and fill in all required values

# 2. Deploy using the automated bash script (stops old containers, rebuilds cleanly, prunes cache)
sh deploy_backend.sh

# Or manage it manually with Docker Compose:
docker compose -f docker-compose-backend.yml up -d --build

# 3. View logs
docker compose -f docker-compose-backend.yml logs -f

# 4. Stop all services
docker compose -f docker-compose-backend.yml down
```

**Docker Compose services:**

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| `api` | `smart-mom-api` | `3014` | FastAPI REST API |
| `worker`| `smart-mom-worker` | — | Background Celery task worker |
| `redis` | `smart-mom-redis` | `6379` | Celery broker + JWT blacklist |

> MongoDB Atlas and Qdrant Cloud are external services configured via `.env`.

> **Important:** Always use `--build` when restarting after code or Dockerfile changes:
> ```bash
> docker compose -f docker-compose-backend.yml down && docker compose -f docker-compose-backend.yml up -d --build
> ```

---

### API Reference

All endpoints require `Authorization: Bearer <token>` unless otherwise noted.

> **Live API Docs:**
> - Swagger UI: [https://beside-hiking-billion-count.trycloudflare.com/docs](https://beside-hiking-billion-count.trycloudflare.com/docs)
> - ReDoc: [https://beside-hiking-billion-count.trycloudflare.com/redoc](https://beside-hiking-billion-count.trycloudflare.com/redoc)

#### Authentication — `/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | Public | Register with email + password |
| `POST` | `/auth/login` | Public | Sign in with email + password |
| `GET` | `/auth/google` | Public | Initiate Google OAuth flow |
| `GET` | `/auth/google/callback` | Public | Google OAuth redirect handler |
| `POST` | `/auth/google/token` | Public | Exchange Google ID token (NextAuth) |
| `POST` | `/auth/refresh` | 🔐 User | Re-issue a fresh JWT |
| `POST` | `/auth/logout` | 🔐 User | Blacklist the current token |
| `GET` | `/auth/me` | 🔐 User | Get current user profile |

#### Meetings — `/api/v1/meetings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/meetings/` | 🔐 User | Create a new meeting record |
| `GET` | `/api/v1/meetings/` | 🔐 User | List meetings (paginated) |
| `GET` | `/api/v1/meetings/{id}` | 🔐 User | Get a single meeting |
| `PATCH` | `/api/v1/meetings/{id}` | 🔐 User | Update meeting (add transcript, etc.) |
| `DELETE` | `/api/v1/meetings/{id}` | 🔐 User | Delete meeting + audio + vectors |
| `POST` | `/api/v1/meetings/presigned-upload` | 🔐 User | Get S3 presigned PUT URL |
| `POST` | `/api/v1/meetings/upload-audio` | 🔐 User | Direct audio upload (local storage) |
| `GET` | `/api/v1/meetings/stream-audio` | 🔐 User | Stream local audio file |
| `POST` | `/api/v1/meetings/{id}/chunks` | 🔐 User | Upload one audio chunk |
| `POST` | `/api/v1/meetings/{id}/merge-chunks` | 🔐 User | Merge all chunks into final audio |
| `GET` | `/api/v1/meetings/{id}/audio-url` | 🔐 User | Get playable/downloadable audio URL |
| `GET` | `/api/v1/meetings/{id}/download-audio` | Token | Download audio (signed URL, no Bearer) |
| `POST` | `/api/v1/meetings/{id}/generate/{type}` | 🔐 User | Generate `mom` / `summary` / `key_points` / `diagram` |

#### Chat — `/api/chat`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat` | 🔐 User | Stream AI chat response (SSE) |
| `GET` | `/api/chat/meetings` | 🔐 User | List RAG-indexed meetings for selector |
| `GET` | `/api/chat/meetings/by-user/{uid}` | 🔐 Admin | List meetings for a specific user |
| `GET` | `/api/chat/history/{meeting_id}` | 🔐 User | Get chat session history |
| `DELETE` | `/api/chat/history/session/{id}` | 🔐 User | Delete a chat session |
| `GET` | `/api/chat/status/{meeting_id}` | 🔐 User | Get RAG index status |
| `POST` | `/api/chat/reindex/{meeting_id}` | 🔐 Admin | Force re-index a meeting |

#### Diagrams — `/api/meetings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/meetings/{id}/diagram` | 🔐 User | Get diagram status and Mermaid syntax |
| `POST` | `/api/meetings/{id}/diagram/regenerate` | 🔐 User | Re-trigger diagram generation |

#### Stats — `/api/v1`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/stats` | 🔐 User | Get meeting counts for current user |
| `GET` | `/api/v1/admin/stats` | 🔐 Admin | Get platform-wide stats |

#### Admin — `/api/v1/admin`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/admin/users` | 🔐 Admin | List all users (paginated) |
| `PATCH` | `/api/v1/admin/users/{id}/role` | 🔐 Admin | Promote / demote user role |
| `DELETE` | `/api/v1/admin/users/{id}` | 🔐 Admin | Delete user and all their data |
| `GET` | `/api/v1/admin/meetings` | 🔐 Admin | List all meetings across all users |
| `GET` | `/api/v1/admin/system-config/storage` | 🔐 Admin | Get active audio storage backend |
| `PUT` | `/api/v1/admin/system-config/storage` | 🔐 Admin | Switch audio storage backend |
| `POST` | `/api/v1/admin/meetings/index-unindexed` | 🔐 Admin | Bulk-index all unindexed meetings |
| `GET` | `/api/v1/admin/meetings/next-pending` | 🔐 Admin | Get oldest meeting awaiting processing |
| `GET` | `/api/v1/admin/meetings/stuck-chunked` | 🔐 Admin | List meetings stuck in chunked state |
| `GET` | `/api/v1/admin/error-logs` | 🔐 Admin | List captured error logs (paginated, filterable by module/source/status/search/date) |
| `GET` | `/api/v1/admin/error-logs/{id}` | 🔐 Admin | Get full detail for one error log, including untruncated traceback |
| `DELETE` | `/api/v1/admin/error-logs/{id}` | 🔐 Admin | Delete a single error log entry |
| `DELETE` | `/api/v1/admin/error-logs` | 🔐 Admin | Bulk-clear all captured error logs |

#### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | Public | Service health check |

---

### Audio Storage Backends

The backend supports two audio storage modes, switchable at runtime without a restart:

**S3 Mode (default)**
- Audio uploaded directly from browser to S3 via presigned PUT URLs
- Playback via presigned GET URLs (1-hour expiry)
- Requires AWS IAM instance role (no access keys in code)
- Set `AUDIO_STORAGE_BACKEND=s3`

**Local Mode**
- Audio stored on the server filesystem at `AUDIO_LOCAL_PATH`
- Served via `GET /api/v1/meetings/stream-audio` with HMAC-signed tokens
- Useful for development or air-gapped environments
- Set `AUDIO_STORAGE_BACKEND=local`

The active backend can be toggled by an admin in the Admin Panel or via `PUT /api/v1/admin/system-config/storage`. The selection is persisted to MongoDB and survives restarts.

---

### Audio Chunk Merging

The backend automatically detects the audio format of uploaded chunks and applies the correct merge strategy:

| Source | Format | Detection | Merge Strategy |
|--------|--------|-----------|----------------|
| Web (MediaRecorder) | WebM/Opus EBML streaming segments | First 4 bytes = `0x1A 0x45 0xDF 0xA3` | Naive byte concatenation |
| Mobile (expo-audio) | Self-contained MP4/AAC files | Bytes 4–8 = `ftyp` | ffmpeg concat demuxer (lossless re-mux) |

**Why naive concat fails for mobile:** Each mobile chunk is a complete MP4 file with its own `moov` box containing absolute file offsets. Concatenating them produces a file where only chunk 0's `moov` is read, yielding only the first 30 seconds of audio. ffmpeg's concat demuxer re-muxes all chunks with corrected timestamps without re-encoding.

**ffmpeg is required** for mobile audio merging. If not installed, the backend logs a prominent `ERROR` and falls back to naive concat with degraded output. See [System Dependencies](#system-dependencies).

---

### Background Task Queues

Celery processes three queues, each handled by a separate task module:

| Queue | Module | Trigger | Description |
|-------|--------|---------|-------------|
| `llm-generate` | `tasks/llm_generate.py` | Manual | Generate MoM, Summary, Key Points via GPT-4o |
| `embed-chunks` | `tasks/embed_chunks.py` | Auto on transcript | Chunk transcript, embed with text-embedding-3-small, upsert to Qdrant |
| `diagram-gen` | `tasks/diagram_gen.py` | Manual | Classify meeting structure, generate Mermaid.js diagram |

> **Note:** In the current implementation, AI generation (MoM, summary, diagrams) runs **synchronously inline** in the FastAPI request handler via `POST /api/v1/meetings/{id}/generate/{type}`. The Celery tasks exist for background processing but generation endpoints are the primary path.

---

### Error Logging

Every unhandled exception, plus a number of previously "swallowed" `except Exception` blocks across the routes and Celery tasks (best-effort cleanup, non-fatal indexing/upload failures, etc.), are persisted to a dedicated `error_logs` MongoDB collection via `app/core/error_logger.py`'s `log_error()` helper — surfaced in the frontend's **Admin → Error Logs** tab.

- **Auto-derived location:** `log_error()` walks the exception's traceback to find the deepest frame inside `backend/app/`, so each document records the exact `module`, `function`, `file_path`, and `line_number` where the error actually occurred — no need to pass these manually at each call site.
- **Captured fields:** exception type/message, full traceback, the originating HTTP method/path/status code (when applicable), the requesting user's `user_id`/`user_email`, a `source` tag (`http_exception_handler` for the global handler, `manual:<tag>` for an explicitly instrumented call site), and free-form `context`.
- **Works from both async and sync callers:** the same `log_error()` call is safe to use from FastAPI routes (async Motor `db`) and from Celery tasks (sync pymongo `db`) — it detects which one it received automatically.
- **Never blocks or crashes the caller:** logging failures are swallowed internally and never propagate, and the Mongo insert runs as a fire-and-forget `asyncio.create_task` in async contexts so it never adds latency to the response.
- **Auto-expiry:** a MongoDB TTL index on `timestamp` deletes documents automatically after `ERROR_LOG_TTL_HOURS` (default 72h). Changing the value requires a backend restart — `connect_db()` reconciles the index via `collMod` on every startup so the new TTL takes effect.

---

### Backend Project Structure

```
app/
├── main.py              — FastAPI app, middleware, lifespan startup
├── auth/
│   ├── jwt.py           — Token creation, validation, blacklist check
│   └── routes.py        — Register, login, Google OAuth, logout, /me
├── core/
│   ├── audio_merge.py   — Format detection + ffmpeg/naive merge logic
│   ├── config.py        — Pydantic settings (reads from .env)
│   ├── error_logger.py  — log_error() helper: persists exceptions to error_logs
│   ├── s3_utils.py      — S3 presigned URL helpers
│   └── storage.py       — Storage abstraction (S3 / Local)
├── db/
│   ├── database.py      — Motor async MongoDB client + index setup
│   ├── qdrant_client.py — Qdrant client + collection setup
│   └── redis_client.py  — Async Redis client
├── models/
│   ├── meeting.py       — Pydantic models (Meeting, Transcript, Diagram, Chat)
│   ├── serializers.py   — MongoDB → API-safe dict conversion
│   └── user.py          — User request/response schemas
├── routes/
│   ├── admin.py         — Admin-only endpoints
│   ├── chat.py          — SSE chat + meeting selector
│   ├── diagrams.py      — Diagram status + regeneration
│   ├── meetings.py      — Full meeting CRUD + audio pipeline
│   └── stats.py         — Aggregated stats endpoints
└── worker/
    ├── celery_app.py    — Celery app + queue routing config
    └── tasks/
        ├── diagram_gen.py   — GPT-4o diagram generation task
        ├── embed_chunks.py  — RAG embedding task
        └── llm_generate.py  — MoM / Summary / Key Points task
```

---

### Detailed Architecture Diagram

**1. Request flow — clients through the API to every data store and external service**

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENTS                                     │
│         Web Browser (Next.js :3015)          │        Mobile App (Expo)       │
└─────────────────────┬───────────────────────────┴──────────────┬──────────────┘
                       │  REST + SSE (Bearer JWT)                 │  REST (Bearer JWT)
                       ▼                                          ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend — app/main.py   (:3014)                   │
│                                                                                 │
│   CORSMiddleware  ──▶  OPTIONS preflight short-circuit  ──▶  Router dispatch   │
│                                                                     │           │
│                                                                     ▼           │
│                              ┌──────────────────────────────────────────────┐  │
│                              │  @app.exception_handler(Exception)            │  │
│                              │  logger.error(exc_info=True)                  │  │
│                              │       │                                       │  │
│                              │       ▼                                       │  │
│                              │  core/error_logger.log_error(exc, get_db(),   │  │
│                              │      request=request,                        │  │
│                              │      source="http_exception_handler")        │  │
│                              └──────────────────────────────────────────────┘  │
└───┬────────┬─────────┬─────────┬─────────┬─────────┬─────────┬────────────────┘
    │        │         │         │         │         │         │
    ▼        ▼         ▼         ▼         ▼         ▼         ▼
  auth/   routes/   routes/   routes/   routes/   routes/   routes/bot_recording.py
  routes  meetings  chat      diagrams  stats     admin     routes/bot_setup.py
  .py     .py       .py       .py       .py       .py       routes/processing.py
    │        │         │         │         │         │         │
    ▼        ▼         ▼         ▼         ▼         ▼         ▼
┌──────────────────┐  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│  MongoDB Atlas    │  │  Redis             │  │  Qdrant Cloud      │  │  AWS S3            │
│  (Motor, async)   │  │  JWT blacklist +   │  │  Vector store      │  │  audio files       │
│                   │  │  Celery broker     │  │  (RAG embeddings)  │  │  (or local disk)   │
│  users            │  └─────────┬──────────┘  └───────────────────┘  └───────────────────┘
│  meetings         │            │
│  chat_sessions    │            ▼
│  audio_chunks     │   Celery Workers  (worker/celery_app.py)
│  processing_queue │     queue  llm-generate   ──▶ OpenAI GPT-4o
│  system_config    │     queue  embed-chunks   ──▶ OpenAI Embeddings
│  error_logs (TTL) │     queue  diagram-gen    ──▶ OpenAI GPT-4o
└───────────────────┘     on except Exception   ──▶ error_logger.log_error()  (sync pymongo db)

  Meet Bot  (Playwright + Chrome + Xvfb + PulseAudio subprocess)
  — invoked by routes/bot_recording.py and routes/bot_setup.py, independent of Celery
```

**2. Router → dependency map** (what each router in `app/routes/` actually talks to)

```
auth/routes.py         ──▶ auth/jwt.py (get_current_user, require_admin)
                        ──▶ db.users                                   ──▶ Redis (blacklist on logout)
                        ──▶ Google OAuth 2.0

routes/meetings.py     ──▶ core/storage.py  (S3Storage | LocalStorage) ──▶ core/s3_utils.py ──▶ AWS S3
                        ──▶ core/audio_merge.py (WebM concat | ffmpeg concat for mobile MP4)
                        ──▶ db.meetings / db.audio_chunks / db.processing_queue
                        ──▶ core/error_logger.log_error()  (chunk upload / merge / RAG / OpenAI failures)
                        ──▶ Qdrant  (inline RAG indexing)   ──▶ OpenAI (embeddings, GPT-4o generation)

routes/chat.py         ──▶ db.chat_sessions
                        ──▶ Qdrant  (vector search, RAG context)
                        ──▶ OpenAI  (streamed SSE completion)
                        ──▶ core/error_logger.log_error()  (persist / pipeline failures)

routes/diagrams.py     ──▶ Celery: worker/tasks/diagram_gen.py  (status polling)

routes/stats.py        ──▶ db.meetings  (aggregation pipelines)

routes/admin.py        ──▶ db.users / db.meetings / db.system_config   (require_admin on every route)
                        ──▶ db.error_logs   (list / detail / delete / clear-all — Error Logs tab)
                        ──▶ core/error_logger.log_error()  (Qdrant cleanup / bulk-index failures)

routes/processing.py   ──▶ db.processing_queue  (admin-configurable processing window)

routes/bot_recording.py┐
routes/bot_setup.py    ├──▶ meet_bot/record_meeting.py + meet_bot/setup_login.py
                        │      (Playwright + Chrome + Xvfb + PulseAudio subprocess)
```

**3. Error-logging pipeline** (every capture path funnels into the same collection)

```
Unhandled exception                Swallowed "except Exception" block         Celery task failure
(any route)                        (routes/*.py, best-effort cleanup)         (worker/tasks/*.py)
      │                                          │                                    │
      ▼                                          ▼                                    ▼
main.py global_exception_handler   log_error(e, db, source="manual:<tag>")   log_error(exc, get_sync_db(),
      │                                          │                             source="manual:<task>")
      └──────────────────────────┬───────────────┴────────────────────────────────────┘
                                  ▼
                    core/error_logger.py  log_error()
                    ├─ walk exc.__traceback__ → deepest frame inside backend/app/
                    ├─ derive module / function / file_path / line_number automatically
                    ├─ capture exception_type, message, full traceback, request info,
                    │   user_id / user_email, status_code, free-form context
                    └─ async Motor db  → asyncio.create_task(insert)   (fire-and-forget)
                       sync pymongo db → direct insert_one()
                                  │
                                  ▼
                    MongoDB  db.error_logs
                    ├─ TTL index on `timestamp`, expireAfterSeconds = ERROR_LOG_TTL_HOURS × 3600
                    └─ [("module", 1), ("timestamp", -1)] index for filtering
                                  │
                                  ▼
              GET /api/v1/admin/error-logs*  (require_admin)
                                  │
                                  ▼
       Frontend  /dashboard/admin → "Error Logs" tab
       (search, module filter, pagination, traceback detail modal, delete / clear-all)
```

---

## Frontend

### Frontend Prerequisites

- Node.js 20+
- npm 10+

---

### Frontend Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | ✅ | Full URL of the frontend, e.g. `http://localhost:3015` |
| `NEXTAUTH_SECRET` | ✅ | Random 64-char secret for NextAuth session encryption |
| `GOOGLE_CLIENT_ID` | ❌ | Google OAuth client ID (leave blank to disable Google login) |
| `GOOGLE_CLIENT_SECRET` | ❌ | Google OAuth client secret |
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API URL visible to the browser, e.g. `http://localhost:3014` |
| `BACKEND_URL` | ✅ | Backend API URL for server-side requests (SSR + NextAuth), e.g. `http://localhost:3014` |

> In Docker Compose deployments, `BACKEND_URL` should point to the backend container name, e.g. `http://meetmind-api:3014`.

> Generate a secure `NEXTAUTH_SECRET`:
> ```bash
> openssl rand -base64 48
> ```

---

### Running Locally

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local and fill in all required values

# 3. Start development server
npm run dev
```

The application will be available at `http://localhost:3015`.

**Available scripts:**

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload on port 3015 |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server on port 3015 |
| `npm run lint` | Run ESLint |

---

### Running with Docker & Compose

We provide an automated deployment script as well as a predefined Compose file for easy containerization.

```bash
cd frontend

# 1. Run the deployment script to pull latest code and rebuild automatically
sh deploy_frontend.sh

# --- OR handle it manually ---

# 2. Start via Docker Compose:
docker compose -f docker-compose-frontend.yml up -d --build

# 3. View logs:
docker compose -f docker-compose-frontend.yml logs -f

# 4. Stop the container:
docker compose -f docker-compose-frontend.yml down
```

---

### Pages & Features

#### Public Pages

| Route | Description |
|-------|-------------|
| `/login` | Sign in with email + password or Google OAuth. Toggle to sign up. |

#### Protected Pages (requires authentication)

| Route | Description |
|-------|-------------|
| `/dashboard` | Overview with meeting stats, quick action cards, and a getting-started CTA for new users |
| `/dashboard/meetings` | Paginated list of all meetings with search, status badges, and inline delete |
| `/dashboard/meetings/[id]` | Meeting detail with tabbed AI outputs (Minutes, Summary, Key Points, Transcript), Mermaid diagram, chat index status, download audio, and delete |
| `/dashboard/record` | Audio recording in chunk-upload mode. Fill in meeting details, then record. Chunks upload every 30 seconds. Offline caching via IndexedDB with automatic retry on reconnect. |
| `/dashboard/chat` | Global chat interface. Ask questions across all indexed meetings or scope to specific meetings using the multi-select dropdown. Streams responses via SSE. |
| `/dashboard/admin` | Admin-only panel with platform stats, user management (role change, delete), all-meetings table, audio storage backend configuration, RAG indexing tools, and an Error Logs tab (searchable/filterable list of captured backend errors with full traceback detail, delete/clear-all) |

#### Key Frontend Features

**Recording (Chunk Upload Mode)**
- Audio captured via `MediaRecorder` API
- Flushed to the backend every 30 seconds via `POST /api/v1/meetings/{id}/chunks`
- Each chunk upload promise is tracked in a `Set`; merge only fires after **all** uploads settle (eliminates race conditions)
- Offline chunks cached to IndexedDB and retried automatically on reconnect
- Visual status indicators per chunk (pending / uploading / done / cached / failed)

**AI Chat (SSE Streaming)**
- Streams tokens from the backend using the Fetch API with `text/event-stream`
- Multi-meeting scope selector with search
- Admin users can scope across all users or filter by a specific user
- Source citations shown after response

**Diagram Rendering**
- Mermaid.js renders flow diagrams, sequence diagrams, timelines, etc.
- Dynamically imported to avoid SSR issues
- Polling every 3 seconds while diagram status is `pending`

**Performance Optimisations**
- All routes prefetched eagerly on sidebar mount
- React Query cache: 5-minute stale time, 10-minute GC time
- Redux cache: meeting detail pages instant on back-navigation
- Token read from Redux store synchronously — no `/api/auth/session` round-trip per request
- All queries gated on `!!token` to prevent unauthenticated requests that produce CORS-masked 401 errors

---

### State Management

The frontend uses a two-layer caching strategy:

**React Query** — server state (network requests, background refetch)
- Cache keys: `["meetings", page]`, `["meeting", id]`, `["stats"]`, `["diagram", id]`
- Stale time: 5 minutes
- Used for initial data fetching and mutation side effects

**Redux Toolkit** — persistent client state (survives route navigation)
- `sessionSlice` — access token, role, user_id, user profile
- `meetingsSlice` — meetings by page, meetings by ID, stats
- `uiSlice` — navigation progress bar state, visited routes

When React Query fetches fresh data it writes to Redux. Components read from Redux first (instant on re-visit), falling back to React Query data if the Redux store is empty.

---

### Frontend Project Structure

```
src/
├── auth.ts              — NextAuth config (Google + Credentials providers)
├── middleware.ts        — Route protection for /dashboard/**
├── app/
│   ├── api/auth/        — NextAuth API route handler
│   ├── auth/            — OAuth callback + error pages
│   ├── dashboard/
│   │   ├── admin/       — Admin panel page
│   │   ├── chat/        — Global chat page
│   │   ├── meetings/    — Meetings list + detail pages
│   │   ├── record/      — Recording page
│   │   ├── layout.tsx   — Dashboard shell (Sidebar + main)
│   │   └── page.tsx     — Dashboard home
│   ├── login/           — Login / register page
│   ├── globals.css      — Tailwind base + Mermaid overrides
│   ├── layout.tsx       — Root HTML layout
│   └── providers.tsx    — Redux + React Query + NextAuth + Toast providers
├── components/
│   ├── chat/
│   │   └── ChatInterface.tsx  — SSE chat with meeting selector
│   ├── diagram/
│   │   └── MermaidRenderer.tsx — Dynamic Mermaid.js renderer
│   └── layout/
│       └── Sidebar.tsx        — Responsive sidebar (desktop + mobile drawer)
├── hooks/
│   ├── useChatStream.ts       — SSE fetch stream + message state
│   ├── useDiagramStatus.ts    — Diagram polling query
│   ├── useMeetings.ts         — useMeetingsList, useMeeting, useStats
│   └── useNavPrefetch.ts      — Programmatic navigation with progress bar
├── lib/
│   └── api.ts                 — Axios instance + all API endpoint wrappers
├── store/
│   ├── hooks.ts               — Typed useAppDispatch / useAppSelector
│   ├── index.ts               — Redux store configuration
│   └── slices/
│       ├── meetingsSlice.ts   — Meetings + stats state
│       ├── sessionSlice.ts    — Auth session state
│       └── uiSlice.ts         — UI state (navigation, visited routes)
└── types/
    └── index.ts               — TypeScript interfaces for all data models
```

---

## Authentication

The platform supports two independent authentication methods:

### Email + Password
- Passwords hashed with **Argon2** (more secure than bcrypt)
- Registration validates email uniqueness, password strength (8+ chars, 1 uppercase, 1 digit)
- Same error message for "email not found" and "wrong password" (prevents user enumeration)

### Google OAuth 2.0
- Initiated via NextAuth on the frontend, which calls the backend `/auth/google/token` to exchange the Google ID token for an internal JWT
- Google accounts and email accounts are kept separate; attempting to sign in via the wrong method returns a clear error

### JWT Tokens
- Signed with HS256, configurable expiry (default 7 days)
- Blacklisted in Redis on logout (stored for remaining TTL)
- Payload includes `user_id`, `email`, `role`, `auth_provider`, `google_id`
- Token read from Redux store synchronously on every request (no session network call)

### Roles
- `user` — standard role, can only access own meetings
- `admin` — can access all meetings/users platform-wide, manage roles, configure storage

---

## Deployment

### Production Checklist

**Backend**
- [ ] Set `ENVIRONMENT=production`
- [ ] Use a strong random `JWT_SECRET` (minimum 64 characters)
- [ ] Set `CORS_ORIGINS` to your actual frontend domain
- [ ] Ensure ffmpeg is installed (`ffmpeg -version`)
- [ ] Use MongoDB Atlas with IP allowlist configured
- [ ] Configure EC2 IAM instance role for S3 access (no hardcoded credentials)
- [ ] Run behind a reverse proxy (nginx/Caddy) with HTTPS
- [ ] Use `docker compose up -d --build` to rebuild after changes

**Frontend**
- [ ] Set `NEXTAUTH_URL` to your actual production URL with HTTPS
- [ ] Use a strong random `NEXTAUTH_SECRET`
- [ ] Set `NEXT_PUBLIC_API_URL` to your backend's public URL
- [ ] Set `BACKEND_URL` to internal backend URL (container name in Docker)
- [ ] Build with `npm run build` before deploying

### Reverse Proxy (nginx example)

```nginx
# Frontend
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3015;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}

# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:3014;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Required for SSE (chat streaming)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

---

## System Dependencies

| Dependency | Required For | Install |
|------------|-------------|---------|
| Python 3.11+ | Backend runtime | `apt-get install python3.11` |
| Node.js 20+ | Frontend runtime | `apt-get install nodejs` |
| Redis 7 | Celery broker + JWT blacklist | `apt-get install redis-server` |
| ffmpeg | Mobile MP4 audio chunk merging | `apt-get install ffmpeg` |
| MongoDB Atlas | Primary data store | Cloud service (no local install) |
| Qdrant Cloud | Vector store for RAG | Cloud service (no local install) |

> **ffmpeg is critical for mobile audio.** Without it, audio from mobile clients (expo-audio / React Native) will contain only the first 30 seconds regardless of recording length. The backend will log a prominent warning at startup if ffmpeg is not found.

---

## Known Limitations

1. **Email verification** — Email accounts are created without email verification. The `email_verified` field is always `false` for email/password accounts until verification is implemented.

2. **Transcription** — The backend does not perform transcription itself. Transcripts are submitted externally via `PATCH /api/v1/meetings/{id}` with an optional HMAC signature verification (`BACKEND1_HMAC_SECRET`).

3. **Mobile merge** — The mobile app (expo-audio) does not call the merge endpoint. Merging must be triggered externally (e.g. by your transcription pipeline calling `POST /api/v1/meetings/{id}/merge-chunks` after all chunks are uploaded).

4. **Celery tasks** — LLM generation tasks exist in Celery but the primary path is synchronous inline generation via the REST endpoint. The Celery tasks are available for background processing if preferred.

5. **Single-region S3** — The S3 configuration defaults to `ap-south-1`. Change `AWS_DEFAULT_REGION` for other regions.

---------------------------------------------

### Author

Smart MoM is built and maintained as an AI meeting intelligence platform by INT. For questions, issues, or contributions, please open a GitHub issue or pull request.

[![Frontend](https://img.shields.io/badge/🌐%20Frontend%20Link-Click%20Here-0078D4?style=flat)](https://beside-hiking-billion-count.trycloudflare.com)
[![Mobile App](https://img.shields.io/badge/📱%20Mobile%20App-Download%20APK-34A853?style=flat&logo=google-drive&logoColor=white)](https://drive.google.com/file/d/1l-tRbB9faUegjjlWR9hwVsLwf2iIZ1Jp/view?usp=drive_link)