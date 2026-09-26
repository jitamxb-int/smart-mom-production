# Database Schema

## MongoDB Atlas (via Motor async / PyMongo sync)

Database name: `MONGO_DB_NAME` (default `meetmind`). Confirmed collections, from `backend/app/db/database.py::connect_db()`:

| Collection | Purpose | Indexes |
|---|---|---|
| `users` | Auth accounts (email or Google) | unique `email`; sparse `google_id` |
| `meetings` | One doc per meeting: metadata, transcript, mom/summary/key_points, diagram, RAG status, bot fields | unique `meeting_id`; `(user_id, created_at desc)`; `(user_id, status)`; `(user_id, diagram.status)` |
| `chat_sessions` | Persisted chat history | `(user_id, created_at desc)`; `(user_id, meeting_id)` |
| `audio_chunks` | One doc per uploaded chunk before/after merge | unique `(meeting_id, chunk_id)`; `(meeting_id, uploaded_at)` |
| `processing_queue` | Legacy/alternate transcript-dispatch queue (see [Transcription Service](../services/transcription-service.md)) | unique `meeting_id`; `(status, created_at)` |
| `system_config` | Admin-set runtime config — currently just the active audio storage backend (`s3`/`local`) and the processing-queue window/retry config | none beyond default `_id` |
| `error_logs` | Captured exceptions from the global handler, manual `log_error()` call sites, and Celery task failures | **TTL** index on `timestamp` (`expireAfterSeconds = ERROR_LOG_TTL_HOURS × 3600`, reconciled via `collMod` on every startup so changing the env var takes effect without recreating the index); `(module, timestamp desc)` |

### `meetings` document shape (key fields)

```json
{
  "meeting_id": "uuid",
  "user_id": "string",
  "title": "string",
  "date_time": "string (verbatim IST from frontend — no timezone conversion)",
  "attendees": ["string"],
  "no_of_persons": 0,
  "status": "recording | chunked | transcript_ready | ...",
  "audio_state": "chunked | merged | ...",
  "audio_s3_key": "audio/{user_id}/{meeting_id}/{meeting_id}.webm",
  "merge_error": "string | null",
  "transcript": { "text": "string", "segments": [ { "speaker": "SPEAKER_00", "speaker_name": "", "start": 0.0, "end": 0.0, "text": "string" } ], "word_count": 0, "language": "en", "received_at": "datetime" },
  "mom": "structured content — parsed into sections by MOMViewer.tsx, not a plain markdown blob",
  "summary": "string | null",
  "key_points": "string | null",
  "diagram": { "status": "pending | not_applicable | ready | failed", "type": "string", "mermaid_syntax": "string", "generated_at": "datetime", "error": "string | null" },
  "rag_indexed": false,
  "rag_indexed_at": "datetime | null",
  "meet_link": "string | null",
  "bot_session_id": "string | null",
  "email_transferred": false,
  "email_transferred_at": "datetime | null",
  "email_recipients": ["string"],
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

`IMMUTABLE_FIELDS` on `UpdateMeetingRequest` (`models/meeting.py`): `meeting_id`, `user_id`, `created_at`, `audio_s3_key`, `status` — these are rejected on `PATCH /api/v1/meetings/{id}` regardless of what the caller sends.

`serializers.py::serialize_meeting()` back-fills defaults for pre-v3 documents missing `diagram` / `rag_indexed` / `rag_indexed_at` / `meet_link` / `bot_session_id`, so older meeting docs stay API-compatible without a migration.

### `error_logs` document shape

```json
{
  "timestamp": "datetime",
  "exception_type": "string",
  "exception_module": "string",
  "message": "string (truncated to 2000 chars)",
  "module": "string — auto-derived",
  "function": "string — auto-derived",
  "file_path": "string, relative to backend/ — auto-derived",
  "line_number": 0,
  "traceback": "string (truncated to 20000 chars)",
  "source": "http_exception_handler | manual:<tag>",
  "status_code": 500,
  "context": {},
  "request_method": "string | null",
  "request_path": "string | null",
  "user_id": "string | null",
  "user_email": "string | null"
}
```

`user_id`/`user_email` are best-effort back-filled by decoding the `Authorization` header's JWT (`verify_exp=False`) when a `request` object is passed but no explicit user was given.

## Qdrant Cloud (vector store)

- Collection name: `QDRANT_COLLECTION` (default `Transcript-mom`)
- Vector params: size = `EMBEDDING_DIMENSIONS` (default 1536), distance = **COSINE**
- `on_disk_payload=True`
- Keyword payload indexes on `user_id` and `meeting_id` (used to scope RAG search per user/meeting)
- Points are deleted and fully re-upserted per meeting on every re-index (no incremental diffing)

## Redis 7

Used for three distinct purposes simultaneously:

1. **JWT blacklist** — `blacklist:{token}` key set on logout, TTL = token's remaining validity
2. **OAuth CSRF state** — `state` param for `GET /auth/google`, 600s TTL
3. **Celery broker + result backend** (unless `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` are set separately, in which case those take precedence over `REDIS_URL`)
