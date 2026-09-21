from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.jwt import get_current_user
from app.db.database import get_db
from app.models.meeting import DiagramResponse
from app.models.serializers import serialize_meeting
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/meetings", tags=["diagrams"])


@router.get("/{meeting_id}/diagram", response_model=DiagramResponse)
async def get_diagram(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Get diagram status and mermaid syntax for a meeting."""
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})

    if not meeting:
        raise HTTPException(
            status_code=404,
            detail={"code": "MEETING_NOT_FOUND", "message": f"No meeting found with id '{meeting_id}'"},
        )

    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "You do not have permission to access this meeting."},
        )

    return {
        "success":     True,
        "meeting_id":  meeting_id,
        "diagram":     meeting.get("diagram"),
        "rag_indexed": meeting.get("rag_indexed", False),
    }


@router.post("/{meeting_id}/diagram/regenerate")
async def regenerate_diagram(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Re-trigger diagram generation Celery task."""
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})

    if not meeting:
        raise HTTPException(
            status_code=404,
            detail={"code": "MEETING_NOT_FOUND", "message": f"No meeting found with id '{meeting_id}'"},
        )

    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "You do not have permission to modify this meeting."},
        )

    if not meeting.get("transcript"):
        raise HTTPException(
            status_code=400,
            detail={"code": "NO_TRANSCRIPT", "message": "Cannot generate diagram without transcript"},
        )

    # Reset diagram status to pending
    now = datetime.now(timezone.utc)
    await db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {
            "diagram": {
                "status":         "pending",
                "type":           None,
                "mermaid_syntax": None,
                "generated_at":   None,
                "error":          None,
            },
            "updated_at": now,
        }},
    )

    # Dispatch Celery task
    try:
        from app.worker.tasks.diagram_gen import generate_diagram
        generate_diagram.apply_async(args=[meeting_id], queue="diagram-gen")
        logger.info(f"Re-dispatched diagram-gen for meeting {meeting_id}")
    except Exception as e:
        logger.error(f"Failed to dispatch diagram task: {e}")
        raise HTTPException(status_code=500, detail={"code": "TASK_DISPATCH_FAILED"})

    return {"success": True, "message": "Diagram regeneration triggered", "meeting_id": meeting_id}
