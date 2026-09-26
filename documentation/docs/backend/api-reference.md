# API Reference

All endpoints require `Authorization: Bearer <token>` unless marked **Public**. 🔐 User = any authenticated user (own data only unless noted); 🔐 Admin = `require_admin` dependency.

This page includes everything in the root README's API table **plus** the routers it omits (`processing`, `bot_recording`, `bot_setup`) and additional admin endpoints not previously documented. Interactive docs are available locally at `http://localhost:3014/docs` (Swagger) and `/redoc`.

## Authentication — `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register with email + password (Argon2 hash) |
| POST | `/auth/login` | Public | Sign in with email + password |
| GET | `/auth/google` | Public | Initiate Google OAuth (redirect flow) |
| GET | `/auth/google/callback` | Public | Google OAuth redirect handler |
| POST | `/auth/google/token` | Public | Exchange a Google ID token (used by NextAuth) for an internal JWT |
| POST | `/auth/refresh` | 🔐 User | Re-issue a fresh JWT |
| POST | `/auth/logout` | 🔐 User | Blacklist the current token in Redis |
| GET | `/auth/me` | 🔐 User | Get current user profile (`password_hash` stripped) |

## Meetings — `/api/v1/meetings`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | 🔐 User | Create a meeting record. `no_of_persons` must equal `len(attendees)`. |
| GET | `/` | 🔐 User | List meetings, paginated. Admin sees all; user sees own. |
| GET | `/{id}` | 🔐 User | Get one meeting (ownership-checked) |
| PATCH | `/{id}` | 🔐 User | Update a meeting — the primary transcript-ingestion endpoint. Rejects `IMMUTABLE_FIELDS` (`meeting_id`, `user_id`, `created_at`, `audio_s3_key`, `status`). If `transcript` is included, verifies `X-Backend1-Signature` HMAC when `BACKEND1_HMAC_SECRET` is configured; resets `mom`/`summary`/`key_points`/`diagram`/`rag_indexed` to null; runs inline RAG indexing; enqueues a transcription-ready email on first transition to `transcript_ready`. |
| DELETE | `/{id}` | 🔐 User | Delete meeting + storage object + `audio_chunks` + Qdrant vectors (all best-effort) |
| POST | `/presigned-upload` | 🔐 User | Get an S3 presigned PUT URL (`null` in local-storage mode) |
| POST | `/upload-audio` | 🔐 User | Direct multipart audio upload (local-storage mode) |
| GET | `/stream-audio` | 🔐 User | Stream a local-mode audio file (ownership-checked via `meetings`/`audio_chunks`) |
| POST | `/{id}/chunks` | 🔐 User | Upload one audio chunk (`chunk_id`, `timestamp`, `audio`); sets `status=recording`, `audio_state=chunked` |
| POST | `/{id}/merge-chunks` | 🔐 User | Merge all chunks — **always naive byte concatenation**, regardless of client (see [Data Flow](../architecture/data-flow.md)) |
| GET | `/{id}/audio-url` | 🔐 User | Get a playable/downloadable audio URL |
| GET | `/{id}/download-audio` | Signed token (no Bearer) | Download audio via a short-lived (1h) HMAC-signed query token |
| POST | `/{id}/generate/{type}` | 🔐 User | `type ∈ {mom, summary, key_points, diagram}`. Runs **synchronously inline** — direct OpenAI calls in the request handler, not via Celery. |

## Chat — `/api/chat`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `` (`/api/chat`) | 🔐 User | Stream AI chat response over SSE (`EventSourceResponse`); embeds query → Qdrant search (filtered by `user_id`/`meeting_id(s)`) → streamed `gpt-4o-mini` completion; persists to `chat_sessions` after the stream completes |
| GET | `/meetings` | 🔐 User | List RAG-indexed meetings for the selector (all meetings, for admin) |
| GET | `/meetings/by-user/{uid}` | 🔐 Admin | List meetings for a specific user |
| GET | `/history/{meeting_id}` | 🔐 User | Get chat session history |
| DELETE | `/history/session/{id}` | 🔐 User | Delete a chat session |
| GET | `/status/{meeting_id}` | 🔐 User | Get RAG index status |
| POST | `/reindex/{meeting_id}` | 🔐 Admin | Dispatches the Celery `embed_transcript` task (the async path — unlike the inline indexing on transcript PATCH) |

