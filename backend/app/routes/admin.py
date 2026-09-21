"""
Admin-only API routes.
All endpoints here require the 'admin' role.
Covers: user management, bulk operations, platform oversight.
"""
from bson import ObjectId
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from app.auth.jwt import require_admin
from app.db.database import get_db
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """List all users with pagination."""
    skip  = (page - 1) * limit
    users = await db.users.find(
        {},
        sort=[("created_at", -1)],
        projection={"_id": 1, "email": 1, "name": 1, "role": 1, "created_at": 1, "last_login_at": 1, "avatar_url": 1, "auth_provider": 1},
    ).skip(skip).limit(limit).to_list(length=limit)
    total = await db.users.count_documents({})

    for u in users:
        u["user_id"] = str(u.pop("_id"))

    return {
        "success": True,
        "data":    users,
        "meta":    {"total": total, "page": page, "limit": limit},
    }


class SetRoleRequest(BaseModel):
    role: str  # "user" | "admin"


@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: str,
    body: SetRoleRequest,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Promote or demote a user. Cannot demote yourself."""
    if body.role not in ("user", "admin"):
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_ROLE", "message": "role must be 'user' or 'admin'"},
        )

    if user_id == current_user["user_id"]:
        raise HTTPException(
            status_code=400,
            detail={"code": "CANNOT_MODIFY_SELF", "message": "You cannot change your own role"},
        )

    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=422, detail={"code": "INVALID_USER_ID"})

    result = await db.users.update_one({"_id": oid}, {"$set": {"role": body.role}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})

    return {"success": True, "message": f"User {user_id} role set to '{body.role}'"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Delete a user account and all their meetings. Cannot delete yourself."""
    if user_id == current_user["user_id"]:
        raise HTTPException(
            status_code=400,
            detail={"code": "CANNOT_DELETE_SELF", "message": "You cannot delete your own account"},
        )

    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=422, detail={"code": "INVALID_USER_ID"})

    user = await db.users.find_one({"_id": oid})
    if not user:
        raise HTTPException(status_code=404, detail={"code": "USER_NOT_FOUND"})

    # Cascade delete
    meeting_ids = [
        m["meeting_id"]
        async for m in db.meetings.find({"user_id": user_id}, {"meeting_id": 1})
    ]
    await db.meetings.delete_many({"user_id": user_id})
    await db.chat_sessions.delete_many({"user_id": user_id})
    await db.users.delete_one({"_id": oid})

    # Best-effort Qdrant cleanup
    if meeting_ids:
        try:
            from app.db.qdrant_client import get_qdrant
            from qdrant_client.models import Filter, FieldCondition, MatchAny
            from app.core.config import settings
            qdrant = get_qdrant()
            qdrant.delete(
                collection_name=settings.qdrant_collection,
                points_selector=Filter(
                    must=[FieldCondition(key="user_id", match=MatchAny(any=[user_id]))]
                ),
            )
        except Exception as e:
            logger.warning(f"Failed to clean Qdrant vectors for deleted user {user_id}: {e}")

    return {
        "success": True,
        "message": f"User {user_id} and {len(meeting_ids)} meetings deleted",
    }


# ─── Meetings (admin scope) ───────────────────────────────────────────────────

@router.get("/meetings")
async def admin_list_all_meetings(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user_id: Optional[str] = Query(default=None, description="Filter by a specific user_id"),
    audio_state: Optional[str] = Query(default=None, description="Filter by a specific audio_state"),
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """List all meetings across all users. Optionally filter by user_id."""
    skip  = (page - 1) * limit
    query = {}
    if user_id:
        query["user_id"] = user_id
    if audio_state:
        query["audio_state"] = audio_state

    from app.models.serializers import serialize_meeting
    cursor   = db.meetings.find(query, sort=[("created_at", -1)]).skip(skip).limit(limit)
    meetings = await cursor.to_list(length=limit)
    total    = await db.meetings.count_documents(query)

    return {
        "success": True,
        "data":    [serialize_meeting(m) for m in meetings],
        "meta":    {"total": total, "page": page, "limit": limit},
    }


# ─── System Configuration — Audio Storage ────────────────────────────────────

class SetStorageBackendRequest(BaseModel):
    backend: str  # "s3" | "local"


@router.get("/system-config/storage")
async def get_storage_config(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """
    Return the currently active audio storage backend and related settings.
    Reflects live runtime state — not just the env var.
    """
    from app.core.storage import get_active_backend_name
    from app.core.config import settings

    active = get_active_backend_name()
    record = await db.system_config.find_one({"key": "audio_storage_backend"})
    changed_at = record.get("changed_at") if record else None
    changed_by = record.get("changed_by") if record else None

    return {
        "success": True,
        "data": {
            "active_backend":   active,
            "s3_bucket":        settings.s3_bucket_name,
            "s3_region":        settings.aws_region,
            "local_path":       settings.audio_local_path,
            "changed_at":       changed_at,
            "changed_by_email": changed_by,
        },
    }


@router.put("/system-config/storage")
async def set_storage_config(
    body: SetStorageBackendRequest,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """
    Switch the active audio storage backend for the entire platform immediately.
    Persists the choice to MongoDB so it survives server restarts.
    """
    from app.core.storage import set_active_backend
    from datetime import datetime, timezone

    if body.backend not in ("s3", "local"):
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_BACKEND", "message": "backend must be 's3' or 'local'"},
        )

    try:
        set_active_backend(body.backend)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"code": "SWITCH_FAILED", "message": str(e)},
        )

    now = datetime.now(timezone.utc)
    await db.system_config.update_one(
        {"key": "audio_storage_backend"},
        {"$set": {
            "key":        "audio_storage_backend",
            "value":      body.backend,
            "changed_at": now,
            "changed_by": current_user.get("email", current_user["user_id"]),
        }},
        upsert=True,
    )

    logger.info(
        f"Audio storage switched to '{body.backend}' "
        f"by {current_user.get('email', current_user['user_id'])}"
    )

    return {
        "success": True,
        "data": {"active_backend": body.backend, "changed_at": now},
        "message": f"Audio storage switched to {'AWS S3' if body.backend == 's3' else 'Local Filesystem'}",
    }


