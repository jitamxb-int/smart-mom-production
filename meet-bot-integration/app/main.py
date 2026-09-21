from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import setup_login, recording

app = FastAPI(
    title="Smart Mom Meet Recorder API",
    description="Profile setup and meeting recording service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(setup_login.router)
app.include_router(recording.router)


@app.get("/health")
async def health():
    from app.services.setup_login import profile_exists
    return {
        "ok": True,
        "profile_exists": profile_exists(),
        "recordings_dir": settings.recordings_dir,
    }
