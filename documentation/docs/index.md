# Smart MoM — Engineering Handbook

**Repository:** [github.com/jitamxb-int/smart-mom-production](https://github.com/jitamxb-int/smart-mom-production)

Smart MoM is an AI-powered meeting intelligence platform: record a meeting (browser, mobile, or an automated Google Meet bot), get it transcribed and diarized, generate Minutes of Meeting / Summary / Key Points / a Mermaid diagram on demand, and chat with your meetings via retrieval-augmented generation (RAG).

This handbook is the living reference for the whole codebase — architecture, every API endpoint, data models, background workers, frontend structure, and the auxiliary services. It was built by reading the actual source (not just the root `Readme.md`), so it also documents things the root README omits, and calls out places where the README and the code have drifted apart. See [Known Issues & Tech Debt](operations/known-issues.md) for the full list.

## Repository map

| Path | What it is |
|---|---|
| `backend/` | FastAPI REST API — auth, meetings, chat/RAG, diagrams, stats, admin, the in-process Meet Bot, Celery workers |
| `frontend/` | Next.js 14 (App Router) + TypeScript web client |
| `meet-bot-integration/` | Standalone FastAPI microservice that drives a headless Chrome to join & record a Google Meet — **a parallel implementation** of logic that is also embedded directly in `backend/app/meet_bot/` (see [Meet Bot Integration Service](services/meet-bot-integration.md)) |
| `transcription_service/` | A **mock/stub** transcription callback service — the real WhisperX + Pyannote pipeline exists only as commented-out code (see [Transcription Service](services/transcription-service.md)) |
| `documentation/` | This handbook — a self-contained unit with its own `Dockerfile`/`docker-compose.yml` (hostable separately from the app: docs site on port `3013`, MCP server on `8006`), containing `docs/` (this MkDocs source) and `mcp-server/` (an MCP server making the handbook queryable by Claude Code / OpenCode, locally or hosted — see [MCP Docs Server](mcp-server.md)) |

## Where to start

- New to the codebase? Read [Architecture Overview](architecture/overview.md) first, then [Data Flow & Sequence Diagrams](architecture/data-flow.md).
- Working on an API endpoint? [Backend → API Reference](backend/api-reference.md) has every route, its auth requirement, and its request/response shape.
- Working on a UI page? [Frontend → Pages & Routing](frontend/pages-routing.md) and [State Management](frontend/state-management.md).
- Deploying or debugging production? [Operations → Deployment](operations/deployment.md) and [Security Notes](operations/security-notes.md).
- Want your AI coding agent (Claude Code, OpenCode) to search this handbook directly from the terminal? [MCP Docs Server](mcp-server.md).

## Stack at a glance

**Backend:** FastAPI (Python 3.11) · Motor (async MongoDB Atlas) · Redis 7 · Celery (+ Celery Beat) · OpenAI GPT-4o / GPT-4o-mini · Qdrant Cloud (vectors) · AWS S3 or local disk · Playwright/Chrome/Xvfb/PulseAudio (Meet Bot) · JWT (HS256) + Argon2

**Frontend:** Next.js 14.2 (App Router) · TypeScript · Tailwind CSS v3 · NextAuth v5 (beta) · TanStack React Query v5 · Redux Toolkit v2 · Axios · Mermaid.js v11

**Ports (local dev):** frontend `3015` · backend `3014` · meet-bot-integration API `4001` / noVNC `4002` · transcription_service (mock) `3001`
