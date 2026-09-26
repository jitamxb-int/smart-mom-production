# Known Issues & Tech Debt

Consolidated from the codebase deep-dive that produced this handbook. Ranked roughly by how much they'd bite someone in practice, not by file order.

## Bugs

| Issue | Where | Impact |
|---|---|---|
| `NameError` on failed processing callback | `backend/app/routes/processing.py:44` | References `settings.processing_max_retries` without importing `settings` — will raise the first time an external service reports `status: "failed"` via `POST /api/v1/processing/callback`. |
| Rules-of-Hooks violation | `frontend/src/hooks/useRecordingRedux.ts` | `useAppSelector` called inside a `useCallback` body in `useRecordingControls`. Low real-world impact since this module isn't imported by the live record page, but will misbehave if it's ever wired in without fixing this first. |
| Mock transcription callback targets the wrong path | `transcription_service/app/main.py` | PATCHes `/api/v1/meetings/{id}/transcript`, which doesn't exist — the real endpoint is `PATCH /api/v1/meetings/{id}`. Also sends no auth header, so it would 401 even with the path fixed. See [Transcription Service](../services/transcription-service.md). |
| Hardcoded developer-machine path | `backend/app/core/email.py::send_transcription_ready_notification` | A Windows dev-machine absolute path is in the `email_template.html` search-path list — dead weight outside that one machine, should be removed. |

## Documentation vs. code drift (root `Readme.md`)

| README claim | Reality |
|---|---|
| Audio chunk merging detects WebM vs MP4 and uses ffmpeg for mobile | `core/audio_merge.py` doesn't exist; `routes/meetings.py::merge_audio_chunks` always does naive `bytearray` concatenation, for every client. ffmpeg is used only by the Meet Bot to *capture* audio, never to *merge* chunks. See [Storage & Audio Pipeline](../backend/storage-audio.md). |
| API table lists 6 routers | The backend also mounts `processing`, `bot_recording`, and `bot_setup` — a whole undocumented Meet Bot + legacy-processing surface. See [API Reference](../backend/api-reference.md). |
| Celery task list has 3 modules | There are 5: also `email_notifications.py` and `processing_queue.py` (a Celery Beat poller), plus Beat itself isn't mentioned at all. See [Background Workers](../backend/workers.md). |
| Docker Compose backend table lists 3 services | There are 4 — `beat` (Celery Beat) is missing from the table. |
| Frontend has 3 Redux slices | There are 7: also `admin`, `chat`, `recording`, `notifications`. See [State Management](../frontend/state-management.md). |
| No mention of the Meet Bot in the frontend | It's a first-class feature: a recording panel on the meeting detail page, an admin setup panel, and its own `lib/api.ts` namespace. |

## Duplicated / drifted implementations

- **Diagram generation exists twice**: inline in `routes/meetings.py::trigger_generation` (the live path — per-length prompt variants, a hardcoded template fallback, `gpt-4o-mini` classify + `gpt-4o` generate) and again in `worker/tasks/diagram_gen.py` (simpler, reached only via `POST /diagrams/{id}/regenerate`). Different prompts, can drift further out of sync. See [Background Workers](../backend/workers.md).
- **MoM/Summary/Key Points generation exists twice**: the live inline path in `routes/meetings.py` uses a different model string (`gpt-5.4-mini` with `max_completion_tokens`) than the Celery task `llm_generate.py` (`gpt-4o-mini` with `max_tokens`). Only the inline path is on the live request flow, per the root README's own caveat that generation is synchronous — but the two should be reconciled or the dead one removed.
- **Chunk-merge logic is duplicated**: `routes/meetings.py::merge_audio_chunks` and `meet_bot/record_meeting.py`'s self-merge both implement the same naive-concat pattern independently.
- **SSE chat streaming is implemented three times** on the frontend: `hooks/useChatStream.ts` (live), `store/slices/chatSlice.ts`'s `sendMessage` thunk, and `hooks/useChatRedux.ts` (paired with the unused `ChatInterfaceRedux.tsx`). See [State Management](../frontend/state-management.md).
- **Meet Bot logic is duplicated across two services**: `backend/app/meet_bot/` (live, in-process) and the standalone `meet-bot-integration/` service (own Docker stack, apparently not called by the backend). See [Meet Bot Integration Service](../services/meet-bot-integration.md).

## Apparent dead code (not imported by any live page/route, as far as this handbook's research could confirm)

- `frontend/src/components/chat/ChatInterfaceRedux.tsx` and `hooks/useChatRedux.ts`
- `frontend/src/store/slices/recordingSlice.ts` and `hooks/useRecordingRedux.ts` (the live record page uses local component state instead)
- `frontend/src/app/auth/callback/page.tsx`'s `sessionStorage` stash (`meetmind_pending_token`) — nothing reads it back

Before deleting any of these, confirm with the team — they may be mid-migration rather than truly abandoned.

## Type duplication

`store/slices/chatSlice.ts` and `store/slices/adminSlice.ts` define their own local `ChatMessage`/`ChatSource`/`AdminUser` interfaces instead of importing from `frontend/src/types/index.ts`.

## Architectural questions worth raising with the team

1. Which Meet Bot implementation is actually deployed in production — the in-backend module, the standalone `meet-bot-integration` service, or both in different environments?
2. Is the legacy `processing_queue`/Celery Beat poller (talking to the mock transcription service) still meant to run in production, or should it be disabled now that `backend/docs/transcription-service-plan.md` describes a different target architecture?
3. Should the inline (synchronous) and Celery (background) implementations of MoM/Summary/Key Points/Diagram generation be reconciled into one, given they've already drifted in prompts and model choice?

See also [Security Notes](security-notes.md) for auth-related gaps found during this review.
