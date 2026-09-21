from celery import Celery
from app.core.config import settings

broker_url = settings.celery_broker_url or settings.redis_url
result_backend = settings.celery_result_backend or settings.redis_url

celery_app = Celery(
    "smart-mom-worker",
    broker=broker_url,
    backend=result_backend,
    include=[
        "app.worker.tasks.llm_generate",
        "app.worker.tasks.embed_chunks",
        "app.worker.tasks.diagram_gen",
        "app.worker.tasks.email_notifications",
        "app.worker.tasks.processing_queue",
    ],
)

celery_app.conf.update(
    task_routes={
        "app.worker.tasks.llm_generate.*": {"queue": "llm-generate"},
        "app.worker.tasks.embed_chunks.*": {"queue": "embed-chunks"},
        "app.worker.tasks.diagram_gen.*":  {"queue": "diagram-gen"},
        "app.worker.tasks.email_notifications.*": {"queue": "email-notifications"},
        "app.worker.tasks.processing_queue.*": {"queue": "processing-queue"},
    },
    task_max_retries=3,
    task_default_retry_delay=5,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "poll-processing-queue": {
            "task": "app.worker.tasks.processing_queue.poll_processing_queue",
            "schedule": settings.processing_poll_interval_seconds,
        },
    },
)
