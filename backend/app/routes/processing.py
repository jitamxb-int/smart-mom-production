from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.db.database import get_db
from app.models.processing import ProcessingCallbackRequest
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/processing", tags=["processing"])


@router.post("/callback")
async def processing_callback(
    body: ProcessingCallbackRequest,
    db=Depends(get_db),
):
    """
    Callback endpoint for the external processing service.
    Updates the processing_queue item based on completion status.
    """

    queue_item = await db.processing_queue.find_one({"meeting_id": body.meeting_id})
    if not queue_item:
        raise HTTPException(
            status_code=404,
            detail={"code": "QUEUE_ITEM_NOT_FOUND", "message": f"No queue item for meeting '{body.meeting_id}'"},
        )

    now = datetime.now(timezone.utc)

    if body.status == "completed":
        await db.processing_queue.update_one(
            {"meeting_id": body.meeting_id},
            {"$set": {
                "status": "completed",
                "completed_at": now,
                "updated_at": now,
                "error_message": None,
            }},
        )
        logger.info(f"Processing completed for meeting {body.meeting_id}")
    elif body.status == "failed":
        retry_count = queue_item.get("retry_count", 0) + 1
        max_retries = queue_item.get("max_retries", settings.processing_max_retries)
        new_status = "failed" if retry_count >= max_retries else "pending"
        await db.processing_queue.update_one(
            {"meeting_id": body.meeting_id},
            {"$set": {
                "status": new_status,
                "retry_count": retry_count,
                "error_message": body.error_message,
                "last_error_at": now,
                "updated_at": now,
                "completed_at": now if new_status == "failed" else None,
            }},
        )
        logger.info(f"Processing failed for meeting {body.meeting_id} — status set to {new_status}")
    else:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_STATUS", "message": "status must be 'completed' or 'failed'"},
        )

    return {"success": True, "meeting_id": body.meeting_id, "status": body.status}
