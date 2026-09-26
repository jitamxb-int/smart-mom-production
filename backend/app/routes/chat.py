"""Chat routes with multi-meeting selector support."""
import json
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from openai import AsyncOpenAI
from app.auth.jwt import get_current_user, require_admin
from app.db.database import get_db
from app.db.qdrant_client import get_qdrant
from app.models.meeting import ChatRequest
from app.core.config import settings
from app.core.error_logger import log_error
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])
openai_client = AsyncOpenAI(api_key=settings.openai_api_key)

SYSTEM_PROMPT_USER = """You are MeetMind Assistant, an AI that helps users understand their meeting recordings.
Rules: Only answer using provided context. Be concise. Reference meeting title when relevant. Do not fabricate details."""

SYSTEM_PROMPT_ADMIN = """You are MeetMind Admin Assistant. You have access to all users' meeting transcripts.
Always indicate which meeting your answer is drawn from."""


async def embed_query(text: str) -> list[float]:
    resp = await openai_client.embeddings.create(input=text, model=settings.embedding_model)
    return resp.data[0].embedding


async def search_qdrant(query_vector, user_id, role, meeting_ids, top_k=6):
    from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny
    qdrant = get_qdrant()
    if not qdrant:
        return []
    conditions = []
    if role != "admin":
        conditions.append(FieldCondition(key="user_id", match=MatchValue(value=user_id)))
    if meeting_ids:
        if len(meeting_ids) == 1:
            conditions.append(FieldCondition(key="meeting_id", match=MatchValue(value=meeting_ids[0])))
        else:
            conditions.append(FieldCondition(key="meeting_id", match=MatchAny(any=meeting_ids)))
    query_filter = Filter(must=conditions) if conditions else None
    try:
        response = qdrant.query_points(
            collection_name=settings.qdrant_collection,
            query=query_vector,
            query_filter=query_filter,
            limit=top_k,
            with_payload=True,
        )
        results = response.points
        return [{"chunk_text": r.payload.get("chunk_text",""), "meeting_id": r.payload.get("meeting_id",""),
                 "meeting_title": r.payload.get("meeting_title",""), "chunk_index": r.payload.get("chunk_index",0),
                 "user_id": r.payload.get("user_id",""), "score": r.score} for r in results]
    except Exception as e:
        logger.error(f"Qdrant search error: {e}")
        return []


