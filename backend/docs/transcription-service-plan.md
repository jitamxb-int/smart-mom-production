# Transcription Service — Implementation Plan

## 1. Current Architecture (Polling + External Mock)

```
[Merge Chunks] → Auto-push to Processing Queue
    → Celery Beat polls every N sec
        → POST /transcribe → External Mock Service
            → PATCH /meetings/{id} (hardcoded mock data)
```

**Problems:**
- Polling adds latency and DB churn
- Transcription service is a mock (returns hardcoded segments)
- Queue is auto-populated on merge — no admin control
- Real whisperX/pyannote pipeline exists only as commented-out code

---

## 2. Target Architecture (Admin-Selected, Queue-Driven)

```
[Admin Panel: GET /admin/meetings → list with checkboxes]
    ↓  Admin ticks meetings + clicks "Transcribe Selected"
[POST /admin/transcribe/batch  {meeting_ids: ["rec_1", "rec_3"]}]
    ↓
[For each valid meeting:]
  → Create queue entry
  → Immediately POST /transcribe → Transcription Service
    ↓
[Download audio → whisperX → pyannote → build segments]
    ↓
[PATCH /api/v1/meetings/{id} (HMAC-signed) ← callback with transcript]
    ↓
[Save transcript → RAG index → email notification]
```

**Key rules:**
1. **Only selected files go to queue** — no auto-push from merge-chunks
2. **No polling** — queue entry creation immediately triggers HTTP dispatch
3. Admin sees per-meeting result: `dispatched` / `skipped` / `dispatch_failed`
4. Transcription service is the **real** whisperX + pyannote pipeline

---

## 3. Changes in `transcription_service/` (Standalone Service)

### 3.1 `app/pipeline.py` — Enable Real Pipeline

Uncomment the existing whisperX + pyannote code. Refine to return `TranscriptData`-shaped dict:

```python
def run_transcription_pipeline(audio_path: str) -> dict:
    """Returns {text, segments[], word_count, language}"""
    # Step 1: WhisperX transcription
    model = whisperx.load_model("large-v3", device=DEVICE, compute_type=COMPUTE_TYPE, language="en")
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=1)

    # Step 2: Word-level alignment
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=DEVICE)
    result = whisperx.align(result["segments"], model_a, metadata, audio, device=DEVICE)

    # Step 3: Pyannote diarization
    temp_wav = f"/tmp/resampled_16k_{os.path.basename(audio_path)}.wav"
    sf.write(temp_wav, audio, 16000)
    diarize = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", use_auth_token=HF_TOKEN)
    diarize.to(torch.device(DEVICE))
    diarization_result = diarize(temp_wav)

    # Parse diarization turns
    turns = []
    for turn, _, speaker in diarization_result.speaker_diarization.itertracks(yield_label=True):
        turns.append({"start": round(turn.start, 3), "end": round(turn.end, 3), "speaker": speaker})

    # Step 4: Assign speakers + build output
    formatted_segments = []
    for seg in result["segments"]:
        if seg.get("words"):
            for word in seg["words"]:
                word_mid = (word["start"] + word["end"]) / 2
                best_speaker = max(
                    (t for t in turns if t["start"] <= word_mid <= t["end"]),
                    key=lambda t: min(word["end"], t["end"]) - max(word["start"], t["start"]),
                    default=None
                )
                word["speaker"] = best_speaker["speaker"] if best_speaker else "UNKNOWN"
            speakers = [w["speaker"] for w in seg["words"] if w.get("speaker")]
            seg["speaker"] = max(set(speakers), key=speakers.count) if speakers else "UNKNOWN"
        else:
            seg["speaker"] = "UNKNOWN"

        formatted_segments.append({
            "speaker": seg.get("speaker", "UNKNOWN"),
            "speaker_name": "",
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip()
        })

    # Cleanup
    os.remove(temp_wav)

    return {
        "text": " ".join(s["text"] for s in formatted_segments),
        "segments": formatted_segments,
        "word_count": len(" ".join(s["text"] for s in formatted_segments).split()),
        "language": result.get("language", "en"),
    }
```

### 3.2 `app/main.py` — Replace Mock with Real Logic

```
POST /transcribe ← receives {meeting_id, user_id, s3_url}
→ background: download audio → run pipeline → PATCH result back to backend
```

The callback **must** HMAC-sign the PATCH body using `BACKEND1_HMAC_SECRET` so the backend validates it (see `_verify_backend1_signature` in `meetings.py`).

### 3.3 `requirements.txt`

Add: `torch`, `numpy<2.5`, `ctranslate2==4.7.1`, `faster-whisper`, `whisperx`, `pyannote.audio`, `soundfile`.

### 3.4 `Dockerfile` + `docker-compose.yml`

Uncomment the CUDA-based Dockerfile. GPU service on port **3000**.

---

## 4. Changes in `smart-mom-prod/backend/`

### 4.1 `app/routes/admin.py` — Add `POST /admin/transcribe/batch`

This is the **main entry point**. Admin frontend calls it with selected meeting IDs.

