from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from pymongo.errors import OperationFailure
import logging

logger = logging.getLogger(__name__)

client = None
db     = None


async def connect_db():
    global client, db
    client = AsyncIOMotorClient(settings.mongo_uri)
    db     = client[settings.mongo_db_name]
    logger.info("Connected to MongoDB Atlas")

    # ── Users collection ──────────────────────────────────────────────────
    # email is the global unique key across both auth providers
    try:
        await db.users.create_index("email", unique=True)
    except OperationFailure as e:
        if "IndexKeySpecsConflict" in str(e):
            logger.warning(f"Index 'email' already exists, skipping...")
        else:
            raise

    # google_id: only used for Google OAuth users, other users have null
    # Drop the old unique index if it exists, then create a proper sparse index
    try:
        await db.users.drop_index("google_id_1")
        logger.info("Dropped old google_id index")
    except Exception:
        pass  # Index may not exist yet

    try:
        await db.users.create_index("google_id", sparse=True)
        logger.info("Created sparse google_id index")
    except OperationFailure as e:
        if "IndexKeySpecsConflict" in str(e):
            logger.warning(f"Index 'google_id' conflict, skipping...")
        else:
            raise

    # ── Meetings collection ───────────────────────────────────────────────
    try:
        await db.meetings.create_index("meeting_id", unique=True)
    except OperationFailure as e:
        if "IndexKeySpecsConflict" in str(e):
            logger.warning(f"Index 'meeting_id' already exists, skipping...")
        else:
            raise

    try:
        await db.meetings.create_index([("user_id", 1), ("created_at", -1)])
    except OperationFailure:
        pass  # Index likely already exists

    try:
        await db.meetings.create_index([("user_id", 1), ("status", 1)])
    except OperationFailure:
        pass

    try:
        await db.meetings.create_index([("user_id", 1), ("diagram.status", 1)])
    except OperationFailure:
        pass

    # ── Chat sessions collection ──────────────────────────────────────────
    try:
        await db.chat_sessions.create_index([("user_id", 1), ("created_at", -1)])
    except OperationFailure:
        pass

    try:
        await db.chat_sessions.create_index([("user_id", 1), ("meeting_id", 1)])
    except OperationFailure:
        pass

    # ── Audio Chunks collection ───────────────────────────────────────────
    try:
        await db.audio_chunks.create_index(
            [("meeting_id", 1), ("chunk_id", 1)], unique=True
        )
    except OperationFailure:
        pass

    try:
        await db.audio_chunks.create_index([("meeting_id", 1), ("uploaded_at", 1)])
    except OperationFailure:
        pass

    # ── Processing Queue collection ────────────────────────────────────────
    try:
        await db.processing_queue.create_index("meeting_id", unique=True)
    except OperationFailure:
        pass

    try:
        await db.processing_queue.create_index([("status", 1), ("created_at", 1)])
    except OperationFailure:
        pass

    logger.info("MongoDB indexes ensured")


async def close_db():
    global client
    if client:
        client.close()
        logger.info("MongoDB connection closed")


def get_db():
    return db
