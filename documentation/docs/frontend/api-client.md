# API Client Layer (`lib/api.ts`)

Single Axios instance: `axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL || "" })`. A request interceptor injects `Authorization: Bearer <token>` by calling a registered getter function (`registerTokenGetter`, wired in `providers.tsx` to `store.getState().session.accessToken`) — no response interceptor and no centralized error handling; callers catch errors individually (mostly via React Query `onError`, reading `e.response.data.detail.message`).

## `meetingsApi`

| Function | Endpoint |
|---|---|
| `list` | `GET /api/v1/meetings/` |
| `get` | `GET /api/v1/meetings/{id}` |
| `create` | `POST /api/v1/meetings/` |
| `update` | `PATCH /api/v1/meetings/{id}?force=` |
| `delete` | `DELETE /api/v1/meetings/{id}` |
| `presignedUpload` | `POST /api/v1/meetings/presigned-upload` |
| `uploadAudioDirectAxios` | `POST /api/v1/meetings/upload-audio` (multipart, `onUploadProgress`) |
| `uploadChunk` | `POST /api/v1/meetings/{id}/chunks` (`chunk_id`, `timestamp`, `audio`) |
| `mergeChunks` | `POST /api/v1/meetings/{id}/merge-chunks` |
| `audioUrl` | `GET /api/v1/meetings/{id}/audio-url` |
| `triggerGeneration(id, type)` | `POST /api/v1/meetings/{id}/generate/{type}` |
| `startBotRecording` | `POST /api/v1/meetings/bot/{id}/start` — **not in root README** |
| `stopBotRecording` | `POST /api/v1/meetings/bot/{id}/stop` — **not in root README** |
| `getBotStatus` | `GET /api/v1/meetings/bot/{id}/status` — **not in root README** |
| `getBotSetupStatus` | `GET /api/v1/meetings/bot/setup/status` — **not in root README** |
| `startBotSetupLogin` | `POST /api/v1/meetings/bot/setup/login` — **not in root README** |
| `getBotLoginStatus` | `GET /api/v1/meetings/bot/setup/login/{task_id}` — **not in root README** |
| `deleteBotProfile` | `DELETE /api/v1/meetings/bot/setup/profile` — **not in root README** |

## `diagramsApi`

`get` → `GET /api/meetings/{id}/diagram`; `regenerate` → `POST /api/meetings/{id}/diagram/regenerate`.

## `chatApi`

`meetings`, `meetingsByUser(userId)`, `history(meetingId)`, `deleteSession`, `status(meetingId)` — map directly onto `/api/chat/*`.

## `statsApi`

`get` → `/api/v1/stats`; `admin` → `/api/v1/admin/stats`.

## `adminApi`

`users`, `setRole`, `deleteUser`, `meetings`, `chunkedMeetings` (`GET /api/v1/admin/meetings?audio_state=chunked`), `storageConfig`, `setStorageBackend`, `indexUnindexed`, `nextPending`, `stuckChunked`, `errorLogs` (filters: `module`/`source`/`status_code`/`search`/`date_from`/`date_to`), `errorLogDetail`, `deleteErrorLog`, `clearErrorLogs`.

See [API Reference](../backend/api-reference.md) for the full backend-side contract of every endpoint listed here.
