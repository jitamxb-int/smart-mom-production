# Backend — Overview & Structure

FastAPI app (Python 3.11), served by Uvicorn on port `3014`. Entry point: `backend/app/main.py`.

## Startup lifecycle (`main.py`)

1. CORS middleware added **first** — must precede exception handlers so 4xx/5xx responses still carry CORS headers.
2. A catch-all `OPTIONS` route short-circuits preflight requests.
3. `lifespan`: connect Mongo → connect Redis → connect Qdrant → load the persisted audio-storage-backend choice from `system_config`.
4. A global `@app.exception_handler(Exception)` logs the error and calls `core/error_logger.log_error(..., source="http_exception_handler")`, then returns a uniform `{"success": false, "detail": {"code": "INTERNAL_SERVER_ERROR", ...}}` body.
5. `GET /health` → `{"status": "ok", "service": "meetmind-backend", "version": "3.0.0"}`.

## Routers mounted

`auth`, `meetings`, `chat`, `diagrams`, `stats`, `admin`, `processing`, `bot_recording`, `bot_setup`.

!!! warning "Three routers are undocumented in the root README"
    `routes/processing.py`, `routes/bot_recording.py`, and `routes/bot_setup.py` all exist, are mounted, and are live — but none appear in the root `Readme.md`'s API table. They're fully documented in [API Reference](api-reference.md).

## Project structure

```text
backend/app/
├── main.py               FastAPI app, middleware, lifespan startup
├── auth/
│   ├── jwt.py            Token creation, validation, blacklist check, require_admin
│   └── routes.py         Register, login, Google OAuth (3 flavors), logout, /me
├── core/
│   ├── config.py         Pydantic BaseSettings (reads .env) — see full field list below
│   ├── storage.py         Storage abstraction: S3Storage | LocalStorage, hot-swappable
│   ├── s3_utils.py        Presigned URL helpers (boto3, IAM role auth)
│   ├── error_logger.py    log_error() — auto-locates the failing frame, persists to error_logs
│   └── email.py           SMTP send + optional IMAP "Sent" append, transcription-ready email
├── db/
│   ├── database.py        Motor async client + index creation (incl. error_logs TTL reconciliation)
│   ├── qdrant_client.py    Qdrant client + collection setup, degrades gracefully if unreachable
│   └── redis_client.py     Async Redis client, degrades gracefully if unreachable
├── models/
│   ├── meeting.py          Meeting/Transcript/Diagram/Chat Pydantic models
│   ├── processing.py       Processing-queue models
│   ├── serializers.py      Mongo doc → API-safe dict, back-fills defaults for old docs
│   └── user.py             Register/Login/Auth/Profile schemas
├── routes/
│   ├── admin.py            Admin-only: users, meetings, storage config, RAG ops, processing queue, error logs
│   ├── chat.py             SSE chat + meeting selector + RAG status
│   ├── diagrams.py         Diagram status + regenerate (dispatches Celery)
│   ├── meetings.py         Full meeting CRUD + chunk upload + merge + inline generation + inline RAG indexing
│   ├── stats.py             Aggregated stats (per-user and platform-wide)
│   ├── processing.py        Public callback endpoint for the legacy external-transcription flow
│   ├── bot_recording.py     Start/stop/status for the in-process Meet Bot
│   └── bot_setup.py         One-time Chrome-profile Google login for the Meet Bot
├── meet_bot/
│   ├── record_meeting.py   Playwright/Chrome/Xvfb/PulseAudio recording script (spawned as subprocess)
│   └── setup_login.py      Manual noVNC Google login flow, backs up the Chrome profile
└── worker/
    ├── celery_app.py        Celery app, 5 queues, Celery Beat schedule
    └── tasks/
        ├── llm_generate.py       MoM / Summary / Key Points (background path — not the primary one)
        ├── embed_chunks.py       RAG embedding task (background path)
        ├── diagram_gen.py        Diagram generation (background path, simpler than the inline version)
        ├── email_notifications.py Transcription-ready email
        └── processing_queue.py    Celery Beat poller for the legacy external-transcription flow
```

## `core/config.py` — settings beyond the README

The root README documents the "headline" env vars. The actual `Settings` class (Pydantic `BaseSettings`) has several more groups worth knowing about:

| Group | Fields |
|---|---|
| OpenAI / custom endpoint | `openai_api_key`, `openai_base_url` (for Azure/custom-hosted OpenAI-compatible endpoints) |
| AWS | `aws_default_region`, `s3_bucket`, `aws_session_token` (in addition to relying on the IAM instance role) |
| SMTP / IMAP | `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password`, `smtp_from_email`, `imap_host`, `imap_port`, `imap_password`, `imap_enabled`, `imap_sent_folder` |
| Branding | `company_name`, `support_contact` (used in the transcription-ready email template) |
| Meet Bot | `meet_bot_display`, `meet_bot_pulse_server`, `meet_bot_recordings_dir`, `meet_bot_chrome_profile`, `meet_bot_chrome_backup`, `meet_bot_novnc_port` |
| Legacy processing queue | `processing_window_start`, `processing_window_end`, `processing_max_retries`, `processing_retry_delay_minutes`, `processing_poll_interval_seconds`, `external_api_url` |
| Computed properties | `error_log_ttl_seconds` (from `ERROR_LOG_TTL_HOURS`), `cors_origins_list` (parsed from the comma-separated `CORS_ORIGINS`) |

See the root `Readme.md`'s environment-variable table for the required/default values of the headline settings (Mongo, Redis, JWT, Google OAuth, Qdrant, storage backend, HMAC secret, error-log TTL) — those are accurate and not repeated here.

## Dependencies

`requirements.txt`: fastapi, uvicorn[standard], motor, pymongo, pydantic(-settings), python-jose[cryptography], httpx, celery, redis, openai, qdrant-client, tiktoken, boto3, python-multipart, sse-starlette, python-dotenv, `playwright>=1.48.0`, passlib[argon2], email-validator, requests.

The `Dockerfile` is multi-stage: the builder installs Python deps + the Playwright Chromium browser; the runtime stage additionally installs Xvfb, x11vnc/noVNC/websockify, PulseAudio, ALSA, ffmpeg, and Google Chrome Stable — i.e. **the entire Meet Bot GUI/audio stack ships inside the main backend image**, not a separate service. `docker-compose-backend.yml` runs 4 services: `api` (privileged, `shm_size: 2gb`, `ipc: host` — required for Chrome/Xvfb), `worker`, `beat` (Celery Beat — not in the README's compose table), and `redis`.