# ─── RAG: Index All Unindexed Meetings ───────────────────────────────────────

@router.post("/meetings/index-unindexed")
async def index_all_unindexed_meetings(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """
    Admin-only: scan all meetings where rag_indexed=False and a transcript exists,
    then run RAG indexing for each one synchronously.

    Returns a summary of results: indexed, skipped (no transcript), failed.
    Safe to re-run — already-indexed meetings are never touched.
    """
    from datetime import datetime, timezone as _tz

    # Fetch all meetings that have a transcript but are not yet indexed
    cursor = db.meetings.find(
        {"rag_indexed": {"$ne": True}, "transcript": {"$ne": None}},
        sort=[("created_at", 1)],
    )
    meetings = await cursor.to_list(length=10000)

    total     = len(meetings)
    indexed   = 0
    skipped   = 0
    failed    = 0
    errors    = []

    logger.info(f"Admin index-unindexed: found {total} unindexed meetings with transcripts")

    for meeting in meetings:
        meeting_id      = meeting["meeting_id"]
        user_id         = meeting["user_id"]
        transcript      = meeting.get("transcript") or {}
        transcript_text = transcript.get("text", "").strip()

        if not transcript_text:
            logger.warning(f"Skipping {meeting_id} — transcript exists but has no text")
            skipped += 1
            continue

        try:
            from app.routes.meetings import _index_transcript_inline
            await _index_transcript_inline(meeting_id, user_id, transcript_text, db)
            indexed += 1
            logger.info(f"Indexed meeting {meeting_id} ({indexed}/{total})")
        except Exception as e:
            failed += 1
            err_msg = f"{meeting_id}: {str(e)}"
            errors.append(err_msg)
            logger.error(f"Failed to index meeting {meeting_id}: {e}")

    return {
        "success": True,
        "summary": {
            "total_found":   total,
            "indexed":       indexed,
            "skipped":       skipped,
            "failed":        failed,
        },
        "errors": errors[:20],
        "message": (
            f"Indexing complete. {indexed} indexed, {skipped} skipped, {failed} failed."
            if total > 0
            else "No unindexed meetings with transcripts found."
        ),
    }


@router.get("/meetings/next-pending")
async def get_next_pending_meeting(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """
    FIFO queue: return the oldest meeting where audio is fully assembled
    (audio_state = "merged", status = "audio_uploaded") and the processing
    pipeline has not yet started (transcript is None).
    """
    pending = await db.meetings.find_one(
        {
            "status":      "audio_uploaded",
            "audio_state": "merged",
            "transcript":  None,
        },
        sort=[("created_at", 1)],
    )

    stuck_count = await db.meetings.count_documents({
        "audio_state": "chunked",
    })

    if not pending:
        return {
            "success":      True,
            "data":         None,
            "message":      "No meetings pending processing",
            "stuck_chunked": stuck_count,
        }

    chunk_count = await db.audio_chunks.count_documents({"meeting_id": pending["meeting_id"]})

    return {
        "success": True,
        "data": {
            "meeting_id":      pending["meeting_id"],
            "user_id":         pending["user_id"],
            "context":         pending.get("context"),
            "date_time":       pending.get("date_time"),
            "created_at":      pending.get("created_at"),
            "status":          pending.get("status"),
            "audio_state":     pending.get("audio_state", "merged"),
            "storage_backend": pending.get("storage_backend"),
            "audio_s3_key":    pending.get("audio_s3_key"),
            "last_chunk_id":   pending.get("last_chunk_id"),
            "chunk_count_db":  chunk_count,
        },
        "stuck_chunked": stuck_count,
    }


@router.get("/meetings/stuck-chunked")
async def get_stuck_chunked_meetings(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """
    Return all meetings where chunks were uploaded but the merge never completed.
    """
    skip  = (page - 1) * limit
    query = {"audio_state": "chunked"}
    cursor = db.meetings.find(query, sort=[("created_at", 1)]).skip(skip).limit(limit)
    meetings = await cursor.to_list(length=limit)
    total   = await db.meetings.count_documents(query)

    from app.models.serializers import serialize_meeting
    return {
        "success": True,
        "data":    [serialize_meeting(m) for m in meetings],
        "meta":    {"total": total, "page": page, "limit": limit},
    }


# ─── Processing Queue Management ──────────────────────────────────────────────

@router.get("/processing/config")
async def get_processing_config(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Get the current processing queue configuration."""
    record = await db.system_config.find_one({"key": "processing_config"})
    if not record:
        return {
            "success": True,
            "data": {
                "window_start": settings.processing_window_start,
                "window_end": settings.processing_window_end,
                "enabled": True,
                "max_retries": settings.processing_max_retries,
                "retry_delay_minutes": settings.processing_retry_delay_minutes,
                "external_api_url": settings.external_api_url,
            },
            "source": "env_defaults",
        }
    config = record.get("value", {})
    return {
        "success": True,
        "data": config,
        "changed_at": record.get("changed_at"),
        "changed_by": record.get("changed_by"),
    }


class UpdateProcessingConfigRequest(BaseModel):
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    enabled: Optional[bool] = None
    max_retries: Optional[int] = None
    retry_delay_minutes: Optional[int] = None
    external_api_url: Optional[str] = None


@router.put("/processing/config")
async def update_processing_config(
    body: UpdateProcessingConfigRequest,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Update the processing queue configuration."""
    record = await db.system_config.find_one({"key": "processing_config"})
    existing = record.get("value", {}) if record else {}

    update_data = {}
    for field in ("window_start", "window_end", "enabled", "max_retries", "retry_delay_minutes", "external_api_url"):
        val = getattr(body, field, None)
        if val is not None:
            update_data[field] = val

    if not update_data:
        raise HTTPException(status_code=400, detail={"code": "NO_FIELDS_TO_UPDATE"})

    merged = {**existing, **update_data}
    now = datetime.now(timezone.utc)

    await db.system_config.update_one(
        {"key": "processing_config"},
        {"$set": {
            "key": "processing_config",
            "value": merged,
            "changed_at": now,
            "changed_by": current_user.get("email", current_user["user_id"]),
        }},
        upsert=True,
    )

    logger.info(f"Processing config updated by {current_user.get('email', current_user['user_id'])}: {update_data}")
    return {"success": True, "data": merged, "changed_at": now}


@router.get("/processing/queue")
async def list_processing_queue(
    status: Optional[str] = Query(default=None, description="Filter by status: pending|processing|completed|failed"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """List processing queue items with pagination and optional status filter."""
    skip = (page - 1) * limit
    query = {}
    if status:
        if status not in ("pending", "processing", "completed", "failed"):
            raise HTTPException(status_code=422, detail={"code": "INVALID_STATUS"})
        query["status"] = status

    from app.models.serializers import serialize_processing_item
    cursor = db.processing_queue.find(query, sort=[("created_at", -1)]).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.processing_queue.count_documents(query)

    return {
        "success": True,
        "data": [serialize_processing_item(item) for item in items],
        "meta": {"total": total, "page": page, "limit": limit},
    }


@router.post("/processing/queue/{meeting_id}/retry")
async def retry_processing_item(
    meeting_id: str,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Reset a failed processing queue item back to pending for retry."""
    result = await db.processing_queue.find_one_and_update(
        {"meeting_id": meeting_id, "status": "failed"},
        {"$set": {
            "status": "pending",
            "retry_count": 0,
            "error_message": None,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"code": "ITEM_NOT_FOUND", "message": f"No failed queue item for meeting '{meeting_id}'"},
        )
    logger.info(f"Processing queue item {meeting_id} reset to pending by admin")
    return {"success": True, "message": f"Queue item for meeting '{meeting_id}' reset to pending"}


@router.post("/processing/queue/retry-all-failed")
async def retry_all_failed_processing(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Bulk reset all failed processing queue items back to pending."""
    now = datetime.now(timezone.utc)
    result = await db.processing_queue.update_many(
        {"status": "failed"},
        {"$set": {
            "status": "pending",
            "retry_count": 0,
            "error_message": None,
            "updated_at": now,
        }},
    )
    logger.info(f"Bulk retry: {result.modified_count} failed items reset by admin")
    return {
        "success": True,
        "message": f"{result.modified_count} failed items reset to pending",
        "modified_count": result.modified_count,
    }


# ─── Admin Delete Meeting ──────────────────────────────────────────────────────

@router.delete("/meetings/{meeting_id}")
async def admin_delete_meeting(
    meeting_id: str,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Force-delete any meeting regardless of owner."""
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})

    await db.meetings.delete_one({"meeting_id": meeting_id})

    try:
        from app.db.qdrant_client import get_qdrant
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from app.core.config import settings
        qdrant = get_qdrant()
        qdrant.delete(
            collection_name=settings.qdrant_collection,
            points_selector=Filter(
                must=[FieldCondition(key="meeting_id", match=MatchValue(value=meeting_id))]
            ),
        )
    except Exception as e:
        logger.warning(f"Failed to clean Qdrant vectors for {meeting_id}: {e}")

    return {"success": True, "message": f"Meeting '{meeting_id}' force-deleted by admin"}
