# Background Workers

## Celery app (`worker/celery_app.py`)

- Broker/backend: `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` if set, else falls back to `REDIS_URL`.
- `task_acks_late=True`, `worker_prefetch_multiplier=1`, JSON serialization only, UTC.
- **Five queues** via `task_routes`: `llm-generate`, `embed-chunks`, `diagram-gen`, `email-notifications`, `processing-queue`. The last two are **not documented in the root README**.
- **Celery Beat schedule** (also undocumented in the README): runs `processing_queue.poll_processing_queue` every `PROCESSING_POLL_INTERVAL_SECONDS` (default 60s). This runs as its own `beat` container in `docker-compose-backend.yml`.

!!! important "Generation is primarily synchronous, not queued"
    `POST /api/v1/meetings/{id}/generate/{type}` and transcript-triggered RAG indexing both run **inline in the FastAPI request handler**, calling OpenAI directly and blocking the response. The Celery tasks below implement the *same* jobs and are fully functional, but are reached only through a narrower set of triggers (`POST /chat/reindex/{id}`, `POST /diagrams/{id}/regenerate`, and the beat-scheduled processing poller). Because the inline and queued implementations were written independently, their prompts and model choices have **drifted out of sync** — see [Known Issues](../operations/known-issues.md).

## Tasks (`worker/tasks/`)

| Queue | Module | Trigger | What it does |
|---|---|---|---|
| `llm-generate` | `llm_generate.py` | Not on the live path (background alternative) | `generate_llm_output(meeting_id, output_type)` — builds a speaker-annotated transcript, formats the `mom`/`summary`/`key_points` prompt, calls `gpt-4o-mini` (`max_tokens` 4000 for mom, 2000 for others), writes the result + `updated_at`. Retries up to 3× with 5s backoff via `log_error` + `self.retry`. |
| `embed-chunks` | `embed_chunks.py` | `POST /chat/reindex/{id}` (async path); the transcript-PATCH path uses an equivalent **inline** function instead | `embed_transcript(meeting_id)` — deletes existing Qdrant points for the meeting, chunks text by a char-approximation of tokens (`CHUNK_SIZE_TOKENS × 4` chars, snapped to word boundaries), batch-embeds (100/call), upserts to Qdrant (100/batch), sets `rag_indexed=True` + `rag_indexed_at`. Retries up to 3× with 10s backoff. |
| `diagram-gen` | `diagram_gen.py` | `POST /diagrams/{id}/regenerate` | `generate_diagram(meeting_id)` — classifies the meeting (`gpt-4o-mini`, single-word answer) then generates (`gpt-4o`, ≤800 tokens) with a strict-retry fallback prompt if the first output fails `validate_mermaid()`. Sets `diagram.status` to `not_applicable`/`ready`/`failed`. Retries up to 2× with 15s backoff. **Simpler than, and independently maintained from,** the inline generator in `routes/meetings.py::trigger_generation` (different prompt sets, no per-length variants, no hardcoded-template last-resort fallback). |
| `email-notifications` | `email_notifications.py` | Enqueued by `PATCH /{id}` on first `transcript_ready` transition | `send_transcription_ready_email(user_id, meeting_id)` — resolves user/meeting, skips if `email_transferred` already true, calls `core/email.py::send_transcription_ready_notification`, sets `email_transferred=True` + timestamp + recipients. Distinguishes a `PermanentEmailError` (bad user/meeting/config — no retry) from transient failures (exponential backoff `min(2**retries*5, 60)`, max 3 retries). |
| `processing-queue` | `processing_queue.py` | Celery Beat, every `PROCESSING_POLL_INTERVAL_SECONDS` | `poll_processing_queue()` — reads the processing window/retry config from `system_config` (or env defaults), checks the current UTC time against the window (handles overnight wraparound), atomically claims the oldest `pending` item (`find_one_and_update` → `processing`), `POST`s `{meeting_id, user_id, s3_url}` to `{external_api_url}/transcript` (30s timeout via `requests`). On failure, increments `retry_count` and reverts to `pending` or marks `failed` at `max_retries`. On success, leaves the item `processing` and waits for the external service to call back via `POST /api/v1/processing/callback`. |

## Status of the legacy processing-queue pipeline

`backend/docs/transcription-service-plan.md` documents this entire poller/callback pipeline as **legacy**, with a plan to replace it with an admin-triggered batch-dispatch flow (`POST /admin/transcribe/batch`, not yet implemented). See [Transcription Service](../services/transcription-service.md) for the full picture — the intended replacement architecture is not live yet, and the current poller talks to a **mock** external service.

## Running the worker locally

```bash
celery -A app.worker.celery_app.celery_app worker \
  --queues=llm-generate,embed-chunks,diagram-gen,email-notifications,processing-queue \
  --loglevel=info \
  --concurrency=2

celery -A app.worker.celery_app.celery_app beat --loglevel=info
```
