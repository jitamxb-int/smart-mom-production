"""
Embed Chunks Task — NEW v3.0
Chunks transcript text, embeds with text-embedding-3-small, upserts to Qdrant.
Queue: embed-chunks
"""
import uuid
from datetime import datetime, timezone
from celery import shared_task
from app.worker.celery_app import celery_app
from app.core.config import settings
from app.core.error_logger import log_error
import logging

logger = logging.getLogger(__name__)


def get_sync_db():
    from pymongo import MongoClient
    client = MongoClient(settings.mongo_uri)
    return client[settings.mongo_db_name]


def get_openai_client():
    from openai import OpenAI
    return OpenAI(api_key=settings.openai_api_key)


def get_qdrant_client():
    from qdrant_client import QdrantClient
    return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """
    Split text into overlapping chunks sized by approximate token count.
    Uses pure character arithmetic (1 token ≈ 4 chars) — no network downloads.
    Snaps chunk boundaries to word edges to avoid mid-word cuts.
    """
    char_size    = chunk_size * 4
    char_overlap = overlap * 4
    chunks       = []
    start        = 0

    while start < len(text):
        end = min(start + char_size, len(text))
        # Snap to word boundary
        if end < len(text):
            snap = text.rfind(" ", start, end)
            if snap > start:
                end = snap
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = end - char_overlap

    return chunks


def batch_embed(texts: list[str], openai_client) -> list[list[float]]:
    """Batch-embed texts with OpenAI. 100 texts per call."""
    all_embeddings = []
    batch_size     = 100

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        resp  = openai_client.embeddings.create(
            input=batch,
            model=settings.embedding_model,
        )
        all_embeddings.extend([d.embedding for d in resp.data])

    return all_embeddings


@celery_app.task(bind=True, name="app.worker.tasks.embed_chunks.embed_transcript", max_retries=3)
def embed_transcript(self, meeting_id: str):
    """
    Chunk and embed meeting transcript, upsert to Qdrant.
    Sets rag_indexed=True in MongoDB on success.
    """
    from qdrant_client.models import PointStruct

    db             = get_sync_db()
    openai_client  = get_openai_client()
    qdrant_client  = get_qdrant_client()

    try:
        meeting = db.meetings.find_one({"meeting_id": meeting_id})
        if not meeting:
            logger.error(f"Meeting {meeting_id} not found")
            return

        transcript = meeting.get("transcript", {})
        if not transcript or not transcript.get("text"):
            logger.warning(f"No transcript text for meeting {meeting_id}")
            return

        transcript_text = transcript["text"]
        user_id         = meeting["user_id"]
        meeting_title   = meeting.get("context", meeting_id)[:100]

        # Delete existing Qdrant points for this meeting (for re-index)
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        try:
            qdrant_client.delete(
                collection_name=settings.qdrant_collection,
                points_selector=Filter(
                    must=[FieldCondition(key="meeting_id", match=MatchValue(value=meeting_id))]
                ),
            )
        except Exception as e:
            logger.warning(f"Could not delete existing Qdrant points: {e}")
            log_error(
                e, db,
                source="manual:embed_chunks.embed_transcript_qdrant_cleanup",
                context={"meeting_id": meeting_id},
            )

        # Chunk text
        chunks = chunk_text(
            transcript_text,
            chunk_size=settings.chunk_size_tokens,
            overlap=settings.chunk_overlap_tokens,
        )
        logger.info(f"Chunked meeting {meeting_id} into {len(chunks)} chunks")

        if not chunks:
            logger.warning(f"No chunks produced for meeting {meeting_id}")
            return

        # Embed all chunks
        embeddings = batch_embed(chunks, openai_client)

        # Upsert to Qdrant
        points = []
        for idx, (chunk_text_val, embedding) in enumerate(zip(chunks, embeddings)):
            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload={
                    "user_id":       user_id,
                    "meeting_id":    meeting_id,
                    "meeting_title": meeting_title,
                    "chunk_index":   idx,
                    "chunk_text":    chunk_text_val,
                    "created_at":    datetime.now(timezone.utc).isoformat(),
                },
            ))

        # Upsert in batches
        batch_size = 100
        for i in range(0, len(points), batch_size):
            qdrant_client.upsert(
                collection_name=settings.qdrant_collection,
                points=points[i:i + batch_size],
            )

        # Update MongoDB
        now = datetime.now(timezone.utc)
        db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {
                "rag_indexed":    True,
                "rag_indexed_at": now,
                "updated_at":     now,
            }},
        )
        logger.info(f"Indexed {len(chunks)} chunks for meeting {meeting_id}")

    except Exception as exc:
        logger.error(f"embed_transcript error for {meeting_id}: {exc}")
        log_error(exc, db, source="manual:embed_chunks.embed_transcript", context={"meeting_id": meeting_id})
        raise self.retry(exc=exc, countdown=10)
