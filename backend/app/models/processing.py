from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ProcessingQueueItem(BaseModel):
    meeting_id: str
    user_id: str
    s3_link: str
    status: str = "pending"  # pending | processing | completed | failed
    retry_count: int = 0
    max_retries: int = 3
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    processing_started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None


class ProcessingConfig(BaseModel):
    window_start: str = "09:00"
    window_end: str = "17:00"
    enabled: bool = True
    max_retries: int = 3
    retry_delay_minutes: int = 5
    external_api_url: Optional[str] = None


class ProcessingCallbackRequest(BaseModel):
    meeting_id: str
    status: str  # "completed" | "failed"
    output: Optional[dict] = None
    error_message: Optional[str] = None


class UpdateProcessingConfigRequest(BaseModel):
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    enabled: Optional[bool] = None
    max_retries: Optional[int] = None
    retry_delay_minutes: Optional[int] = None
    external_api_url: Optional[str] = None
