from qdrant_client import QdrantClient
from qdrant_client.models import (
    VectorParams, Distance, PayloadSchemaType,
    PointStruct, Filter, FieldCondition, MatchValue
)
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

qdrant_client: QdrantClient = None
qdrant_available: bool = False


def connect_qdrant():
    global qdrant_client, qdrant_available
    try:
        qdrant_client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=10,
        )
        qdrant_available = True
        logger.info("Qdrant client initialized")
    except Exception as e:
        qdrant_available = False
        logger.warning(f"Qdrant connection failed: {e}. Continuing without Qdrant.")


def get_qdrant():
    return qdrant_client if qdrant_available else None


def ensure_collection():
    """Create Qdrant collection and indexes if they don't exist."""
    if not qdrant_available:
        logger.warning("Qdrant not available — skipping collection check")
        return

    try:
        client = get_qdrant()
        collections = client.get_collections().collections
        names = [c.name for c in collections]

        if settings.qdrant_collection not in names:
            # Use create_collection (recreate_collection was removed in qdrant-client >= 1.9)
            client.create_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=VectorParams(
                    size=settings.embedding_dimensions,
                    distance=Distance.COSINE,
                ),
                on_disk_payload=True,
            )
            client.create_payload_index(
                settings.qdrant_collection, "user_id", PayloadSchemaType.KEYWORD
            )
            client.create_payload_index(
                settings.qdrant_collection, "meeting_id", PayloadSchemaType.KEYWORD
            )
            logger.info(f"Created Qdrant collection '{settings.qdrant_collection}'")
        else:
            logger.info(f"Qdrant collection '{settings.qdrant_collection}' already exists")
    except Exception as e:
        logger.warning(f"Qdrant collection check failed: {e}. Continuing without Qdrant.")
