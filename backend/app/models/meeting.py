from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Union, Any, Dict
from datetime import datetime


# ─── Transcript Models ────────────────────────────────────────────────────────

class TranscriptSegment(BaseModel):
    speaker: str
    speaker_name: str = ""  # Optional display name for the speaker (e.g., "John" instead of "SPEAKER_00")
    start:   float
    end:     float
    text:    str


class TranscriptData(BaseModel):
    text:       Union[str, List[TranscriptSegment]] = ""
    segments:   List[TranscriptSegment] = []
    word_count: int = Field(default=0, ge=0)
    language:   str = "en"
    received_at: Optional[datetime] = None

    @model_validator(mode="after")
    def normalize_transcript(self):
        # If text is an array of segments, move it to segments and set text to joined string
        if isinstance(self.text, list):
            self.segments = self.text
            # Join all text segments for backward compatibility
            self.text = " ".join(seg.text for seg in self.text)
        return self


# ─── Diagram Models ───────────────────────────────────────────────────────────

class DiagramData(BaseModel):
    status:         str  # pending | not_applicable | ready | failed
    type:           Optional[str] = None
    mermaid_syntax: Optional[str] = None
    generated_at:   Optional[datetime] = None
    error:          Optional[str] = None


# ─── Meeting Output Model ─────────────────────────────────────────────────────

class MeetingOut(BaseModel):
    meeting_id:    str
    user_id:       str
    attendees:     List[str]
    context:       str
    no_of_persons: int
    date_time:     datetime
    status:        str   # audio_uploaded | recording | transcript_ready | failed
    email_transferred: bool = False
    transcript:    Optional[TranscriptData] = None
    diagram:       Optional[DiagramData] = None
    rag_indexed:   bool = False
    rag_indexed_at: Optional[datetime] = None
    audio_s3_key:  str
    storage_backend: Optional[str] = None
    audio_state:   Optional[str] = "merged"   # "merged" | "chunked"
    # LLM-generated outputs (populated asynchronously by llm-generate Celery tasks)
    mom:           Optional[str] = None
    summary:       Optional[str] = None
    key_points:    Optional[str] = None
    created_at:    datetime
    updated_at:    datetime
    merge_error:   Optional[str] = None
    # Meet bot integration fields
    meet_link:     Optional[str] = None
    bot_session_id: Optional[str] = None


class MeetingDetailResponse(BaseModel):
    success: bool
    data:    MeetingOut
    meta:    Optional[dict] = None


# ─── Create Meeting Request ───────────────────────────────────────────────────

class CreateMeetingRequest(BaseModel):
    meeting_id:    str
    attendees:     List[str]
    context:       str = Field(max_length=1000)
    no_of_persons: int = Field(ge=1)
    date_time:     datetime
    audio_s3_key:  str
    # "merged" = full upload or successfully merged chunks
    # "chunked" = chunk mode, merge not yet done (e.g. lost connection)
    audio_state:   Optional[str] = "merged"
    meet_link:     Optional[str] = None

    @field_validator("attendees")
    @classmethod
    def attendees_not_empty(cls, v):
        if not v:
            raise ValueError("attendees must contain at least 1 item")
        return v

    @model_validator(mode="after")
    def check_persons_count(self):
        if self.no_of_persons != len(self.attendees):
            raise ValueError("no_of_persons must equal len(attendees)")
        return self


# ─── Update Meeting Request (PATCH) ──────────────────────────────────────────

IMMUTABLE_FIELDS = {"meeting_id", "user_id", "created_at", "audio_s3_key", "status"}


class UpdateMeetingRequest(BaseModel):
    transcript:    Optional[TranscriptData]  = None
    attendees:     Optional[List[str]]       = None
    context:       Optional[str]             = Field(None, max_length=1000)
    no_of_persons: Optional[int]             = Field(None, ge=1)
    date_time:     Optional[datetime]        = None
    meet_link:     Optional[str]             = None

    # Immutable fields — accepted but always ignored
    meeting_id:    Optional[str]             = None
    user_id:       Optional[str]             = None
    created_at:    Optional[datetime]        = None
    audio_s3_key:  Optional[str]             = None
    status:        Optional[str]             = None

    @field_validator("attendees")
    @classmethod
    def attendees_not_empty(cls, v):
        if v is not None and len(v) == 0:
            raise ValueError("attendees must contain at least 1 item")
        return v

    @field_validator("context")
    @classmethod
    def context_not_empty(cls, v):
        if v is not None and v.strip() == "":
            raise ValueError("context cannot be empty string; use null to skip")
        return v

    @model_validator(mode="after")
    def all_none_check(self):
        editable = {k: v for k, v in self.model_dump().items()
                    if k not in IMMUTABLE_FIELDS and v is not None}
        if not editable:
            raise ValueError("At least one editable field must be provided")
        return self


# ─── Chat Models ──────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role:    str  # user | assistant
    content: str


class ChatRequest(BaseModel):
    message:              str = Field(max_length=1000)
    meeting_id:           Optional[str] = None          # single meeting (legacy)
    meeting_ids:          Optional[List[str]] = None    # multi-meeting scope
    conversation_history: List[ChatMessage] = []


# ─── Audio Chunk Models ───────────────────────────────────────────────────────

class AudioChunk(BaseModel):
    """Metadata for a single audio chunk uploaded in chunk-mode recording."""
    meeting_id:  str
    chunk_id:    int = Field(ge=0, description="Sequential chunk index, starting at 0")
    timestamp:   datetime
    s3_key:      Optional[str] = None   # storage key (same scheme as full audio)
    size_bytes:  Optional[int] = None


# ─── Diagram Response ─────────────────────────────────────────────────────────

class DiagramResponse(BaseModel):
    success:        bool
    meeting_id:     str
    diagram:        Optional[DiagramData]
    rag_indexed:    bool