```python
class BatchTranscribeRequest(BaseModel):
    meeting_ids: List[str]

@router.post("/transcribe/batch")
async def batch_transcribe(body: BatchTranscribeRequest, current_user=Depends(require_admin), db=Depends(get_db)):
    """
    Called from admin panel when user ticks checkboxes and clicks "Transcribe Selected".
    Only the selected meetings get queue entries + dispatched to transcription service.
    """
    results = []
    now = datetime.now(timezone.utc)
    storage = get_storage()

    for mid in body.meeting_ids:
        meeting = await db.meetings.find_one({"meeting_id": mid})
        if not meeting:
            results.append({"meeting_id": mid, "status": "skipped", "reason": "not_found"})
            continue
        if meeting.get("status") != "audio_uploaded":
            results.append({"meeting_id": mid, "status": "skipped", "reason": f"status={meeting.get('status')}"})
            continue
        if meeting.get("audio_state") != "merged":
            results.append({"meeting_id": mid, "status": "skipped", "reason": "audio not merged"})
            continue
        existing = await db.processing_queue.find_one({"meeting_id": mid})
        if existing:
            results.append({"meeting_id": mid, "status": "skipped", "reason": f"already queued ({existing['status']})"})
            continue

        s3_key = meeting["audio_s3_key"]
        download_url = storage.get_download_url(s3_key)

        # Only selected meetings get a queue entry
        await db.processing_queue.insert_one({
            "meeting_id": mid, "user_id": meeting["user_id"],
            "s3_link": download_url, "status": "dispatched",
            "retry_count": 0, "max_retries": 3,
            "created_at": now, "updated_at": now,
        })

        # Immediately dispatch (no polling)
        success = _dispatch(mid, meeting["user_id"], download_url)

        await db.processing_queue.update_one(
            {"meeting_id": mid},
            {"$set": {"status": "processing" if success else "dispatch_failed", "updated_at": now}}
        )
        results.append({"meeting_id": mid, "status": "dispatched" if success else "dispatch_failed"})

    return {"success": True, "results": results}
```

Helper:

```python
def _dispatch(meeting_id: str, user_id: str, s3_url: str) -> bool:
    url = settings.transcription_service_url
    if not url:
        return False
    try:
        r = requests.post(f"{url}/transcribe", json={"meeting_id": meeting_id, "user_id": user_id, "s3_url": s3_url}, timeout=10)
        return r.status_code in (200, 201, 202)
    except Exception:
        return False
```

### 4.2 `app/core/config.py` — Add Setting

```python
transcription_service_url: Optional[str] = None  # e.g. "http://transcription-service:3000"
```

### 4.3 `app/routes/meetings.py` — Remove Auto-Queue from `merge-chunks`

Delete the `# Push to processing queue` block at the end of `merge_audio_chunks()`. After merge, meeting status is `audio_uploaded` — it sits there until admin selects it.

### 4.4 `app/worker/celery_app.py` — Remove Beat Schedule

Delete the `poll-processing-queue` entry from `beat_schedule`. The `processing_queue.py` module can be removed from `include` as well.

### 4.5 `app/worker/tasks/processing_queue.py` — Delete

The poll task is no longer needed. Dispatch is now synchronous + event-driven from the admin endpoint.

### 4.6 `app/routes/processing.py` — Update Callback

The transcription service calls back via `PATCH /api/v1/meetings/{id}` (existing endpoint), not via `/processing/callback`. So this endpoint stays as-is for backward compatibility but is no longer the primary path.

---

## 5. Full Event Flow

```
 ADMIN PANEL                         BACKEND                         TRANSCRIPTION SERVICE
 ───────────                        ────────                         ────────────────────
   │                                  │                                      │
   │ GET /admin/meetings              │                                      │
   │←───────── meeting list ─────────│                                      │
   │                                  │                                      │
   │ [Admin ticks checkboxes]         │                                      │
   │                                  │                                      │
   │ POST /admin/transcribe/batch     │                                      │
   │ {meeting_ids: ["r1","r3"]}      │                                      │
   │────────────────────────────────→│                                      │
   │                                  │  For each valid meeting:             │
   │                                  │  1. Create processing_queue entry    │
   │                                  │  2. POST /transcribe                 │
   │                                  │─────────────────────────────────────→│
   │←─── [{status,meeting_id},...] ───│                                      │
   │                                  │                                      │  Download audio from s3_url
   │                                  │                                      │  Run whisperX transcription
   │                                  │                                      │  Run pyannote diarization
   │                                  │                                      │  Build segments
   │                                  │                                      │
   │                                  │  PATCH /api/v1/meetings/{id}         │
   │                                  │  {transcript:{...}}                  │
   │                                  │  X-Backend1-Signature: hmac          │
   │                                  │←─────────────────────────────────────│
   │                                  │                                      │
   │                                  │  Save transcript to meeting doc      │
   │                                  │  Trigger RAG indexing                │
   │                                  │  Enqueue email notification          │
   │                                  │  Update queue → "completed"          │
```

---

## 6. Implementation Order

| # | File | Action |
|---|------|--------|
| 1 | `transcription_service/app/pipeline.py` | Uncomment & refine real whisperX/pyannote pipeline |
| 2 | `transcription_service/app/main.py` | Replace mock: download → transcribe → HMAC-signed callback |
| 3 | `transcription_service/requirements.txt` | Add torch, whisperx, pyannote, soundfile, ctranslate2 |
| 4 | `transcription_service/Dockerfile` | Enable CUDA-based Dockerfile |
| 5 | `transcription_service/docker-compose.yml` | Enable GPU service config |
| 6 | `backend/app/core/config.py` | Add `transcription_service_url` |
| 7 | `backend/app/routes/admin.py` | Add `POST /admin/transcribe/batch` + `_dispatch` helper |
| 8 | `backend/app/routes/meetings.py` | Remove auto-queue block from `merge-chunks` |
| 9 | `backend/app/worker/celery_app.py` | Remove poll beat schedule |
| 10 | `backend/app/worker/tasks/processing_queue.py` | Delete file (no longer used) |

---

## 7. Env Vars

### `transcription_service/.env`
```
BACKEND_API_URL=http://backend:3014
BACKEND1_HMAC_SECRET=your_hmac_secret
HF_TOKEN=hf_your_token
DEVICE=cuda
COMPUTE_TYPE=float16
```

### `backend/.env`
```
TRANSCRIPTION_SERVICE_URL=http://transcription-service:3000
```
