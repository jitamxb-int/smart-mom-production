"""
Meeting routes.

New in this version:
  POST /api/v1/meetings/upload-audio         — direct audio upload (local storage mode OR S3 fallback)
  POST /api/v1/meetings/{id}/chunks          — upload one audio chunk (chunk-mode recording)
  POST /api/v1/meetings/{id}/merge-chunks    — merge all chunks into a single audio file
  GET  /api/v1/meetings/stream-audio         — serve a local audio file (local storage only)
  POST /api/v1/meetings/presigned-upload     — returns presigned PUT URL (S3) OR None (local)
  GET  /api/v1/meetings/{id}/audio-url       — returns playable URL regardless of backend
"""
import hmac
import hashlib
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from app.auth.jwt import get_current_user
from app.db.database import get_db
from app.models.meeting import (
    MeetingDetailResponse, UpdateMeetingRequest,
    CreateMeetingRequest, IMMUTABLE_FIELDS,
)
from app.worker.tasks.email_notifications import send_transcription_ready_email
from app.models.serializers import serialize_meeting
from app.core.config import settings
from app.core.storage import get_storage
import logging
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])

# IST Timezone - for reference only, we store IST directly
IST = ZoneInfo("Asia/Kolkata")


def format_ist_for_display(date_time_input):
    """
    Format date_time (stored as IST) for display in MoM.
    No conversion needed - just format the stored IST time.
    Returns: (date_str, time_str in 24-hour format)
    """
    try:
        if isinstance(date_time_input, datetime):
            dt = date_time_input
        elif isinstance(date_time_input, str):
            # Parse the IST string (format: YYYY-MM-DDTHH:mm:ss)
            dt = datetime.fromisoformat(date_time_input)
        else:
            return "N/A", "N/A"

        # Format for display
        date_str = dt.strftime("%B %d, %Y")
        time_str = dt.strftime("%H:%M")  # 24-hour format
        return date_str, time_str
    except Exception as e:
        logger.warning(f"Failed to format date_time '{date_time_input}': {e}")
        return "N/A", "N/A"


def _verify_backend1_signature(request: Request, body_bytes: bytes) -> bool:
    secret = settings.backend1_hmac_secret
    if not secret:
        return True
    signature = request.headers.get("X-Backend1-Signature", "")
    expected  = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


# ─── POST / — Create Meeting ──────────────────────────────────────────────────

@router.post("/", response_model=MeetingDetailResponse, status_code=201)
async def create_meeting(
    body: CreateMeetingRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    now = datetime.now(timezone.utc)

    # Store date_time as-is from frontend (IST format: YYYY-MM-DDTHH:mm:ss)
    # No timezone conversion - frontend sends IST directly
    date_time_to_store = body.date_time if body.date_time else now.strftime("%Y-%m-%dT%H:%M:%S")

    doc = {
        "meeting_id":      body.meeting_id,
        "user_id":         current_user["user_id"],
        "attendees":       body.attendees,
        "context":         body.context,
        "no_of_persons":   body.no_of_persons,
        "date_time":       date_time_to_store,
        "audio_s3_key":    body.audio_s3_key,
        "storage_backend": get_storage().backend_name(),
        "status":          "audio_uploaded",
        "audio_state":     body.audio_state if hasattr(body, "audio_state") and body.audio_state else "merged",
        "transcript":      None,
        "diagram":         None,
        "rag_indexed":     False,
        "rag_indexed_at":  None,
        "mom":             None,
        "summary":         None,
        "key_points":      None,
        "email_transferred": False,
        "meet_link":       body.meet_link,
        "bot_session_id":  None,
        "created_at":      now,
        "updated_at":      now,
    }
    try:
        await db.meetings.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail={"code": "MEETING_EXISTS", "message": f"Meeting '{body.meeting_id}' already exists"},
        )
    return {"success": True, "data": serialize_meeting(doc), "meta": {"created_at": now.isoformat()}}


# ─── GET / — List Meetings ─────────────────────────────────────────────────────

