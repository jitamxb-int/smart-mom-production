import os
from datetime import datetime, timezone

from celery import shared_task
from celery.utils.log import get_task_logger
from pymongo import MongoClient
from bson import ObjectId
from bson.errors import InvalidId

from app.core.config import settings
from app.core.email import send_transcription_ready_notification, PermanentEmailError


logger = get_task_logger(__name__)
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())


def _extract_attendee_emails(meeting_doc: dict) -> list[str]:
    attendees = meeting_doc.get("attendees", [])
    emails: list[str] = []

    for a in attendees:
        if isinstance(a, str) and "@" in a:
            emails.append(a.strip().lower())
        elif isinstance(a, dict):
            e = a.get("email") or a.get("attendee_email")
            if isinstance(e, str) and "@" in e:
                emails.append(e.strip().lower())

    for e in meeting_doc.get("attendee_emails", []):
        if isinstance(e, str) and "@" in e:
            emails.append(e.strip().lower())

    # de-duplicate, preserve order
    return list(dict.fromkeys(emails))


@shared_task(
    bind=True,
    name="app.worker.tasks.email_notifications.send_transcription_ready_email",
    max_retries=3,
    default_retry_delay=5,
)
def send_transcription_ready_email(self, user_id, meeting_id):
    """
    1) Resolve user from users._id (ObjectId)
    2) Resolve meeting from meetings.meeting_id + meetings.user_id (string)
    3) Send transcription-ready email to attendees
    """
    sync_client = None
    logger.info(
        "Email task started | meeting_id=%s | user_id=%s | retry=%s",
        meeting_id,
        user_id,
        self.request.retries,
    )

    try:
        sync_client = MongoClient(settings.mongo_uri)
        sync_db = sync_client[settings.mongo_db_name]

        # users._id is ObjectId
        try:
            uid_obj = ObjectId(str(user_id))
        except (InvalidId, TypeError):
            raise PermanentEmailError(f"Invalid user_id: {user_id}")

        user = sync_db.users.find_one({"_id": uid_obj}, {"name": 1, "email": 1})
        if not user:
            raise PermanentEmailError(f"User not found: {user_id}")

        user_name = user.get("name") or "User"
        owner_email = (user.get("email") or "").strip().lower()


        # 2. Fetch Meeting details
        uid_str = str(uid_obj)
        meeting = sync_db.meetings.find_one(
            {"meeting_id": meeting_id, "user_id": uid_str},
            {"attendees": 1, "attendee_emails": 1, "email_transferred": 1, "context": 1},
        )
        if not meeting:
            raise PermanentEmailError(f"Meeting not found: meeting_id={meeting_id}, user_id={uid_str}")

        meeting_context = meeting.get("context") or "Meeting"

        if meeting.get("email_transferred"):
            logger.info("Email already sent; skipping | meeting_id=%s", meeting_id)
            return True

        # 3. Determine Recipients
        # Use a list so that the rest of the function (database updates) works correctly
        recipients = [owner_email]
        recipient_name = user_name

        logger.info("Sending notification to owner | addressed to: %s | email: %s", recipient_name, recipients[0])

        # Send the notification using the HTML template and subject with context
        ok = send_transcription_ready_notification(recipients[0], recipient_name, meeting_id, meeting_context)
        
        if not ok:
             logger.warning("Failed sending to owner | meeting_id=%s | to=%s", meeting_id, recipients[0])
             raise RuntimeError("Email send failed")

        sent = 1
        failed = 0

        now = datetime.now(timezone.utc)
        sync_db.meetings.update_one(
            {"meeting_id": meeting_id, "user_id": uid_str},
            {
                "$set": {
                    "email_transferred": True,
                    "email_transferred_at": now,
                    "email_recipients": recipients,
                    "updated_at": now,
                }
            },
        )

        logger.info(
            "Email task completed | meeting_id=%s | sent=%s | failed=%s",
            meeting_id,
            sent,
            failed,
        )
        return True

    except PermanentEmailError as exc:
        logger.exception("Permanent email error | meeting_id=%s | error=%s", meeting_id, exc)
        # Do not retry permanent data/auth issues
        raise

    except Exception as exc:
        logger.exception("Email task failed | meeting_id=%s | error=%s", meeting_id, exc)
        countdown = min(2 ** self.request.retries * 5, 60)
        logger.info("Retrying email task | meeting_id=%s | countdown=%s", meeting_id, countdown)
        raise self.retry(exc=exc, countdown=countdown)

    finally:
        if sync_client:
            sync_client.close()