# ─── GET /api/chat/meetings ───────────────────────────────────────────────────
@router.get("/meetings")
async def list_chat_meetings(current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    """List all RAG-indexed meetings the caller may chat with."""
    role = current_user.get("role", "user")
    query = {"rag_indexed": True}
    if role != "admin":
        query["user_id"] = current_user["user_id"]
    cursor = db.meetings.find(
        query,
        projection={"meeting_id": 1, "context": 1, "date_time": 1, "user_id": 1, "attendees": 1},
        sort=[("date_time", -1)],
    ).limit(200)
    meetings = await cursor.to_list(length=200)
    for m in meetings:
        m["_id"] = str(m["_id"])
    return {"success": True, "data": meetings}


# ─── GET /api/chat/meetings/by-user/{target_user_id} (admin only) ────────────
@router.get("/meetings/by-user/{target_user_id}")
async def list_chat_meetings_for_user(
    target_user_id: str,
    current_user: dict = Depends(require_admin),
    db=Depends(get_db),
):
    """Admin: list RAG-indexed meetings for a specific user."""
    cursor = db.meetings.find(
        {"rag_indexed": True, "user_id": target_user_id},
        projection={"meeting_id": 1, "context": 1, "date_time": 1, "user_id": 1},
        sort=[("date_time", -1)],
    ).limit(200)
    meetings = await cursor.to_list(length=200)
    for m in meetings:
        m["_id"] = str(m["_id"])
    return {"success": True, "data": meetings}


# ─── POST /api/chat ───────────────────────────────────────────────────────────
@router.post("")
async def chat(body: ChatRequest, current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    user_id = current_user["user_id"]
    role = current_user.get("role", "user")

    meeting_ids = None
    if body.meeting_ids:
        meeting_ids = body.meeting_ids
    elif body.meeting_id:
        meeting_ids = [body.meeting_id]

    if meeting_ids:
        for mid in meeting_ids:
            mtg = await db.meetings.find_one({"meeting_id": mid})
            if not mtg:
                raise HTTPException(404, detail={"code": "MEETING_NOT_FOUND", "message": f"Meeting '{mid}' not found"})
            if role != "admin" and mtg["user_id"] != user_id:
                raise HTTPException(403, detail={"code": "FORBIDDEN", "message": f"No access to meeting '{mid}'"})
            if not mtg.get("rag_indexed"):
                raise HTTPException(400, detail={"code": "NOT_INDEXED", "message": f"Meeting '{mid}' not yet indexed."})

    async def event_generator():
        try:
            query_vector = await embed_query(body.message)
            chunks = await search_qdrant(query_vector, user_id, role, meeting_ids)

            context_parts, sources, seen = [], [], set()
            for c in chunks:
                context_parts.append(f"[Meeting: {c['meeting_title'] or c['meeting_id']}]\n{c['chunk_text']}")
                key = (c["meeting_id"], c["chunk_index"])
                if key not in seen:
                    seen.add(key)
                    sources.append({"meeting_id": c["meeting_id"], "chunk_index": c["chunk_index"],
                                    "meeting_title": c["meeting_title"], "user_id": c.get("user_id","")})

            context = "\n\n---\n\n".join(context_parts) if context_parts else "No relevant transcript context found."
            sys_prompt = SYSTEM_PROMPT_ADMIN if role == "admin" else SYSTEM_PROMPT_USER
            messages = [{"role": "system", "content": f"{sys_prompt}\n\nContext:\n{context}"}]
            for msg in body.conversation_history[-10:]:
                messages.append({"role": msg.role, "content": msg.content})
            messages.append({"role": "user", "content": body.message})

            full_response = ""
            stream = await openai_client.chat.completions.create(
                model="gpt-4o-mini", messages=messages, stream=True, max_tokens=1000)
            async for co in stream:
                delta = co.choices[0].delta
                if delta.content:
                    full_response += delta.content
                    yield {"data": json.dumps({"type": "token", "content": delta.content})}
                    await asyncio.sleep(0)

            yield {"data": json.dumps({"type": "sources", "sources": sources})}
            yield {"data": json.dumps({"type": "done"})}

            try:
                now = datetime.now(timezone.utc)
                await db.chat_sessions.insert_one({
                    "user_id": user_id, "meeting_id": body.meeting_id, "meeting_ids": meeting_ids,
                    "messages": [{"role": "user", "content": body.message, "timestamp": now},
                                 {"role": "assistant", "content": full_response, "timestamp": now}],
                    "sources_used": sources, "created_at": now, "updated_at": now,
                })
            except Exception as e:
                logger.warning(f"Failed to persist chat session: {e}")
                log_error(
                    e, db,
                    source="manual:chat_persist_session",
                    user_id=user_id,
                    user_email=current_user.get("email"),
                    context={"meeting_id": body.meeting_id, "meeting_ids": meeting_ids},
                )
        except Exception as e:
            logger.error(f"Chat error: {e}")
            log_error(
                e, db,
                source="manual:chat_pipeline_error",
                user_id=user_id,
                user_email=current_user.get("email"),
                context={"meeting_id": body.meeting_id, "meeting_ids": meeting_ids},
            )
            yield {"data": json.dumps({"type": "error", "message": str(e)})}

    return EventSourceResponse(event_generator())


# ─── GET /api/chat/history/{meeting_id} ──────────────────────────────────────
@router.get("/history/{meeting_id}")
async def get_chat_history(meeting_id: str, current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    role = current_user.get("role", "user")
    query = {"meeting_id": meeting_id}
    if role != "admin":
        query["user_id"] = current_user["user_id"]
    sessions = await db.chat_sessions.find(query, sort=[("created_at", -1)]).limit(50).to_list(50)
    for s in sessions:
        s["_id"] = str(s["_id"])
    return {"success": True, "data": sessions}


# ─── DELETE /api/chat/history/session/{session_id} ───────────────────────────
@router.delete("/history/session/{session_id}")
async def delete_chat_session(session_id: str, current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    from bson import ObjectId
    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(422, detail={"code": "INVALID_ID"})
    session = await db.chat_sessions.find_one({"_id": oid})
    if not session:
        raise HTTPException(404, detail={"code": "NOT_FOUND"})
    if current_user.get("role") != "admin" and session["user_id"] != current_user["user_id"]:
        raise HTTPException(403, detail={"code": "FORBIDDEN"})
    await db.chat_sessions.delete_one({"_id": oid})
    return {"success": True, "message": "Chat session deleted"}


# ─── POST /api/chat/reindex/{meeting_id} (admin) ─────────────────────────────
@router.post("/reindex/{meeting_id}")
async def reindex_meeting(meeting_id: str, current_user: dict = Depends(require_admin), db=Depends(get_db)):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(404, detail={"code": "MEETING_NOT_FOUND"})
    if not meeting.get("transcript"):
        raise HTTPException(400, detail={"code": "NO_TRANSCRIPT"})
    await db.meetings.update_one({"meeting_id": meeting_id}, {"$set": {"rag_indexed": False, "rag_indexed_at": None}})
    try:
        from app.worker.tasks.embed_chunks import embed_transcript
        embed_transcript.apply_async(args=[meeting_id], queue="embed-chunks")
    except Exception as e:
        raise HTTPException(500, detail={"code": "TASK_DISPATCH_FAILED", "message": str(e)})
    return {"success": True, "message": f"Re-indexing triggered for {meeting_id}"}


# ─── GET /api/chat/status/{meeting_id} ───────────────────────────────────────
@router.get("/status/{meeting_id}")
async def get_chat_status(meeting_id: str, current_user: dict = Depends(get_current_user), db=Depends(get_db)):
    meeting = await db.meetings.find_one(
        {"meeting_id": meeting_id}, {"rag_indexed": 1, "rag_indexed_at": 1, "status": 1, "user_id": 1})
    if not meeting:
        raise HTTPException(404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(403, detail={"code": "FORBIDDEN"})
    return {"success": True, "meeting_id": meeting_id, "rag_indexed": meeting.get("rag_indexed", False),
            "rag_indexed_at": meeting.get("rag_indexed_at"), "meeting_status": meeting.get("status")}
