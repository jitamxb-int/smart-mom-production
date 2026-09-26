# Storage & Audio Pipeline

## Storage abstraction (`core/storage.py`)

A small interface implemented by two backends, hot-swappable at runtime:

```python
class BaseStorage:  # interface
    def upload_audio(...): ...
    def get_download_url(...): ...
    def get_upload_presigned_url(...): ...
    def delete_audio(...): ...
    def read_audio(...): ...
    def backend_name: str
```

- **`S3Storage`** — delegates to `core/s3_utils.py` (boto3, IAM-role auth — no static credentials in code or env in production).
- **`LocalStorage`** — resolves keys under `AUDIO_LOCAL_PATH`; `get_upload_presigned_url()` raises `NotImplementedError` (local mode uploads go through `POST /upload-audio` or chunk upload instead).
- A module-level singleton (`_active_backend`) is swapped live by `set_active_backend()` — no restart required.
- `load_storage_config_from_db()` restores the admin's last-chosen backend from `system_config` at startup, so the choice survives restarts.
- The active backend can be changed via the Admin Panel or `PUT /api/v1/admin/system-config/storage`.

## S3 details (`core/s3_utils.py`)

- `get_s3_client()` — lazy singleton, uses the IAM instance role (EC2) — no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` needed or stored.
- `build_audio_s3_key(user_id, meeting_id)` → `audio/{user_id}/{meeting_id}/{meeting_id}.webm`
- Presigned PUT (upload) and GET (playback/download), default expiry 3600s.
- `upload_object`, `get_object`, `delete_object`, `check_object_exists` round out the wrapper.

## Audio chunk upload & merge

Both web (`MediaRecorder`) and mobile (`expo-audio`) clients upload chunks the same way, roughly every 30 seconds, via `POST /api/v1/meetings/{id}/chunks`. Each chunk is upserted into `audio_chunks`, and the meeting's `status`/`audio_state` are updated to reflect in-progress recording.

!!! danger "The root README's merge-strategy table does not match the code"
    The root README describes format detection (WebM magic bytes vs MP4 `ftyp`) with an `ffmpeg` concat-demuxer re-mux specifically for mobile chunks, to avoid the "only first 30 seconds" `moov`-box problem. **`core/audio_merge.py` does not exist in this codebase.** The actual merge logic, in `routes/meetings.py::merge_audio_chunks`, is a **plain `bytearray` concatenation for every client**, web or mobile. `ffmpeg` is present in the backend image, but it is used only inside the Meet Bot (`meet_bot/record_meeting.py`) to *capture* audio from a PulseAudio monitor source — never to *merge* uploaded chunks.

    Practical implication: if mobile chunks are genuinely self-contained MP4/AAC files (each with its own `moov` box), naive concatenation would reproduce exactly the truncation bug the README describes as solved. Treat mobile audio merging as an open risk area until this is verified/fixed in code, not just in docs.

On successful merge, a `processing_queue` entry is pushed (feeding the legacy external-transcription poller — see [Background Workers](workers.md) and [Transcription Service](../services/transcription-service.md)).

## Streaming & downloads

- `GET /api/v1/meetings/stream-audio` — local-storage mode only; ownership-checked against `meetings`/`audio_chunks`.
- `GET /api/v1/meetings/{id}/audio-url` — returns a playable/downloadable URL (presigned S3 GET, or a local stream URL).
- `GET /api/v1/meetings/{id}/download-audio` — takes a short-lived (1-hour), HMAC-signed, base64url (padding-stripped) token in the query string instead of a Bearer header, so it can be used directly in an `<a href>`/download link. The backend verifies the signature, expiry, and that the token's meeting/user match before streaming.
