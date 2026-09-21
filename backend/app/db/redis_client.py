import redis.asyncio as aioredis
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

redis_client: aioredis.Redis = None
redis_available: bool = False


async def connect_redis():
    global redis_client, redis_available
    try:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=5)
        await redis_client.ping()
        redis_available = True
        logger.info("Connected to Redis")
    except Exception as e:
        redis_available = False
        logger.warning(f"Redis connection failed: {e}. Continuing without Redis cache.")


async def close_redis():
    global redis_client
    if redis_client:
        try:
            await redis_client.close()
        except Exception as e:
            logger.warning(f"Error closing Redis connection: {e}")


def get_redis():
    return redis_client if redis_available else None
