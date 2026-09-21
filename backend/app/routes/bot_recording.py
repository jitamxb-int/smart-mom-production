import os
import subprocess
import sys
import threading
import time
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.jwt import get_current_user
from app.db.database import get_db
from app.core.config import settings
from app.core.storage import get_active_backend_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/meetings/bot", tags=["meet-bot"])

active_sessions: dict[str, dict] = {}
sessions_lock = threading.Lock()

RECORDINGS_DIR = settings.meet_bot_recordings_dir


class StartBotRequest(BaseModel):
    meet_link: str


def _short_id(session_id: str) -> str:
    return session_id.replace("-", "")[:8]


def _stream_output(proc: subprocess.Popen, session_id: str):
    for line in iter(proc.stdout.readline, ""):
        if line:
            logger.info("[BOT:%s] %s", _short_id(session_id), line.rstrip())


# ─── Meeting Bot Recording ────────────────────────────────────────────────


@router.post("/{meeting_id}/start")
async def start_bot_recording(
    meeting_id: str,
    body: StartBotRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    if not body.meet_link.strip():
        raise HTTPException(status_code=422, detail={"code": "MEET_LINK_REQUIRED"})

    session_id = str(uuid.uuid4())
    sid8 = _short_id(session_id)

    os.makedirs(RECORDINGS_DIR, exist_ok=True)

    env = os.environ.copy()
    env["SESSION_ID"] = session_id
    env["MEETING_LINK"] = body.meet_link.strip()
    env["RECORDINGS_DIR"] = RECORDINGS_DIR
    env["MEETING_ID"] = meeting_id
    env["PULSE_SPK_SINK"] = f"VSpk_{sid8}"
    env["PULSE_SINK"] = f"VSpk_{sid8}"
    env["CHROME_BASE_PROFILE"] = settings.meet_bot_chrome_profile
    env["CHROME_BACKUP_PROFILE"] = settings.meet_bot_chrome_backup
    env["DISPLAY"] = settings.meet_bot_display
    env["PULSE_SERVER"] = settings.meet_bot_pulse_server
    env["MONGO_URI"] = settings.mongo_uri
    env["MONGO_DB_NAME"] = settings.mongo_db_name
    if settings.aws_region:
        env["AWS_REGION"] = settings.aws_region
    if settings.s3_bucket_name:
        env["S3_BUCKET_NAME"] = settings.s3_bucket_name
    backend = get_active_backend_name()
    env["AUDIO_STORAGE_BACKEND"] = backend
    if settings.audio_local_path:
        env["AUDIO_LOCAL_PATH"] = settings.audio_local_path

    proc = subprocess.Popen(
        [sys.executable, "-m", "app.meet_bot.record_meeting"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    t = threading.Thread(target=_stream_output, args=(proc, session_id), daemon=True)
    t.start()

    now = time.time()

    await db.meetings.update_one(
        {"meeting_id": meeting_id},
        {"$set": {
            "meet_link": body.meet_link.strip(),
            "bot_session_id": session_id,
            "status": "recording",
            "updated_at": now,
        }},
    )

    with sessions_lock:
        active_sessions[session_id] = {
            "process": proc,
            "meet_link": body.meet_link.strip(),
            "started_at": now,
            "meeting_id": meeting_id,
        }

    logger.info("Bot recording started: meeting=%s session=%s", meeting_id, sid8)

    return {
        "success": True,
        "meeting_id": meeting_id,
        "bot_session_id": session_id,
        "novnc_url": f"http://localhost:{settings.meet_bot_novnc_port}/vnc.html",
    }


@router.post("/{meeting_id}/stop")
async def stop_bot_recording(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    bot_session_id = meeting.get("bot_session_id")
    if not bot_session_id:
        raise HTTPException(status_code=400, detail={"code": "NO_ACTIVE_BOT_SESSION"})

    # Signal stop via stop file
    from app.meet_bot.record_meeting import signal_stop
    signal_stop(_short_id(bot_session_id))

    with sessions_lock:
        info = active_sessions.get(bot_session_id)

    if info:
        proc = info["process"]
        if proc.poll() is None:
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()

        with sessions_lock:
            active_sessions.pop(bot_session_id, None)

    return {
        "success": True,
        "meeting_id": meeting_id,
    }


@router.get("/{meeting_id}/status")
async def get_bot_status(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    meeting = await db.meetings.find_one({"meeting_id": meeting_id})
    if not meeting:
        raise HTTPException(status_code=404, detail={"code": "MEETING_NOT_FOUND"})
    if current_user.get("role") != "admin" and meeting["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN"})

    bot_session_id = meeting.get("bot_session_id")
    if not bot_session_id:
        return {
            "success": True,
            "meeting_id": meeting_id,
            "bot_active": False,
            "status": "not_started",
        }

    with sessions_lock:
        info = active_sessions.get(bot_session_id)

    if not info:
        return {
            "success": True,
            "meeting_id": meeting_id,
            "bot_active": False,
            "status": meeting.get("status", "unknown"),
        }

    running = info["process"].poll() is None
    uptime = int(time.time() - info["started_at"])

    return {
        "success": True,
        "meeting_id": meeting_id,
        "bot_active": True,
        "status": "recording" if running else "finalizing",
        "uptime_sec": uptime,
        "novnc_url": f"http://localhost:{settings.meet_bot_novnc_port}/vnc.html",
    }
