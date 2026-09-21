import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    display: str = os.getenv("DISPLAY", ":99")
    pulse_server: str = os.getenv("PULSE_SERVER", "unix:/var/run/pulse/native")
    recordings_dir: str = os.getenv("RECORDINGS_DIR", "/recordings")
    chrome_base_profile: str = os.getenv("CHROME_BASE_PROFILE", "/tmp/chrome-profile")
    chrome_backup_profile: str = os.getenv("CHROME_BACKUP_PROFILE", "/tmp/chrome-profile-backup")
    login_timeout: int = int(os.getenv("LOGIN_TIMEOUT", "300"))
    stay_duration_seconds: int = int(os.getenv("STAY_DURATION_SECONDS", "0"))
    novnc_port: int = int(os.getenv("NOVNC_PORT", "6080"))
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))


settings = Settings()
