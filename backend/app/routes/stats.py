"""
Stats endpoint — server-side aggregation, no client-side counting.
Returns accurate totals regardless of pagination limits.
"""
from fastapi import APIRouter, Depends
from app.auth.jwt import get_current_user, require_admin
from app.db.database import get_db
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["stats"])


@router.get("/stats")
async def get_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Return aggregated meeting counts for the current user.
    Admins get platform-wide totals.
    """
    role  = current_user.get("role", "user")
    match = {} if role == "admin" else {"user_id": current_user["user_id"]}

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": None,
                "total":       {"$sum": 1},
                "transcribed": {"$sum": {"$cond": [{"$eq": ["$status", "transcript_ready"]}, 1, 0]}},
                "indexed":     {"$sum": {"$cond": ["$rag_indexed", 1, 0]}},
                "with_diagram":{"$sum": {"$cond": [{"$eq": ["$diagram.status", "ready"]}, 1, 0]}},
            }
        },
    ]

    result = await db.meetings.aggregate(pipeline).to_list(length=1)

    if result:
        row = result[0]
        return {
            "success": True,
            "data": {
                "total":        row["total"],
                "transcribed":  row["transcribed"],
                "indexed":      row["indexed"],
                "with_diagram": row["with_diagram"],
            },
        }

    return {
        "success": True,
        "data": {"total": 0, "transcribed": 0, "indexed": 0, "with_diagram": 0},
    }


@router.get("/admin/stats")
async def get_admin_stats(
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Platform-wide stats — admin only."""
    total_users    = await db.users.count_documents({})
    total_meetings = await db.meetings.count_documents({})
    total_chats    = await db.chat_sessions.count_documents({})

    pipeline = [
        {
            "$group": {
                "_id": "$status",
                "count": {"$sum": 1},
            }
        }
    ]
    status_counts = {
        row["_id"]: row["count"]
        for row in await db.meetings.aggregate(pipeline).to_list(length=20)
    }

    return {
        "success": True,
        "data": {
            "users":         total_users,
            "meetings":      total_meetings,
            "chat_sessions": total_chats,
            "meetings_by_status": status_counts,
        },
    }
