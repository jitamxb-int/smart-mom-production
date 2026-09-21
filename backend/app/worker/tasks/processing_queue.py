"""
Processing Queue Polling Task
==============================
Celery Beat periodic task that polls the processing_queue collection
and dispatches items to the external /transcript API during the
configured window. The external service processes asynchronously and
calls back via POST /api/v1/processing/callback when done.
"""
import json
from datetime import datetime, timezone, time as dtime
from urllib.parse import urljoin
from app.worker.celery_app import celery_app
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


def get_sync_db():
    from pymongo import MongoClient
    client = MongoClient(settings.mongo_uri)
    return client[settings.mongo_db_name]


def _is_within_window(window_start: str, window_end: str) -> bool:
    """Check if current UTC time is within the configured window."""
    try:
        start_parts = window_start.split(":")
        end_parts = window_end.split(":")
        start = dtime(int(start_parts[0]), int(start_parts[1]))
        end = dtime(int(end_parts[0]), int(end_parts[1]))
        now = datetime.now(timezone.utc).time()

        if start <= end:
            return start <= now <= end
        else:
            return now >= start or now <= end
    except Exception as e:
        logger.error(f"Failed to parse processing window: {e}")
        return False


def _send_to_external_api(meeting_id: str, user_id: str, s3_url: str) -> bool:
    """
    POST to <external_api_url>/transcript with { meeting_id, user_id, s3_url }.
    Returns True on 2xx (service accepted), False otherwise.
    """
    base_url = settings.external_api_url
    if not base_url:
        logger.warning(f"external_api_url not configured — skipping dispatch for {meeting_id}")
        return False

    import requests

    api_url = urljoin(base_url.rstrip("/") + "/", "transcript")

    payload = {
        "meeting_id": meeting_id,
        "user_id": user_id,
        "s3_url": s3_url,
    }
    body_bytes = json.dumps(payload, default=str).encode()

    headers = {
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(
            api_url,
            data=body_bytes,
            headers=headers,
            timeout=30,
        )
        if resp.status_code in (200, 201, 202):
            logger.info(f"External /transcript accepted meeting {meeting_id} (status={resp.status_code})")
            return True
        else:
            logger.error(f"External /transcript returned {resp.status_code} for meeting {meeting_id}: {resp.text[:200]}")
            return False
    except requests.exceptions.Timeout:
        logger.error(f"External /transcript timeout for meeting {meeting_id}")
        return False
    except requests.exceptions.ConnectionError as e:
        logger.error(f"External /transcript connection error for meeting {meeting_id}: {e}")
        return False
    except Exception as e:
        logger.error(f"External /transcript error for meeting {meeting_id}: {e}")
        return False


@celery_app.task(bind=True, name="app.worker.tasks.processing_queue.poll_processing_queue", max_retries=0)
def poll_processing_queue(self):
    """
    Periodic task (run by Celery Beat every N seconds).

    1. Load config from system_config (or env defaults)
    2. Check if within processing window
    3. Pick oldest pending item, atomically set to 'processing'
    4. Dispatch to external /transcript endpoint
    5. On success → leave as 'processing' (callback will finalize)
       On failure → increment retry; either revert to 'pending' or mark 'failed'
    """
    db = get_sync_db()

    config_record = db.system_config.find_one({"key": "processing_config"})
    cfg = config_record.get("value") if config_record and config_record.get("value") else {}

    enabled = cfg.get("enabled", True)
    if not enabled:
        return

    window_start = cfg.get("window_start", settings.processing_window_start)
    window_end = cfg.get("window_end", settings.processing_window_end)
    max_retries = cfg.get("max_retries", settings.processing_max_retries)

    if not _is_within_window(window_start, window_end):
        logger.debug(f"Outside processing window ({window_start}-{window_end} UTC) — skipping")
        return

    now = datetime.now(timezone.utc)

    queue_item = db.processing_queue.find_one_and_update(
        {"status": "pending"},
        {"$set": {
            "status": "processing",
            "processing_started_at": now,
            "updated_at": now,
        }},
        sort=[("created_at", 1)],
        return_document=True,
    )

    if not queue_item:
        return

    meeting_id = queue_item["meeting_id"]
    user_id = queue_item["user_id"]
    s3_url = queue_item["s3_link"]
    logger.info(f"Processing queue item {meeting_id} — dispatching to external /transcript")

    success = _send_to_external_api(meeting_id, user_id, s3_url)

    now = datetime.now(timezone.utc)

    if success:
        # External service accepted and is processing asynchronously.
        # Status stays 'processing' — the service will call our callback
        # endpoint with the final result.
        logger.info(f"Meeting {meeting_id} dispatched to external service — awaiting callback")
    else:
        retry_count = queue_item.get("retry_count", 0) + 1
        new_status = "failed" if retry_count >= max_retries else "pending"

        update = {
            "status": new_status,
            "retry_count": retry_count,
            "last_error_at": now,
            "updated_at": now,
        }
        if new_status == "failed":
            update["error_message"] = "Max retries exceeded"

        db.processing_queue.update_one(
            {"meeting_id": meeting_id},
            {"$set": update},
        )
        logger.info(f"Meeting {meeting_id} dispatch failed — retry {retry_count}/{max_retries}, status={new_status}")
