from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.db.database import connect_db, close_db, get_db
from app.db.redis_client import connect_redis, close_redis
from app.db.qdrant_client import connect_qdrant, ensure_collection
from app.auth.routes     import router as auth_router
from app.routes.meetings import router as meetings_router
from app.routes.chat     import router as chat_router
from app.routes.diagrams import router as diagrams_router
from app.routes.stats    import router as stats_router
from app.routes.admin    import router as admin_router
from app.routes.processing import router as processing_router
from app.routes.bot_recording import router as bot_recording_router
from app.routes.bot_setup import router as bot_setup_router
from app.core.config import settings
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)s  %(levelname)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting MeetMind Backend...")
    await connect_db()
    await connect_redis()
    connect_qdrant()
    ensure_collection()

    from app.core.storage import load_storage_config_from_db
    db = get_db()
    await load_storage_config_from_db(db)

    logger.info("All services connected. Backend ready on port 3014.")
    yield
    await close_db()
    await close_redis()
    logger.info("Backend shut down cleanly.")


app = FastAPI(
    title="MeetMind Backend",
    description="AI-Powered Meeting Intelligence — REST API (Port 3014)",
    version="3.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# MUST be added FIRST — before any other middleware or exception handlers.
# If a request errors (e.g. 401 from auth) before CORS headers are set,
# the browser reports a CORS error instead of the real status code.
#
# Origins come from the CORS_ORIGINS env var (comma-separated).
# Default: both the dev frontend port (3015) and legacy port (3002).

_cors_origins = settings.cors_origins_list
logger.info(f"CORS allowed origins: {_cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "X-Backend1-Signature",
    ],
    expose_headers=["Content-Length", "Content-Disposition"],
    max_age=600,
)


# ── Preflight short-circuit ───────────────────────────────────────────────────
# CORSMiddleware handles OPTIONS correctly, but defining this route ensures
# OPTIONS requests never accidentally reach auth dependencies and get a 401.
@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str):
    """Return 200 for all OPTIONS preflight requests."""
    return JSONResponse(content={}, status_code=200)


# ── Global exception handler ──────────────────────────────────────────────────
# Defined AFTER CORSMiddleware so CORS headers are already present on 5xx
# responses — otherwise the browser would see a CORS error, not the 500.
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)

    from app.core.error_logger import log_error
    log_error(exc, get_db(), request=request, source="http_exception_handler", status_code=500)

    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "detail": {
                "code":    "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred",
            },
        },
    )


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "meetmind-backend", "version": "3.0.0"}


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(meetings_router)
app.include_router(chat_router)
app.include_router(diagrams_router)
app.include_router(stats_router)
app.include_router(admin_router)
app.include_router(processing_router)
app.include_router(bot_recording_router)
app.include_router(bot_setup_router)