@router.get("/")
async def list_meetings(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    skip  = (page - 1) * limit
    role  = current_user.get("role", "user")
    query = {} if role == "admin" else {"user_id": current_user["user_id"]}
    cursor   = db.meetings.find(query, sort=[("created_at", -1)]).skip(skip).limit(limit)
    meetings = await cursor.to_list(length=limit)
    total    = await db.meetings.count_documents(query)
    return {"success": True, "data": [serialize_meeting(m) for m in meetings],
            "meta": {"total": total, "page": page, "limit": limit}}


# ─── POST /presigned-upload ────────────────────────────────────────────────────

@router.post("/presigned-upload")
async def get_upload_url(
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Get a presigned upload URL for the audio file.
    Frontend can PUT directly to this URL.
    """
    meeting_id = body.get("meeting_id")
    if not meeting_id:
        raise HTTPException(status_code=422, detail={"code": "MISSING_MEETING_ID"})

    from app.core.s3_utils import build_audio_s3_key
    s3_key  = build_audio_s3_key(current_user["user_id"], meeting_id)
    storage = get_storage()

    upload_url = None

    if storage.backend_name() == "s3":
        upload_url = storage.get_upload_presigned_url(s3_key)

    return {
        "upload_url":      upload_url,
        "audio_s3_key":    s3_key,
        "storage_backend": storage.backend_name(),
        "url_type":        "presigned_url",
    }


# ─── POST /upload-audio — Direct audio upload ─────────────────────────────────

@router.post("/upload-audio")
async def upload_audio_direct(
    meeting_id: str = Form(...),
    audio:      UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    from app.core.s3_utils import build_audio_s3_key
    s3_key  = build_audio_s3_key(current_user["user_id"], meeting_id)
    storage = get_storage()

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_FILE"})

    try:
        storage.upload_audio(data, s3_key)
    except Exception as e:
        logger.error(f"Direct upload failed: {e}")
        raise HTTPException(status_code=500, detail={"code": "UPLOAD_FAILED", "message": str(e)})

    return {"success": True, "audio_s3_key": s3_key, "size_bytes": len(data)}


# ─── GET /stream-audio — Download local audio file ───────────────────────────

@router.get("/stream-audio")
async def stream_audio_local(
    key: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    if get_storage().backend_name() != "local":
        raise HTTPException(status_code=400, detail={"code": "NOT_LOCAL_STORAGE"})

    role = current_user.get("role", "user")
    if role != "admin":
        meeting = await db.meetings.find_one({"audio_s3_key": key, "user_id": current_user["user_id"]})
        if not meeting:
            chunk = await db.audio_chunks.find_one({"s3_key": key, "user_id": current_user["user_id"]})
            if not chunk:
                raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    try:
        data = get_storage().read_audio(key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "AUDIO_NOT_FOUND",
            "message": f"Audio file not found on disk for key: {key}"})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "READ_FAILED", "message": str(e)})

    filename = key.rsplit("/", 1)[-1] if "/" in key else key
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    content_type_map = {
        "webm": "audio/webm", "ogg": "audio/ogg", "wav": "audio/wav",
        "mp3": "audio/mpeg", "mp4": "audio/mp4", "m4a": "audio/mp4",
    }
    content_type = content_type_map.get(ext, "application/octet-stream")

    def iter_bytes():
        yield data

    return StreamingResponse(
        iter_bytes(),
        media_type=content_type,
        headers={
            "Content-Length":      str(len(data)),
            "Content-Disposition": f'inline; filename="{filename}"',
            "Accept-Ranges":       "bytes",
            "Cache-Control":       "no-cache",
        },
    )


# ─── POST /{meeting_id}/chunks — Upload one audio chunk ──────────────────────

@router.post("/{meeting_id}/chunks")
async def upload_audio_chunk(
    meeting_id: str,
    chunk_id:   int = Form(..., description="0-based sequential chunk index"),
    timestamp:  str = Form(..., description="ISO8601 timestamp of chunk start"),
    audio:      UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_CHUNK"})

    user_id = meeting["user_id"]
    s3_key  = f"audio/{user_id}/{meeting_id}/chunks/chunk_{chunk_id:05d}.webm"
    storage = get_storage()

    try:
        storage.upload_audio(data, s3_key)
    except Exception as e:
        error_str = str(e)
        logger.error(f"Chunk upload failed: {e}")

        # Check if it's an S3 AccessDenied error
        if "AccessDenied" in error_str:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "S3_ACCESS_DENIED",
                    "message": "S3 bucket policy doesn't allow PutObject for this path.",
                    "suggestion": "Update your S3 bucket policy to allow s3:PutObject for audio/* from your server IP.",
                    "s3_key": s3_key,
                    "original_error": error_str
                }
            )

        raise HTTPException(status_code=500, detail={"code": "UPLOAD_FAILED", "message": str(e)})

    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except Exception:
        ts = datetime.now(timezone.utc)

    now = datetime.now(timezone.utc)

    await db.audio_chunks.update_one(
        {"meeting_id": meeting_id, "chunk_id": chunk_id},
        {"$set": {
            "meeting_id":  meeting_id,
            "user_id":     user_id,
            "chunk_id":    chunk_id,
            "s3_key":      s3_key,
            "size_bytes":  len(data),
            "timestamp":   ts,
            "uploaded_at": now,
            "storage_backend": storage.backend_name(),
        }},
        upsert=True,
    )

    await db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {
            "status":      "recording",
            "audio_state": "chunked",
            "updated_at":  now,
        },
         "$max": {"last_chunk_id": chunk_id}},
    )

    logger.info(f"Chunk {chunk_id} uploaded for meeting {meeting_id} ({len(data)} bytes)")
    return {"success": True, "chunk_id": chunk_id, "size_bytes": len(data), "s3_key": s3_key}


# ─── POST /{meeting_id}/merge-chunks ─────────────────────────────────────────

@router.post("/{meeting_id}/merge-chunks")
async def merge_audio_chunks(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    chunks_cursor = db.audio_chunks.find(
        {"meeting_id": meeting_id},
        sort=[("chunk_id", 1)],
    )
    chunks = await chunks_cursor.to_list(length=10000)

    if not chunks:
        raise HTTPException(
            status_code=400,
            detail={"code": "NO_CHUNKS", "message": "No audio chunks found for this meeting"},
        )

    storage = get_storage()
    merged_data = bytearray()
    now = datetime.now(timezone.utc)

    for chunk in chunks:
        try:
            data = storage.read_audio(chunk["s3_key"])
            merged_data.extend(data)
        except Exception as e:
            logger.error(f"Failed to read chunk {chunk['chunk_id']} for {meeting_id}: {e}")
            await db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "status":      "failed",
                    "audio_state": "chunked",
                    "updated_at":  now,
                    "merge_error": f"Failed to read chunk {chunk['chunk_id']}: {e}",
                }},
            )
            raise HTTPException(
                status_code=500,
                detail={"code": "CHUNK_READ_FAILED",
                        "message": f"Failed to read chunk {chunk['chunk_id']}: {e}"},
            )

    if not merged_data:
        await db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {
                "status":      "failed",
                "audio_state": "chunked",
                "updated_at":  now,
                "merge_error": "Merged audio data is empty",
            }},
        )
        raise HTTPException(status_code=500, detail={"code": "EMPTY_MERGE"})

    user_id    = meeting["user_id"]
    merged_key = f"audio/{user_id}/{meeting_id}/{meeting_id}.webm"

    try:
        storage.upload_audio(bytes(merged_data), merged_key)
    except Exception as e:
        await db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {
                "status":      "failed",
                "audio_state": "chunked",
                "updated_at":  now,
                "merge_error": f"Merge upload failed: {e}",
            }},
        )
        raise HTTPException(
            status_code=500,
            detail={"code": "MERGE_UPLOAD_FAILED", "message": str(e)},
        )

    await db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {
            "audio_s3_key":    merged_key,
            "storage_backend": storage.backend_name(),
            "status":          "audio_uploaded",
            "audio_state":     "merged",
            "updated_at":      now,
        }},
    )

    for chunk in chunks:
        try:
            storage.delete_audio(chunk["s3_key"])
        except Exception:
            pass

    await db.audio_chunks.delete_many({"meeting_id": meeting_id})

    # Push to processing queue
    try:
        s3_link = storage.get_download_url(merged_key)
        await db.processing_queue.insert_one({
            "meeting_id": meeting_id,
            "user_id":    user_id,
            "s3_link":    s3_link,
            "status":     "pending",
            "retry_count": 0,
            "max_retries": settings.processing_max_retries,
            "error_message": None,
            "created_at": now,
            "updated_at": now,
            "processing_started_at": None,
            "completed_at": None,
            "last_error_at": None,
        })
        logger.info(f"Pushed meeting {meeting_id} to processing queue")
    except Exception as e:
        logger.error(f"Failed to push meeting {meeting_id} to processing queue: {e}")

    total_bytes = len(merged_data)
    logger.info(f"Merged {len(chunks)} chunks ({total_bytes} bytes) for meeting {meeting_id}")
    return {
        "success":       True,
        "meeting_id":    meeting_id,
        "chunks_merged": len(chunks),
        "total_bytes":   total_bytes,
        "audio_s3_key":  merged_key,
    }


# ─── Inline RAG Indexing Helper ───────────────────────────────────────────────

async def _index_transcript_inline(meeting_id: str, user_id: str, transcript_text: str, db) -> None:
    import asyncio
    import uuid as _uuid

    loop = asyncio.get_event_loop()

    def _do_index():
        from openai import OpenAI
        from qdrant_client import QdrantClient
        from qdrant_client.models import PointStruct, Filter, FieldCondition, MatchValue
        from pymongo import MongoClient

        sync_client = MongoClient(settings.mongo_uri)
        sync_db     = sync_client[settings.mongo_db_name]

        openai_client = OpenAI(api_key=settings.openai_api_key)
        qdrant_client = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)

        try:
            qdrant_client.delete(
                collection_name=settings.qdrant_collection,
                points_selector=Filter(
                    must=[FieldCondition(key="meeting_id", match=MatchValue(value=meeting_id))]
                ),
            )
        except Exception as e:
            logger.warning(f"Qdrant delete (pre-index) failed for {meeting_id}: {e}")

        chunk_size = settings.chunk_size_tokens * 4
        overlap    = settings.chunk_overlap_tokens * 4
        text       = transcript_text
        chunks     = []
        start      = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            if end < len(text):
                snap = text.rfind(" ", start, end)
                if snap > start:
                    end = snap
            chunks.append(text[start:end].strip())
            if end >= len(text):
                break
            start = end - overlap

        chunks = [c for c in chunks if c]
        if not chunks:
            return

        all_embeddings = []
        for i in range(0, len(chunks), 100):
            batch = chunks[i:i + 100]
            resp  = openai_client.embeddings.create(input=batch, model=settings.embedding_model)
            all_embeddings.extend([d.embedding for d in resp.data])

        meeting_title = transcript_text[:80]
        points = [
            PointStruct(
                id=str(_uuid.uuid4()),
                vector=embedding,
                payload={
                    "user_id":       user_id,
                    "meeting_id":    meeting_id,
                    "meeting_title": meeting_title,
                    "chunk_index":   idx,
                    "chunk_text":    chunk,
                },
            )
            for idx, (chunk, embedding) in enumerate(zip(chunks, all_embeddings))
        ]

        for i in range(0, len(points), 100):
            qdrant_client.upsert(
                collection_name=settings.qdrant_collection,
                points=points[i:i + 100],
            )

        now = datetime.now(timezone.utc)
        sync_db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {"rag_indexed": True, "rag_indexed_at": now, "updated_at": now}},
        )
        sync_client.close()
        logger.info(f"Inline RAG indexing complete for {meeting_id} ({len(chunks)} chunks)")

    await loop.run_in_executor(None, _do_index)


# ─── GET /{meeting_id} ────────────────────────────────────────────────────────

@router.get("/{meeting_id}", response_model=MeetingDetailResponse)
async def get_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    if not meeting_id.strip():
        raise HTTPException(status_code=422, detail={"code": "VALIDATION_ERROR", "message": "meeting_id must not be empty"})
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND", "message": f"No meeting found with id '{meeting_id}'"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "You do not have permission to access this meeting."})
    return {"success": True, "data": serialize_meeting(meeting), "meta": {"requested_at": datetime.now(timezone.utc).isoformat()}}


# ─── PATCH /{meeting_id} ──────────────────────────────────────────────────────

@router.patch("/{meeting_id}", response_model=MeetingDetailResponse)
async def update_meeting(
    meeting_id: str,
    request: Request,
    body: UpdateMeetingRequest,
    force: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    if not meeting_id.strip():
        raise HTTPException(status_code=422, detail={"code": "VALIDATION_ERROR", "message": "meeting_id must not be empty"})
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND", "message": f"No meeting found with id '{meeting_id}'"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "You do not have permission to modify this meeting."})

    update_data_raw = body.model_dump(exclude_none=True)
    if "transcript" in update_data_raw:
        raw_body = await request.body()
        if not _verify_backend1_signature(request, raw_body):
            raise HTTPException(status_code=403, detail={"code": "INVALID_SIGNATURE"})

    # Explicitly normalize transcript if present: ensure both 'text' (string) and 'segments' (array) are set
    if "transcript" in update_data_raw and update_data_raw["transcript"]:
        transcript = update_data_raw["transcript"]
        # Get existing speaker names from current meeting to preserve them during updates
        existing_speaker_names = {}
        existing_transcript = meeting.get("transcript")
        if existing_transcript and existing_transcript.get("segments"):
            for seg in existing_transcript["segments"]:
                if seg.get("speaker_name"):
                    existing_speaker_names[seg["speaker"]] = seg["speaker_name"]

        # If text is an array of segments, move it to segments and set text to joined string
        if isinstance(transcript.get("text"), list):
            segments_list = transcript["text"]
            # Validate each segment has required fields
            normalized_segments = []
            for seg in segments_list:
                if isinstance(seg, dict) and all(k in seg for k in ["speaker", "start", "end", "text"]):
                    # Preserve existing speaker_name if not being updated
                    speaker_name = seg.get("speaker_name", "")
                    if not speaker_name and seg["speaker"] in existing_speaker_names:
                        speaker_name = existing_speaker_names[seg["speaker"]]
                    normalized_segments.append({
                        "speaker": seg["speaker"],
                        "speaker_name": speaker_name,
                        "start": float(seg["start"]),
                        "end": float(seg["end"]),
                        "text": str(seg["text"])
                    })
            if normalized_segments:
                update_data_raw["transcript"]["segments"] = normalized_segments
                update_data_raw["transcript"]["text"] = " ".join(seg["text"] for seg in normalized_segments)
        # Ensure segments field exists even if text was already a string
        elif "segments" not in transcript or not transcript["segments"]:
            # Create a single segment from plain text
            text_content = transcript.get("text", "")
            if text_content:
                update_data_raw["transcript"]["segments"] = [{
                    "speaker": "SPEAKER_00",
                    "speaker_name": "",
                    "start": 0.0,
                    "end": 0.0,
                    "text": str(text_content)
                }]

    update_data = {k: v for k, v in update_data_raw.items() if k not in IMMUTABLE_FIELDS}
    if not update_data:
        raise HTTPException(status_code=400, detail={"code": "NO_EDITABLE_FIELDS"})

    if "attendees" in update_data or "no_of_persons" in update_data:
        attendees     = update_data.get("attendees", meeting.get("attendees", []))
        no_of_persons = update_data.get("no_of_persons")
        if no_of_persons is not None and no_of_persons != len(attendees):
            raise HTTPException(status_code=422, detail={"code": "VALIDATION_ERROR",
                "message": f"no_of_persons ({no_of_persons}) must equal len(attendees) ({len(attendees)})"})

    if "transcript" in update_data and meeting.get("transcript") and not force:
        raise HTTPException(status_code=409, detail={"code": "TRANSCRIPT_ALREADY_SET",
            "message": "Transcript already exists. Pass ?force=true to overwrite."})

    now = datetime.now(timezone.utc)
    update_data["updated_at"] = now


    if "transcript" in update_data:
        update_data["status"]                    = "transcript_ready"
        update_data["transcript"]["received_at"] = now
        update_data["diagram"]        = None
        update_data["rag_indexed"]    = False
        update_data["rag_indexed_at"] = None
        update_data["mom"]            = None
        update_data["summary"]        = None
        update_data["key_points"]     = None

    result = await db.meetings.find_one_and_update(
        {"meeting_id": meeting_id}, {"$set": update_data}, return_document=ReturnDocument.AFTER)

    # Trigger email notification ONLY when status transitions to 'transcript_ready'
    # and it hasn't been transferred yet.
    if update_data.get("status") == "transcript_ready" and not meeting.get("email_transferred"):
        try:
            user_id = str(result.get("user_id") or current_user.get("user_id") or "")
            if not user_id:
                raise ValueError("missing user_id for email enqueue")
            send_transcription_ready_email.delay(
                    user_id, meeting_id)
            logger.info("Enqueued transcription ready email for meeting %s (user_id=%s)",
            meeting_id,
            user_id,
            )
        
        except Exception as e:
            logger.error("Failed to enqueue email for meeting %s: %s", meeting_id, e)

    if "transcript" in update_data:
        transcript_text = update_data["transcript"].get("text", "").strip()
        if transcript_text:
            try:
                await _index_transcript_inline(meeting_id, result["user_id"], transcript_text, db)
                result = await db.meetings.find_one({"meeting_id": meeting_id})
            except Exception as e:
                logger.error(f"Inline RAG indexing failed for {meeting_id}: {e}")

    return {"success": True, "data": serialize_meeting(result), "meta": {"updated_at": now.isoformat()}}


# ─── POST /{meeting_id}/generate/{output_type} ────────────────────────────────

@router.post("/{meeting_id}/generate/{output_type}")
async def trigger_generation(
    meeting_id: str,
    output_type: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    VALID = {"mom", "summary", "key_points", "diagram"}
    if output_type not in VALID:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_OUTPUT_TYPE",
                    "message": f"output_type must be one of: {', '.join(sorted(VALID))}"},
        )

    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    transcript = meeting.get("transcript") or {}

    # Format transcript with speaker names for better LLM context
    segments = transcript.get("segments", [])
    if segments:
        # Build formatted transcript with speaker names
        formatted_lines = []
        for seg in segments:
            speaker_label = seg.get("speaker", "UNKNOWN")
            speaker_name = seg.get("speaker_name", "")
            display_name = speaker_name if speaker_name else speaker_label
            text = seg.get("text", "")
            formatted_lines.append(f"{display_name}: {text}")
        transcript_text = "\n".join(formatted_lines)
    else:
        transcript_text = transcript.get("text", "").strip()

    if not transcript_text:
        raise HTTPException(
            status_code=400,
            detail={"code": "NO_TRANSCRIPT", "message": "Cannot generate output without a transcript."},
        )

    # Extract meeting metadata for MoM generation
    context = meeting.get("context", "N/A")
    attendees = meeting.get("attendees", [])
    attendees_str = ", ".join(attendees) if attendees else "N/A"
    date_time = meeting.get("date_time", "")

    # Format date for display (stored as IST, display as-is)
    date_str, time_str = format_ist_for_display(date_time)

    now     = datetime.now(timezone.utc)

    if output_type == "diagram":
        import re as _re
        from openai import OpenAI

        await db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {
                "diagram": {"status": "pending", "type": None,
                            "mermaid_syntax": None, "generated_at": None, "error": None},
                "updated_at": now,
            }},
        )

        try:
            client = OpenAI(api_key=settings.openai_api_key)

            CLASSIFICATION_PROMPT = (
                "Analyze the following meeting transcript and determine if it describes a structured "
                "process that can be visualized as a diagram.\n\n"
                "Respond with EXACTLY ONE word (no punctuation, no explanation):\n"
                "  workflow       - series of steps or decisions\n"
                "  architecture   - system components and relationships\n"
                "  timeline       - events ordered by time or milestones\n"
                "  process        - business or operational process\n"
                "  none           - no clear diagrammatic structure\n\n"
                f"Transcript (first 3000 chars):\n{transcript_text[:3000]}"
            )

            cls_resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": CLASSIFICATION_PROMPT}],
                max_tokens=10,
                temperature=0,
            )
            diagram_type = _re.sub(r"[^a-z]", "", cls_resp.choices[0].message.content.strip().lower())

            valid_types = {"workflow", "architecture", "timeline", "process"}
            # Default to "flowchart" for general conversations - never return "not_applicable"
            if diagram_type not in valid_types:
                diagram_type = "flowchart"  # Default type for any conversation

            VALID_MERMAID_STARTS = [
                "graph ", "flowchart ", "sequenceDiagram", "gantt",
                "timeline", "classDiagram", "stateDiagram", "erDiagram", "journey",
                "mindmap",  # Support mindmap for general conversations
            ]

            def _clean(s: str) -> str:
                s = _re.sub(r"```mermaid\s*", "", s)
                s = _re.sub(r"```\s*", "", s)
                return s.strip()

            def _valid(s: str) -> bool:
                stripped = s.strip()
                return bool(stripped) and any(stripped.startswith(x) for x in VALID_MERMAID_STARTS)

            # Determine diagram complexity based on transcript length
            transcript_len = len(transcript_text)
            is_short = transcript_len < 1500  # Short conversation
            is_long = transcript_len > 5000   # Long detailed conversation

            if diagram_type == "flowchart":
                if is_short:
                    GEN_PROMPT = (
                        f"You are a Mermaid.js diagram generator. Create a SIMPLE flowchart/mindmap diagram "
                        f"summarizing the key topics and flow of this meeting.\n\n"
                        "Use 'mindmap' format for the best visual summary of a short conversation:\n"
                        "mindmap\n"
                        "  root((Meeting Topic))\n"
                        "    Key Point 1\n"
                        "    Key Point 2\n"
                        "    Key Point 3\n\n"
                        "CRITICAL RULES:\n"
                        "- Output ONLY raw Mermaid.js syntax\n"
                        "- Start with 'mindmap' keyword\n"
                        "- NO markdown code fences\n"
                        "- NO explanatory text\n"
                        "- Extract 5-10 key topics/themes from the conversation\n"
                        "- Use clear, concise labels (max 3-4 words per node)\n\n"
                        f"Transcript:\n{transcript_text[:3000]}\n\n"
                        f"Context: {context}"
                    )
                elif is_long:
                    GEN_PROMPT = (
                        f"You are a Mermaid.js diagram generator. Create a DETAILED flowchart diagram "
                        f"showing the complete structure and flow of this meeting.\n\n"
                        "Use 'flowchart TD' (top-down) format for complex discussions.\n"
                        "Include:\n"
                        "- Main topics as subgraphs\n"
                        "- Decision points where applicable\n"
                        "- Connections between related topics\n"
                        "- Action items or decisions as distinctive nodes\n\n"
                        "CRITICAL RULES:\n"
                        "- Output ONLY raw Mermaid.js syntax\n"
                        "- Start with 'flowchart TD'\n"
                        "- NO markdown code fences\n"
                        "- NO explanatory text\n"
                        "- Use subgraphs to organize topics\n"
                        "- Max 25-30 nodes for detailed view\n"
                        "- Use clear, descriptive labels\n\n"
                        f"Transcript:\n{transcript_text[:8000]}\n\n"
                        f"Context: {context}"
                    )
                else:
                    GEN_PROMPT = (
                        f"You are a Mermaid.js diagram generator. Create a flowchart diagram "
                        f"showing the structure and key points of this meeting.\n\n"
                        "Use 'flowchart TD' format showing the conversation flow.\n\n"
                        "CRITICAL RULES:\n"
                        "- Output ONLY raw Mermaid.js syntax\n"
                        "- Start with 'flowchart TD'\n"
                        "- NO markdown code fences\n"
                        "- NO explanatory text\n"
                        "- Show 10-15 key points/concepts\n"
                        "- Use arrows to show connections\n\n"
                        f"Transcript:\n{transcript_text[:5000]}\n\n"
                        f"Context: {context}"
                    )
            elif diagram_type == "workflow":
                GEN_PROMPT = (
                    f"You are a Mermaid.js diagram generator. Create a workflow diagram showing "
                    f"the steps, decisions, and processes discussed in this meeting.\n\n"
                    "Use 'flowchart TD' with decision diamonds (diamond shape) and process rectangles.\n\n"
                    "CRITICAL RULES:\n"
                    "- Output ONLY raw Mermaid.js syntax\n"
                    "- Start with 'flowchart TD'\n"
                    "- NO markdown code fences\n"
                    "- Use {{decision}} for decision points\n"
                    "- Use [process] for action steps\n"
                    "- Show clear yes/no paths from decisions\n\n"
                    f"Transcript:\n{transcript_text[:6000]}\n\n"
                    f"Context: {context}"
                )
            elif diagram_type == "architecture":
                GEN_PROMPT = (
                    f"You are a Mermaid.js diagram generator. Create an architecture diagram showing "
                    f"system components, their relationships, and data flows discussed in this meeting.\n\n"
                    "Use 'flowchart TB' (top-bottom) or 'graph TB' for architecture.\n\n"
                    "CRITICAL RULES:\n"
                    "- Output ONLY raw Mermaid.js syntax\n"
                    "- Start with 'flowchart TB' or 'graph TB'\n"
                    "- NO markdown code fences\n"
                    "- Show components as rectangles\n"
                    "- Show databases as cylinders [(Database)]\n"
                    "- Use clear arrows for data flow\n"
                    "- Label the connections with what flows between components\n\n"
                    f"Transcript:\n{transcript_text[:6000]}\n\n"
                    f"Context: {context}"
                )
            elif diagram_type == "timeline":
                GEN_PROMPT = (
                    f"You are a Mermaid.js diagram generator. Create a timeline diagram showing "
                    f"events, milestones, and sequences discussed in this meeting.\n\n"
                    "Use 'timeline' format for temporal data:\n"
                    "timeline\n"
                    "    title Meeting Timeline\n"
                    "    Section Phase 1\n"
                    "        Event 1 : 2024-01-01\n"
                    "        Event 2 : 2024-01-15\n\n"
                    "CRITICAL RULES:\n"
                    "- Output ONLY raw Mermaid.js syntax\n"
                    "- Start with 'timeline'\n"
                    "- NO markdown code fences\n"
                    "- Group events into logical phases/sections\n"
                    "- If specific dates aren't mentioned, use relative timing\n\n"
                    f"Transcript:\n{transcript_text[:6000]}\n\n"
                    f"Context: {context}"
                )
            elif diagram_type == "process":
                GEN_PROMPT = (
                    f"You are a Mermaid.js diagram generator. Create a process diagram showing "
                    f"business or operational processes discussed in this meeting.\n\n"
                    "Use 'flowchart LR' (left-right) for process flows.\n\n"
                    "CRITICAL RULES:\n"
                    "- Output ONLY raw Mermaid.js syntax\n"
                    "- Start with 'flowchart LR'\n"
                    "- NO markdown code fences\n"
                    "- Show sequential process steps\n"
                    "- Include decision points\n"
                    "- Show feedback loops if applicable\n\n"
                    f"Transcript:\n{transcript_text[:6000]}\n\n"
                    f"Context: {context}"
                )

            gen_resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": GEN_PROMPT}],
                max_tokens=1200 if is_long else 800,
                temperature=0.3,
            )
            mermaid_syntax = _clean(gen_resp.choices[0].message.content)

            if not _valid(mermaid_syntax):
                # Fallback: Try with a simpler prompt based on conversation length
                if is_short:
                    STRICT_PROMPT = (
                        "Create a simple mindmap diagram from this meeting. Start with 'mindmap'.\n"
                        "Format:\n"
                        "mindmap\n"
                        "  root((Meeting))\n"
                        "    Point1\n"
                        "    Point2\n"
                        "    Point3\n\n"
                        "Output ONLY the Mermaid syntax. No fences. Max 8 nodes.\n\n"
                        f"Transcript:\n{transcript_text[:2000]}"
                    )
                else:
                    STRICT_PROMPT = (
                        "Create a flowchart diagram from this meeting. Start with 'flowchart TD'.\n"
                        "Output ONLY the Mermaid syntax. No fences. No extra text.\n"
                        "Show the main topics discussed as nodes connected with arrows.\n\n"
                        f"Transcript:\n{transcript_text[:3000]}"
                    )
                gen_resp2 = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": STRICT_PROMPT}],
                    max_tokens=1000,
                    temperature=0.3,
                )
                mermaid_syntax = _clean(gen_resp2.choices[0].message.content)

            generated_at = datetime.now(timezone.utc)
            if _valid(mermaid_syntax):
                result_diagram = {
                    "status": "ready", "type": diagram_type,
                    "mermaid_syntax": mermaid_syntax,
                    "generated_at": generated_at, "error": None,
                }
            else:
                # Ultimate fallback: Generate a simple template-based diagram
                # This ensures we always return something useful
                import re as _re2

                # Extract key topics from transcript (simple extraction)
                words = transcript_text.split()
                title = context[:50] if context else "Meeting"

                if is_short:
                    # Simple mindmap fallback
                    mermaid_syntax = (
                        f"mindmap\n"
                        f"  root(({title}))\n"
                        f"    Discussion\n"
                        f"    Key Points\n"
                        f"    Decisions\n"
                        f"    Action Items"
                    )
                else:
                    # Simple flowchart fallback for longer meetings
                    mermaid_syntax = (
                        f"flowchart TD\n"
                        f"    A[Start: {title[:30]}] --> B[Discussion]\n"
                        f"    B --> C[Key Topics]\n"
                        f"    C --> D[Decisions Made]\n"
                        f"    D --> E[Action Items]\n"
                        f"    E --> F[End]"
                    )

                result_diagram = {
                    "status": "ready", "type": "flowchart",
                    "mermaid_syntax": mermaid_syntax,
                    "generated_at": generated_at, "error": None,
                }

            await db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {"diagram": result_diagram, "updated_at": generated_at}},
            )
            return {"success": True, "meeting_id": meeting_id,
                    "output_type": "diagram", "diagram": result_diagram}

        except Exception as e:
            logger.error(f"Inline diagram generation failed for {meeting_id}: {e}")
            failed_diagram = {
                "status": "failed", "type": None, "mermaid_syntax": None,
                "generated_at": None, "error": str(e),
            }
            await db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {"diagram": failed_diagram, "updated_at": datetime.now(timezone.utc)}},
            )
            raise HTTPException(
                status_code=500,
                detail={"code": "GENERATION_FAILED", "message": str(e)},
            )

    PROMPTS = {
    "mom": (
        "You are a senior business analyst and corporate documentation specialist with deep expertise in producing formal, board-ready Minutes of Meeting (MoM) documents.\n\n"
        "Your task is to transform the provided meeting transcript into a precise, professional MoM document that strictly follows the structural template defined below — no deviations, no omissions, no invented content.\n\n"

        "OUTPUT FORMAT (Follow this EXACTLY):\n\n"

        "---\n\n"
        "MOM — Meeting | " + date_str + " | Smart MoM\n\n"
        "# MINUTES OF MEETING\n"
        "## " + context + "\n"
        "### " + date_str + " | Smart MoM | General\n\n"

        "| Field              | Details                                                                 |\n"
        "|--------------------|-------------------------------------------------------------------------|\n"
        "| Date               | " + date_str + " at " + time_str + "                                     |\n"
        "| Title              | " + context + "                                                          |\n"
        "| Project / Meeting Type | (Extract from transcript)                                           |\n"
        "| Participants       | " + attendees_str + "                                                    |\n"
        "| Topics Covered     | (Extract from transcript)                                               |\n\n"

        "---\n\n"
        "## 1. AGENDA\n\n"
        "- {Agenda item 1: describe the purpose of each discussion topic as a clear, outcome-oriented statement}\n"
        "- {Agenda item 2}\n"
        "- {Agenda item 3}\n"
        "- {Continue for all identifiable agenda items from the transcript}\n\n"

        "---\n\n"
        "## 2. DISCUSSION SUMMARY\n\n"
        "### 2.1 {First Major Topic Title — Descriptive, Noun-Phrase Format}\n\n"
        "{Opening sentence summarising the nature and tone of this discussion in 1-2 sentences.}\n\n"
        "- {Specific discussion point — factual, attributed where possible}\n"
        "- {Specific discussion point — include any data, dates, names, or decisions referenced}\n"
        "- {Specific discussion point — note concerns, reactions, or positions taken by participants}\n"
        "- {Continue with all substantive points raised under this topic}\n\n"
        "### 2.2 {Second Major Topic Title}\n\n"
        "{Opening summary sentence.}\n\n"
        "- {Discussion point}\n"
        "- {Discussion point}\n"
        "- {Continue...}\n\n"
        "### 2.{N} {Nth Major Topic Title}\n\n"
        "{Continue for all major discussion areas covered in the transcript.}\n\n"

        "---\n\n"
        "## 3. DECISIONS MADE\n\n"
        "- {Decision 1 — state clearly what was agreed, resolved, or committed to. Be specific and unambiguous.}\n"
        "- {Decision 2}\n"
        "- {Decision 3}\n"
        "- {Continue for all firm decisions reached during the meeting}\n\n"

        "---\n\n"
        "## 4. ACTION ITEMS\n\n"
        "| # | Action Item | Owner | Priority | Status |\n"
        "|---|-------------|-------|----------|--------|\n"
        "| 1 | {Specific, verb-led action — what must be done, by whom, and toward what outcome} | {Name / Role} | {Immediate / High / Medium / Low} | {Open / In Progress / Closed / TBD} |\n"
        "| 2 | {Next action item} | {Owner} | {Priority} | {Status} |\n"
        "| 3 | {Continue for all action items derived from the transcript} | | | |\n\n"

        "---\n\n"
        "## 5. OPEN ISSUES & UNRESOLVED ITEMS\n\n"
        "| # | Open Issue / Unresolved Item | Context & Risk |\n"
        "|---|------------------------------|----------------|\n"
        "| 1 | {Concise label for the issue} | {1-2 sentences: what the issue is, why it matters, and what risk it poses if unresolved} |\n"
        "| 2 | {Next issue} | {Context & risk} |\n"
        "| 3 | {Continue for all unresolved or pending items} | |\n\n"

        "---\n\n"
        "## 6. NEXT STEPS\n\n"
        "- {Next step 1 — specific, actionable, owned where possible}\n"
        "- {Next step 2}\n"
        "- {Next step 3}\n"
        "- {Continue for all agreed next steps and follow-up actions}\n\n"

        "---\n\n"
        "## 7. MOOD OF THE CLIENT\n\n"
        "- {Analyse each speaker’s tone, sentiment, and intent based strictly on their statements in the transcript}\n"
        "- {Identify and describe the emotional or professional stance of key participants (e.g., positive, concerned, neutral, frustrated, confident)}\n"
        "- {Highlight any notable shifts in mood during the meeting and attribute them where possible}\n"
        "- {Do not infer beyond what is reasonably supported by the transcript; avoid speculation}\n\n"

        "---\n\n"
        "## 8. OUT OF SCOPE DISCUSSION\n\n"
        "- {Analyse the overall meeting context and identify any discussions that deviate from the primary agenda or stated objectives}\n"
        "- {List any such out-of-scope topics with brief context}\n"
        "- {Clearly distinguish between relevant extensions and truly unrelated discussions}\n"
        "- {If no such discussion exists, explicitly state: 'No out-of-scope discussions identified'}\n\n"

        "---\n\n"
        "*Note: This MoM captures the key discussion points from the meeting transcript provided. "
        "Any items deliberately excluded by the participants have been respected and omitted from this record. "
        "Speaker attribution follows the actual speaker names from the transcript.*\n\n"
        "*End of Minutes | " + date_str + " | Smart MoM | Confidential*\n\n"
        "---\n\n"

        "CRITICAL RULES — FOLLOW BEFORE GENERATING OUTPUT:\n\n"
        "FIDELITY RULES:\n"
        "1. Never fabricate — only include information explicitly stated or clearly implied in the transcript. Use [Not mentioned] or [To be confirmed] for genuinely missing fields.\n"
        "2. Do not summarise away specifics — preserve names, numbers, dates, product names, and verbatim decisions where they appear in the transcript.\n"
        "3. Attribute correctly — when a speaker makes a specific point, decision, or commitment, attribute it to them by name and role (e.g., 'Ranjit noted that...' or 'Anindya confirmed...').\n\n"
        "STRUCTURAL RULES:\n"
        "4. Follow the exact section numbering and heading hierarchy shown above — do not rename, reorder, or collapse sections.\n"
        "5. The metadata block must be rendered as a two-column Markdown table.\n"
        "6. Action Items and Open Issues must be rendered as properly formatted Markdown tables — no prose substitutes.\n"
        "7. The header line (MOM — ... | ... | ...) must appear as the very first line of the output.\n\n"
        "TONE & STYLE RULES:\n"
        "8. Use formal, third-person corporate prose — no first-person narration, no casual language.\n"
        "9. Action items must begin with a verb in the infinitive form (e.g., 'Review...', 'Share...', 'Schedule...').\n"
        "10. Discussion points must be specific and atomic — one idea per bullet, no compound statements.\n"
        "11. Open Issues must include both a concise label and a risk-framed contextual explanation.\n"
        "12. The Topics Covered field in the metadata must use · (middle dot) as a separator.\n\n"
        "PRIORITY & STATUS VOCABULARY:\n"
        "- Priority values: Immediate | High | Medium | Low\n"
        "- Status values: Open | In Progress | Closed | TBD | Deferred\n\n"
        "Now generate the complete MoM document following the format and rules above. Begin immediately with the header line.\n\n"        f"Transcript:\n{transcript_text}\n\n"
        f"Meeting Title: {context}\n"
        f"Participants: {attendees_str}\n"
        f"Date: {date_str}\n"
        f"Time: {time_str}"
    ),
    "summary": (
        "Provide a concise executive summary (3-5 sentences) of the following meeting:\n\n"
        f"Transcript:\n{transcript_text}\n\nContext: {context}"
    ),
    "key_points": (
        "Extract the top 5-10 key points from this meeting transcript as a numbered list:\n\n"
        f"Transcript:\n{transcript_text}\n\nContext: {context}"
    ),
}

    prompt = PROMPTS[output_type]

    try:
        from openai import OpenAI
        import os

        # Create OpenAI client with optional base URL (for Azure/custom endpoints)
        client_kwargs = {"api_key": settings.openai_api_key}
        if settings.openai_base_url:
            client_kwargs["base_url"] = settings.openai_api_key
            logger.info(f"Using custom OpenAI base_url: {settings.openai_api_key}")

        client = OpenAI(**client_kwargs)

        response = client.chat.completions.create(
            model="gpt-5.4-mini",
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=15000 if output_type == "mom" else 2000,
        )

        # Log the full response structure for debugging
        logger.info(f"OpenAI response structure: id={response.id}, choices_count={len(response.choices) if response.choices else 0}")

        # Safely extract content with proper error handling
        output_text = None
        if response and response.choices and len(response.choices) > 0:
            choice = response.choices[0]
            logger.info(f"Choice: finish_reason={choice.finish_reason}, index={choice.index}")
            output_text = choice.message.content
            logger.info(f"Content extracted: is_null={output_text is None}, is_empty={output_text == '' if output_text else 'N/A'}, length={len(output_text) if output_text else 0}")

        # Check if we got a valid response
        if not output_text or len(output_text.strip()) == 0:
            logger.error(f"OpenAI returned empty response for {output_type} / {meeting_id}. "
                        f"response={response}, content={output_text}, finish_reason={response.choices[0].finish_reason if response.choices else 'N/A'}")
            raise HTTPException(
                status_code=500,
                detail={"code": "EMPTY_RESPONSE", "message": "The AI model returned an empty response. Please try again or contact support."},
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OpenAI call failed for {output_type} / {meeting_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "GENERATION_FAILED", "message": str(e)},
        )

    generated_at = datetime.now(timezone.utc)
    await db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {output_type: output_text, "updated_at": generated_at}},
    )

    logger.info(f"Generated {output_type} synchronously for {meeting_id}")
    return {
        "success":     True,
        "meeting_id":  meeting_id,
        "output_type": output_type,
        output_type:   output_text,
    }


@router.get("/{meeting_id}/audio-url")
async def get_audio_url(
    meeting_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    audio_key = meeting.get("audio_s3_key")
    if not audio_key:
        raise HTTPException(status_code=404, detail={"code": "AUDIO_KEY_MISSING",
            "message": "No audio key stored for this meeting"})

    import time, base64, urllib.parse
    exp     = int(time.time()) + 3600
    payload = f"{meeting_id}:{current_user['user_id']}:{exp}"
    sig     = hmac.new(
        settings.jwt_secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    # Strip base64 padding (=) so the token is URL-safe without %3D encoding.
    # The download endpoint restores padding before decoding.
    token    = base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode().rstrip("=")
    origin   = str(request.base_url).rstrip("/")
    audio_url = f"{origin}/api/v1/meetings/{meeting_id}/download-audio?token={urllib.parse.quote(token)}"

    storage = get_storage()
    return {
        "audio_url":       audio_url,
        "storage_backend": storage.backend_name(),
        "type":            "signed_download_url",
        "audio_s3_key":    audio_key,
        "expires_in":      3600,
    }


@router.get("/{meeting_id}/download-audio")
async def download_audio(
    meeting_id: str,
    token: str,
    db=Depends(get_db),
):

    import time, base64, urllib.parse
    try:
        # URL-decode in case the token was double-encoded (e.g. via Cloudflare tunnel
        # or a browser that re-encodes query-string values containing = or + chars).
        token_clean = urllib.parse.unquote(token)
        # Restore any stripped base64 padding characters
        missing      = (4 - len(token_clean) % 4) % 4
        token_padded = token_clean + "=" * missing
        decoded      = base64.urlsafe_b64decode(token_padded.encode()).decode()
        parts        = decoded.rsplit(":", 1)
        if len(parts) != 2:
            raise ValueError("missing signature separator")
        sig_recv   = parts[1]
        rest       = parts[0]
        rest_parts = rest.split(":")
        if len(rest_parts) != 3:
            raise ValueError(f"expected 3 payload parts, got {len(rest_parts)}: {rest_parts!r}")
        tok_meeting_id, tok_user_id, tok_exp = rest_parts
        tok_exp = int(tok_exp)
    except Exception as _token_err:
        logger.warning(f"download-audio token parse error: {_token_err} | raw token: {token[:40]!r}")
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN", "message": "Malformed download token"})

    sig_expected = hmac.new(
        settings.jwt_secret.encode(),
        f"{tok_meeting_id}:{tok_user_id}:{tok_exp}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig_recv, sig_expected):
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN", "message": "Token signature invalid"})

    if time.time() > tok_exp:
        raise HTTPException(status_code=401, detail={"code": "TOKEN_EXPIRED", "message": "Download link has expired"})

    if tok_meeting_id != meeting_id:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})

    meeting_user = meeting.get("user_id", "")
    if tok_user_id != meeting_user:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    audio_key = meeting.get("audio_s3_key")
    if not audio_key:
        raise HTTPException(status_code=404, detail={"code": "AUDIO_KEY_MISSING"})

    try:
        data = get_storage().read_audio(audio_key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "AUDIO_NOT_FOUND",
            "message": f"Audio file not found: {audio_key}"})
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "READ_FAILED", "message": str(e)})

    filename = audio_key.rsplit("/", 1)[-1] if "/" in audio_key else audio_key
    ext      = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    content_type_map = {
        "webm": "audio/webm", "ogg": "audio/ogg", "wav": "audio/wav",
        "mp3": "audio/mpeg", "mp4": "audio/mp4", "m4a": "audio/mp4",
    }
    content_type = content_type_map.get(ext, "application/octet-stream")

    def iter_bytes():
        yield data

    return StreamingResponse(
        iter_bytes(),
        media_type=content_type,
        headers={
            "Content-Length":      str(len(data)),
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control":       "no-store",
        },
    )


@router.delete("/{meeting_id}")
async def delete_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND", "message": f"No meeting found with id '{meeting_id}'"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "You do not have permission to delete this meeting."})

    await db.meetings.delete_one({"meeting_id": meeting_id})

    try:
        get_storage().delete_audio(meeting["audio_s3_key"])
    except Exception as e:
        logger.warning(f"Could not delete audio for {meeting_id}: {e}")

    await db.audio_chunks.delete_many({"meeting_id": meeting_id})

    try:
        from app.db.qdrant_client import get_qdrant
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        qdrant = get_qdrant()
        qdrant.delete(collection_name=settings.qdrant_collection,
                      points_selector=Filter(must=[FieldCondition(key="meeting_id", match=MatchValue(value=meeting_id))]))
    except Exception as e:
        logger.warning(f"Failed to clean Qdrant vectors for {meeting_id}: {e}")

    return {"success": True, "message": f"Meeting '{meeting_id}' deleted"}