## Diagrams — `/api/meetings`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/{id}/diagram` | 🔐 User | Get diagram status + Mermaid syntax |
| POST | `/{id}/diagram/regenerate` | 🔐 User | Resets `diagram.status=pending`, dispatches the Celery `generate_diagram` task to the `diagram-gen` queue |

## Stats — `/api/v1`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/stats` | 🔐 User | Meeting counts for the current user (total/transcribed/indexed/with-diagram) |
| GET | `/admin/stats` | 🔐 Admin | Platform-wide totals + meetings-by-status breakdown |

## Admin — `/api/v1/admin`

All routes on this router require `require_admin`.

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all users, paginated |
| PATCH | `/users/{id}/role` | Promote/demote a user (cannot modify self) |
| DELETE | `/users/{id}` | Delete a user + cascade their meetings/chat_sessions/Qdrant vectors (cannot delete self) |
| GET | `/meetings` | List all meetings, filterable by `user_id`/`audio_state` |
| DELETE | `/meetings/{id}` | Force-delete any user's meeting *(not in root README)* |
| GET | `/system-config/storage` | Get the active audio storage backend |
| PUT | `/system-config/storage` | Hot-swap the storage backend, persisted to `system_config` |
| POST | `/meetings/index-unindexed` | Bulk-run inline RAG indexing for all un-indexed meetings that have a transcript |
| GET | `/meetings/next-pending` | Get the oldest meeting awaiting processing |
| GET | `/meetings/stuck-chunked` | List meetings stuck in the `chunked` audio state |
| GET | `/processing/config` | Get the legacy processing-queue window/retry config *(not in root README)* |
| PUT | `/processing/config` | Update that config *(not in root README)* |
| GET | `/processing/queue` | List processing-queue items, filterable by status *(not in root README)* |
| POST | `/processing/queue/{id}/retry` | Retry one failed item *(not in root README)* |
| POST | `/processing/queue/retry-all-failed` | Retry every failed item *(not in root README)* |
| GET | `/error-logs` | List captured error logs — filterable by `module`, `source` prefix, `status_code`, `search` (message substring, case-insensitive), `date_from`/`date_to`; paginated |
| GET | `/error-logs/{id}` | Full detail for one error log, including untruncated traceback |
| DELETE | `/error-logs/{id}` | Delete a single error log entry |
| DELETE | `/error-logs` | Bulk-clear all captured error logs |

## Processing (legacy external-transcription callback) — `/api/v1/processing`

!!! danger "Public endpoint, no auth dependency"
    Neither the router prefix nor the handler declares any auth requirement. See [Security Notes](../operations/security-notes.md).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/callback` | **Public** | External transcription service reports completion/failure for a `processing_queue` item: `{meeting_id, status, output?, error_message?}`. Retries up to `processing_max_retries` before marking `failed`. **Contains a known bug**: references `settings.processing_max_retries` without importing `settings` — raises `NameError` the first time a `"failed"` callback is processed. See [Known Issues](../operations/known-issues.md). |

## Meet Bot recording — `/api/v1/meetings/bot`

*Not in the root README — this is the in-process Meet Bot integration; see [Meet Bot Module](meet-bot.md).*

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/{meeting_id}/start` | 🔐 User | Spawns `python -m app.meet_bot.record_meeting` as a subprocess with the meeting/session config injected via env vars; returns a noVNC watch URL |
| POST | `/{meeting_id}/stop` | 🔐 User | Writes a stop-signal file; waits up to 60s for graceful exit, then SIGTERM/SIGKILL |
| GET | `/{meeting_id}/status` | 🔐 User | Reports whether the bot is active, uptime, noVNC URL |

## Meet Bot setup (one-time Chrome login) — `/api/v1/meetings/bot/setup`

*Not in the root README.*

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | **No auth dependency** | Starts the interactive Google-login flow (watch via noVNC); requires an explicit `delete_existing` flag if a profile already exists |
| GET | `/login/{task_id}` | **No auth dependency** | Poll login task status |
| GET | `/status` | 🔐 Admin | Whether a logged-in Chrome profile exists |
| DELETE | `/profile` | 🔐 Admin | Delete the persisted Chrome profile (confirm-gated) |

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | `{"status": "ok", "service": "meetmind-backend", "version": "3.0.0"}` |
