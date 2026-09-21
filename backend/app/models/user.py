"""
User models — request/response schemas for auth endpoints.
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime


# ─── Register ─────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email:    EmailStr
    password: str = Field(min_length=8, max_length=256)
    name:     str = Field(min_length=1, max_length=100)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()


# ─── Login ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


# ─── Auth Response ────────────────────────────────────────────────────────────

class AuthResponse(BaseModel):
    token:   str
    user_id: str
    email:   str
    name:    Optional[str]
    role:    str


# ─── User Profile (public) ────────────────────────────────────────────────────

class UserProfile(BaseModel):
    user_id:       str
    email:         str
    name:          Optional[str]
    avatar_url:    Optional[str]
    role:          str
    auth_provider: str   # "google" | "email" | "linked"
    created_at:    Optional[datetime]
    last_login_at: Optional[datetime]
