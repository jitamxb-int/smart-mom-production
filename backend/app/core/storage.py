"""
Storage Abstraction Layer
=========================
Provides a unified interface for storing and retrieving audio files.

Uses signed S3 requests (IAM role, env vars, or ~/.aws/credentials).

Public API:
    get_storage() -> BaseStorage
    set_active_backend(name: str)
    get_active_backend_name() -> str
    load_storage_config_from_db(db)
"""
import logging
import os
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)


# ─── Base interface ───────────────────────────────────────────────────────────

class BaseStorage:
    def upload_audio(self, data: bytes, s3_key: str) -> str:
        raise NotImplementedError

    def get_download_url(self, s3_key: str) -> str:
        raise NotImplementedError

    def get_upload_presigned_url(self, s3_key: str) -> str:
        raise NotImplementedError

    def delete_audio(self, s3_key: str) -> None:
        raise NotImplementedError

    def read_audio(self, s3_key: str) -> bytes:
        raise NotImplementedError

    def backend_name(self) -> str:
        raise NotImplementedError


# ─── S3 Backend ───────────────────────────────────────────────────────────────

class S3Storage(BaseStorage):
    """S3 storage backend using signed requests (IAM role / env vars / credentials file)."""

    def upload_audio(self, data: bytes, s3_key: str) -> str:
        from app.core.s3_utils import upload_object
        upload_object(s3_key, data, "audio/webm")
        return s3_key

    def get_download_url(self, s3_key: str) -> str:
        from app.core.s3_utils import get_presigned_download_url
        return get_presigned_download_url(s3_key)

    def get_upload_presigned_url(self, s3_key: str) -> str:
        from app.core.s3_utils import get_presigned_upload_url
        return get_presigned_upload_url(s3_key)

    def delete_audio(self, s3_key: str) -> None:
        from app.core.s3_utils import delete_object
        delete_object(s3_key)

    def read_audio(self, s3_key: str) -> bytes:
        from app.core.s3_utils import get_object
        return get_object(s3_key)

    def backend_name(self) -> str:
        return "s3"


# ─── Local Filesystem Backend ─────────────────────────────────────────────────

class LocalStorage(BaseStorage):
    """Local filesystem storage backend."""

    def _resolve(self, s3_key: str) -> Path:
        """Map a storage key to a full local path and create parent directories."""
        base = Path(settings.audio_local_path).resolve()
        relative = s3_key.lstrip("/")
        full = base / relative
        try:
            full.parent.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise IOError(
                f"Cannot create local audio directory '{full.parent}'. "
                f"Check that AUDIO_LOCAL_PATH ('{settings.audio_local_path}') is writable. "
                f"Original error: {e}"
            )
        return full

    def upload_audio(self, data: bytes, s3_key: str) -> str:
        path = self._resolve(s3_key)
        path.write_bytes(data)
        logger.info(f"Local: saved {len(data):,} bytes → {path}")
        return s3_key

    def get_download_url(self, s3_key: str) -> str:
        import urllib.parse
        return f"/api/v1/meetings/stream-audio?key={urllib.parse.quote(s3_key)}"

    def get_upload_presigned_url(self, s3_key: str) -> str:
        raise NotImplementedError(
            "Presigned URLs are not available for local storage. "
            "Use the /upload-audio endpoint instead."
        )

    def delete_audio(self, s3_key: str) -> None:
        try:
            self._resolve(s3_key).unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Local: delete failed for {s3_key}: {e}")

    def read_audio(self, s3_key: str) -> bytes:
        return self._resolve(s3_key).read_bytes()

    def backend_name(self) -> str:
        return "local"


# ─── Runtime state (module-level, process-scoped) ────────────────────────────

_active_backend: BaseStorage | None = None


def _make_backend(name: str) -> BaseStorage:
    """Create a new backend instance for the given name."""
    if name == "local":
        base = Path(settings.audio_local_path).resolve()
        try:
            base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise RuntimeError(
                f"Cannot create local audio storage directory '{base}'. "
                f"Set AUDIO_LOCAL_PATH to a writable directory. Error: {e}"
            )
        if not os.access(base, os.W_OK | os.X_OK):
            raise RuntimeError(
                f"Local audio storage directory '{base}' is not writable by "
                f"the backend process. Set AUDIO_LOCAL_PATH to a writable "
                "directory or fix its ownership and permissions."
            )
        logger.info(f"Local audio storage directory: {base}")
        return LocalStorage()
    return S3Storage()


def get_storage() -> BaseStorage:
    """Return the currently active storage backend."""
    global _active_backend
    if _active_backend is None:
        _active_backend = _make_backend(settings.audio_storage_backend.strip().lower())
        logger.info(f"Storage initialised from env: {_active_backend.backend_name()}")
    return _active_backend


def set_active_backend(name: str) -> BaseStorage:
    """Switch the active storage backend immediately."""
    global _active_backend
    if name not in ("s3", "local"):
        raise ValueError(f"Invalid storage backend: {name!r}. Must be 's3' or 'local'.")
    _active_backend = _make_backend(name)
    logger.info(f"Audio storage switched to: {name.upper()}")
    return _active_backend


def get_active_backend_name() -> str:
    return get_storage().backend_name()


async def load_storage_config_from_db(db) -> None:
    """Called once at app startup to restore the admin's last saved choice."""
    try:
        record = await db.system_config.find_one({"key": "audio_storage_backend"})
        if record and record.get("value") in ("s3", "local"):
            set_active_backend(record["value"])
            logger.info(f"Audio storage restored from DB: {record['value'].upper()}")
        else:
            logger.info(f"No DB storage config found — using env default: {get_active_backend_name().upper()}")
    except Exception as e:
        logger.warning(f"Could not load storage config from DB: {e}. Using env default.")
