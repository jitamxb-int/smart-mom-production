import asyncio
import os
import shutil
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.setup_login import run_login, profile_exists

router = APIRouter(prefix="/setup", tags=["profile-setup"])

_login_tasks: dict[str, dict] = {}
_lock = threading.Lock()


class DeleteProfileRequest(BaseModel):
    confirm: bool = False


class LoginRequest(BaseModel):
    delete_existing: bool | None = None


def _delete_profile(path: str) -> None:
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
        print(f"[SETUP] Deleted profile at {path}", flush=True)


def _get_novnc_url() -> str:
    return f"http://localhost:{settings.novnc_port}/vnc.html"


async def _run_login_background(task_id: str, delete_existing: bool = False):
    try:
        if delete_existing:
            _delete_profile(settings.chrome_base_profile)

        result = await run_login()
        with _lock:
            if task_id in _login_tasks:
                _login_tasks[task_id]["status"] = "completed"
                _login_tasks[task_id]["result"] = result
    except Exception as e:
        with _lock:
            if task_id in _login_tasks:
                _login_tasks[task_id]["status"] = "failed"
                _login_tasks[task_id]["error"] = str(e)


@router.post("/login")
async def trigger_login(body: LoginRequest = None):
    if body is None:
        body = LoginRequest()

    exists = profile_exists()

    if exists and body.delete_existing is None:
        return {
            "confirmation_required": True,
            "profile_exists": True,
            "message": "A base profile already exists. Set 'delete_existing': true to delete it and start fresh, or 'delete_existing': false to keep it.",
            "profile_path": settings.chrome_base_profile,
        }

    if exists and body.delete_existing is False:
        return {
            "profile_exists": True,
            "message": "Existing profile will be used. No new login needed.",
            "profile_path": settings.chrome_base_profile,
        }

    task_id = os.urandom(8).hex()
    with _lock:
        _login_tasks[task_id] = {"status": "running"}

    thread = threading.Thread(
        target=lambda: asyncio.run(_run_login_background(task_id, delete_existing=body.delete_existing or False)),
        daemon=True,
    )
    thread.start()

    return {
        "task_id": task_id,
        "status": "running",
        "message": "Login process started. Check /setup/login/{task_id} for status.",
        "novnc_url": _get_novnc_url(),
    }


@router.get("/login/{task_id}")
async def login_status(task_id: str):
    with _lock:
        task = _login_tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        **task,
        "novnc_url": _get_novnc_url() if task.get("status") == "running" else None,
    }


@router.get("/status")
async def setup_status():
    exists = profile_exists()
    return {
        "profile_exists": exists,
        "profile_path": settings.chrome_base_profile,
        "setup_required": not exists,
    }


@router.delete("/profile")
async def delete_profile(body: DeleteProfileRequest = None):
    if body is None:
        body = DeleteProfileRequest()

    exists = profile_exists()

    if not exists:
        return {
            "deleted": False,
            "message": "No profile exists to delete.",
            "profile_path": settings.chrome_base_profile,
        }

    if not body.confirm:
        return {
            "confirmation_required": True,
            "message": "Set 'confirm': true to delete the existing profile.",
            "profile_path": settings.chrome_base_profile,
        }

    _delete_profile(settings.chrome_base_profile)

    return {
        "deleted": True,
        "message": "Profile deleted successfully.",
        "profile_path": settings.chrome_base_profile,
    }
