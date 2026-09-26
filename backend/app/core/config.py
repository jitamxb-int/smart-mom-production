from pydantic_settings import BaseSettings
from typing import Optional, List


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 3014
    environment: str = "production"

    # CORS — comma-separated list of allowed origins
    # e.g. "https://yourdomain.com,http://localhost:3002"
    cors_origins: str = "http://localhost:3015,http://localhost:3002"

    # MongoDB Atlas
    mongo_uri: str
    mongo_db_name: str = "meetmind"

    # Redis (Celery broker + token blacklist)
    redis_url: str = "redis://redis:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None



    # JWT
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    # Google OAuth
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str

    # OpenAI
    openai_api_key: str
    openai_base_url: Optional[str] = None  # For Azure/custom endpoints

    # ── AWS S3 ───────────────────────────────────────────────────────────────────
    # Credentials are resolved automatically by boto3 in this order:
    # 1. Environment variables (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
    # 2. ~/.aws/credentials file
    # 3. EC2 / ECS IAM role (recommended for production)
    # NEVER hardcode credentials.
    aws_region: str = "ap-south-1"           # Maps to AWS_REGION env var
    s3_bucket_name: str = "vyom-backend-demo"   # Maps to S3_BUCKET_NAME env var

    # Optional: AWS Session Token for temporary credentials
    aws_session_token: Optional[str] = None  # Maps to AWS_SESSION_TOKEN env var

    # Qdrant Cloud
    qdrant_url: str
    qdrant_api_key: str
    qdrant_collection: str = "Transcript-mom"

    # Embedding
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    # Chunking
    chunk_size_tokens: int = 500
    chunk_overlap_tokens: int = 50

    # Optional: HMAC secret for verifying callbacks from Backend 1
    backend1_hmac_secret: Optional[str] = None

    # ── Email / SMTP Settings ──────────────────────────────────────────────────
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from_email: str = "jitam.bharadwaj@intglobal.com"
    
    # IMAP Settings (for saving sent emails to the "Sent" folder)
    imap_host: Optional[str] = None  # e.g., "imap.gmail.com"
    imap_port: int = 993
    imap_password: Optional[str] = None
    imap_enabled: bool = False
    imap_sent_folder: str = "Sent"  # Gmail: "[Gmail]/Sent Mail", Outlook: "Sent"
    
    company_name: str = "Indus Net Technologies"
    support_contact: str = "mom@indusnettechnologies.com"

    # ── Meet Bot Integration ──────────────────────────────────────────────────
    # Virtual display for headless Chrome
    meet_bot_display: str = ":99"
    # PulseAudio server socket
    meet_bot_pulse_server: str = "unix:/var/run/pulse/native"
    # Recordings temp directory
    meet_bot_recordings_dir: str = "/tmp/meet-bot-recordings"
    # Chrome profiles for Google login
    meet_bot_chrome_profile: str = "/tmp/chrome-profile"
    meet_bot_chrome_backup: str = "/tmp/chrome-profile-backup"
    # noVNC port for watching the bot browser
    meet_bot_novnc_port: int = 6080

    # ── Processing Queue Settings ──────────────────────────────────────────────
    processing_window_start: str = "09:00"          # HH:MM in UTC
    processing_window_end: str = "17:00"            # HH:MM in UTC
    processing_max_retries: int = 3
    processing_retry_delay_minutes: int = 5
    processing_poll_interval_seconds: int = 60
    external_api_url: Optional[str] = None


    # ── Audio Storage Backend ──────────────────────────────────────────────────
    # "s3"   → upload/serve audio via AWS S3 presigned URLs (default)
    # "local" → store audio on the local file system in audio_local_path
    audio_storage_backend: str = "s3"

    # Absolute path on disk where audio files are stored in local mode.
    # The directory is created automatically if it does not exist.
    # Default: "audio_files" relative to the working directory (safe for non-root processes).
    # Override with an absolute path in production, e.g. /var/meetmind/audio
    audio_local_path: str = "./audio_files"

    # ── Error Logs ────────────────────────────────────────────────────────────────
    # How long captured error_logs documents are retained before MongoDB's TTL
    # index auto-deletes them. Changing this requires a backend restart so
    # connect_db() can reconcile the TTL index (see db/database.py).
    error_log_ttl_hours: int = 72

    @property
    def error_log_ttl_seconds(self) -> int:
        return self.error_log_ttl_hours * 3600

    @property
    def cors_origins_list(self) -> List[str]:
        """Return cors_origins as a parsed list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"  # Allow extra env vars without raising errors


settings = Settings()
