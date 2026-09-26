# Data Models

Pydantic models, by file. These define both request validation and (via `serializers.py`) the API-facing response shape.

## `models/meeting.py`

| Model | Fields |
|---|---|
| `TranscriptSegment` | `speaker: str`, `speaker_name: str = ""`, `start: float`, `end: float`, `text: str` |
| `TranscriptData` | `text: str \| List[TranscriptSegment]`, `segments: List[TranscriptSegment] = []`, `word_count: int = 0`, `language: str = "en"`, `received_at: datetime`. A validator normalizes array-`text` input into `segments` plus a joined `text` string, so callers can send either shape. |
| `DiagramData` | `status: str`, `type: str`, `mermaid_syntax: str`, `generated_at: datetime`, `error: str \| None` |
| `MeetingOut` | Full response shape: id/title/date_time/attendees/status/audio fields/transcript/mom/summary/key_points/diagram/rag_indexed(_at)/`merge_error`/`meet_link`/`bot_session_id`/timestamps |
| `CreateMeetingRequest` | Validates `no_of_persons == len(attendees)` |
| `UpdateMeetingRequest` | All fields optional; `IMMUTABLE_FIELDS = {meeting_id, user_id, created_at, audio_s3_key, status}` are rejected if present |
| `ChatMessage` | role/content pair used in `conversation_history` |
| `ChatRequest` | `message: str`, `meeting_id: str \| None`, `meeting_ids: List[str] \| None`, `conversation_history: List[ChatMessage] = []` |
| `AudioChunk` | `chunk_id`, `timestamp`, plus the uploaded audio |
| `DiagramResponse` | API response wrapper for `GET /{id}/diagram` |

## `models/user.py`

| Model | Fields |
|---|---|
| `RegisterRequest` | `email`, `password` (validator: ≥8 chars, ≥1 uppercase, ≥1 digit), `name` |
| `LoginRequest` | `email`, `password` |
| `AuthResponse` | `token`, `user_id`, `email`, `name`, `role` |
| `UserProfile` | Public-safe user shape (no `password_hash`) |

## `models/processing.py`

| Model | Fields |
|---|---|
| `ProcessingQueueItem` | Queue entry: meeting_id, status, retry_count, timestamps |
| `ProcessingConfig` | Window start/end, max retries, retry delay, poll interval, external API URL |
| `ProcessingCallbackRequest` | `meeting_id`, `status`, `output: Any \| None`, `error_message: str \| None` — body of `POST /api/v1/processing/callback` |
| `UpdateProcessingConfigRequest` | Admin PUT body for `/admin/processing/config` |

## `models/serializers.py`

- `serialize_meeting(doc)` — converts `ObjectId` → `str`; back-fills defaults for pre-v3 documents missing `diagram`, `rag_indexed`, `rag_indexed_at`, `meet_link`, `bot_session_id`, so old records stay API-compatible without a migration script.
- `serialize_processing_item(doc)` — `ObjectId` → `str` only.

## MongoDB `users` document (not a Pydantic model, but the canonical on-disk shape)

```json
{
  "_id": "ObjectId",
  "email": "string",
  "name": "string",
  "avatar_url": "string | null",
  "role": "user | admin",
  "auth_provider": "email | google | linked",
  "password_hash": "argon2 hash | null (null for google-only accounts)",
  "email_verified": false,
  "google_id": "string | null",
  "created_at": "datetime",
  "last_login_at": "datetime"
}
```

See [Database Schema](../architecture/database-schema.md) for the full `meetings` and `error_logs` document shapes.
