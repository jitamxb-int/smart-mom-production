import os
import subprocess
import sys
import threading
import time
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.services.record_meeting import signal_stop

router = APIRouter(tags=["recording"])

active_sessions: dict[str, dict] = {}
sessions_lock = threading.Lock()

RECORDINGS_DIR = settings.recordings_dir


class JoinAndRecordRequest(BaseModel):
    meetLink: str
    session_name: str = ""


def _short_id(session_id: str) -> str:
    return session_id.replace("-", "")[:8]


def _recording_output_path(sid8: str) -> str:
    return os.path.join(RECORDINGS_DIR, f"{sid8}.webm")


def _stream_output(proc: subprocess.Popen, session_id: str):
    for line in iter(proc.stdout.readline, ""):
        if line:
            print(f"[REC:{_short_id(session_id)}] {line.rstrip()}", flush=True)


@router.post("/join-and-record")
async def join_and_record(req: JoinAndRecordRequest):
    if not req.meetLink.strip():
        raise HTTPException(status_code=400, detail="meetLink is required")

    session_id = str(uuid.uuid4())
    sid8 = _short_id(session_id)
    output_file = _recording_output_path(sid8)

    env = os.environ.copy()
    env["SESSION_ID"] = session_id
    env["MEETING_LINK"] = req.meetLink.strip()
    env["RECORDINGS_DIR"] = RECORDINGS_DIR
    env["STAY_DURATION_SECONDS"] = "0"
    env["PULSE_SPK_SINK"] = f"VSpk_{sid8}"
    env["PULSE_SINK"] = f"VSpk_{sid8}"
    env["CHROME_BASE_PROFILE"] = settings.chrome_base_profile
    env["CHROME_BACKUP_PROFILE"] = settings.chrome_backup_profile

    proc = subprocess.Popen(
        [sys.executable, "-m", "app.services.record_meeting"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    t = threading.Thread(target=_stream_output, args=(proc, session_id), daemon=True)
    t.start()

    with sessions_lock:
        active_sessions[session_id] = {
            "process": proc,
            "meetLink": req.meetLink.strip(),
            "started_at": time.time(),
            "type": "recording",
            "output_file": output_file,
        }

    print(f"[API] Recording started: {sid8} (PID {proc.pid})", flush=True)
    print(f"[API]    Meet  : {req.meetLink}", flush=True)
    print(f"[API]    File  : {output_file}", flush=True)

    return {
        "session_id": session_id,
        "status": "recording",
        "meetLink": req.meetLink.strip(),
    }


@router.post("/stop-recording/{session_id}")
async def stop_recording(session_id: str):
    sid8 = _short_id(session_id)

    signal_stop(sid8)

    with sessions_lock:
        info = active_sessions.get(session_id)

    if not info:
        return {
            "status": "not_found",
            "session_id": session_id,
            "file": _recording_output_path(sid8),
        }

    proc = info["process"]
    if proc.poll() is None:
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    with sessions_lock:
        active_sessions.pop(session_id, None)

    output_file = info.get("output_file", _recording_output_path(sid8))
    file_exists = os.path.exists(output_file)
    file_size_kb = os.path.getsize(output_file) / 1024 if file_exists else 0

    print(f"[API] Recording stopped: {sid8}", flush=True)
    print(f"[API]    File: {output_file} ({file_size_kb:.1f} KB)", flush=True)

    return {
        "status": "stopped",
        "session_id": session_id,
        "file": output_file,
        "file_exists": file_exists,
        "file_size_kb": round(file_size_kb, 1),
    }


@router.get("/recording-status/{session_id}")
async def recording_status(session_id: str):
    sid8 = _short_id(session_id)
    output_file = _recording_output_path(sid8)

    with sessions_lock:
        info = active_sessions.get(session_id)

    if not info:
        file_exists = os.path.exists(output_file)
        return {
            "status": "not_found" if not file_exists else "completed",
            "session_id": session_id,
            "file": output_file if file_exists else None,
            "file_size_kb": round(os.path.getsize(output_file) / 1024, 1) if file_exists else 0,
        }

    running = info["process"].poll() is None
    uptime = int(time.time() - info["started_at"])
    file_exists = os.path.exists(output_file)

    return {
        "status": "recording" if running else "finalizing",
        "session_id": session_id,
        "meetLink": info.get("meetLink", ""),
        "started_at": info["started_at"],
        "uptime_sec": uptime,
        "file": output_file,
        "file_exists": file_exists,
        "file_size_kb": round(os.path.getsize(output_file) / 1024, 1) if file_exists else 0,
    }


@router.get("/download-recording/{session_id}")
async def download_recording(session_id: str):
    sid8 = _short_id(session_id)
    output_file = _recording_output_path(sid8)

    if not os.path.exists(output_file):
        raise HTTPException(
            status_code=404,
            detail=f"Recording not found for session {session_id}. "
                   f"Expected at {output_file}. "
                   f"Make sure the recording has completed.",
        )

    return FileResponse(
        path=output_file,
        media_type="audio/webm",
        filename=f"recording-{sid8}.webm",
    )
