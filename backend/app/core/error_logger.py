"""
Centralized error-logging helper.

Captures unhandled exceptions and explicitly-flagged "swallowed" errors into
the `error_logs` MongoDB collection, with the module/function/file/line where
the error actually occurred derived automatically from the traceback.

`log_error()` must never raise and must never add meaningful latency to the
caller — a logging failure should never crash the request/task it's trying
to observe, and should never mask the original exception.
"""
import asyncio
import logging
import os
import traceback
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

# backend/app  (this file lives at backend/app/core/error_logger.py)
_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND_DIR = os.path.dirname(_APP_DIR)

_MESSAGE_MAX_LEN = 2000
_TRACEBACK_MAX_LEN = 20000


def _is_app_frame(filename: str) -> bool:
    path = os.path.abspath(filename)
    return (
        path.startswith(_APP_DIR)
        and "site-packages" not in path
        and f"{os.sep}venv{os.sep}" not in path
        and f"{os.sep}.venv{os.sep}" not in path
    )


def _find_app_frame(exc: BaseException) -> dict:
    """
    Walk exc.__traceback__ and return location info for the DEEPEST frame
    whose source file lives inside backend/app/ (our own code), skipping
    site-packages/venv/stdlib frames. Falls back to the innermost frame of
    the traceback if no in-app frame is found.
    """
    frames = []
    tb = exc.__traceback__
    while tb is not None:
        frames.append(tb.tb_frame)
        tb = tb.tb_next

    app_frames = [f for f in frames if _is_app_frame(f.f_code.co_filename)]
    frame = app_frames[-1] if app_frames else (frames[-1] if frames else None)

    if frame is None:
        return {"module": "unknown", "function": "unknown", "file_path": "unknown", "line_number": 0}

    filename = os.path.abspath(frame.f_code.co_filename)
    try:
        rel_path = os.path.relpath(filename, _BACKEND_DIR).replace(os.sep, "/")
    except ValueError:
        rel_path = filename

    return {
        "module": frame.f_globals.get("__name__", "unknown"),
        "function": frame.f_code.co_name,
        "file_path": rel_path,
        "line_number": frame.f_lineno,
    }


def _extract_user_from_request(request) -> dict:
    """Best-effort JWT decode from the Authorization header. Never raises."""
    try:
        from jose import jwt
        from app.core.config import settings

        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return {}
        token = auth.split(" ", 1)[1]
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"verify_exp": False, "verify_aud": False},
        )
        return {"user_id": payload.get("user_id"), "email": payload.get("email")}
    except Exception:
        return {}


def _build_doc(
    exc: BaseException,
    request,
    source: str,
    status_code: Optional[int],
    user_id: Optional[str],
    user_email: Optional[str],
    context: Optional[dict],
) -> dict:
    loc = _find_app_frame(exc)

    doc = {
        "timestamp": datetime.now(timezone.utc),
        "exception_type": type(exc).__name__,
        "exception_module": type(exc).__module__,
        "message": str(exc)[:_MESSAGE_MAX_LEN],
        "module": loc["module"],
        "function": loc["function"],
        "file_path": loc["file_path"],
        "line_number": loc["line_number"],
        "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[:_TRACEBACK_MAX_LEN],
        "source": source,
        "status_code": status_code,
        "context": context or {},
        "request_method": None,
        "request_path": None,
        "user_id": user_id,
        "user_email": user_email,
    }

    if request is not None:
        try:
            doc["request_method"] = request.method
            doc["request_path"] = request.url.path
        except Exception:
            pass
        if user_id is None and user_email is None:
            req_user = _extract_user_from_request(request)
            doc["user_id"] = req_user.get("user_id")
            doc["user_email"] = req_user.get("email")

    return doc


async def _insert_async(db: AsyncIOMotorDatabase, doc: dict) -> None:
    try:
        await db.error_logs.insert_one(doc)
    except Exception:
        logger.debug("error_logger: async insert failed", exc_info=True)


def _insert_sync(db, doc: dict) -> None:
    try:
        db.error_logs.insert_one(doc)
    except Exception:
        logger.debug("error_logger: sync insert failed", exc_info=True)


def log_error(
    exc: BaseException,
    db,
    *,
    request=None,
    source: str = "manual",
    status_code: Optional[int] = None,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    context: Optional[dict] = None,
) -> None:
    """
    Fire-and-forget error logger. Never raises — a logging failure must
    never crash the caller or mask the original exception.

    Args:
        exc: the caught exception.
        db: either a Motor AsyncIOMotorDatabase (FastAPI/async contexts) or
            a plain pymongo Database (Celery/sync contexts). Detected
            automatically.
        request: pass the FastAPI Request when available (global handler)
            to auto-populate request_method/request_path/user_id/user_email.
            Optional — omit from plain `except Exception` blocks.
        source: "http_exception_handler" for the global handler, or
            "manual:<short-tag>" for an explicitly instrumented call site.
        status_code: HTTP status ultimately returned to the client, if any.
        user_id / user_email: pass explicitly when the caller already has
            `current_user` in scope (preferred over request-header re-decoding).
        context: free-form extra identifiers relevant to the failure
            (e.g. {"meeting_id": ...}).
    """
    try:
        doc = _build_doc(exc, request, source, status_code, user_id, user_email, context)
        if isinstance(db, AsyncIOMotorDatabase):
            asyncio.create_task(_insert_async(db, doc))
        else:
            _insert_sync(db, doc)
    except Exception:
        logger.debug("error_logger: failed to build/record error log", exc_info=True)
