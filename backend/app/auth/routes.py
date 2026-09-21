"""
Authentication routes.

Supports multiple auth methods with account linking:
  1. Email + password  →  POST /auth/register,  POST /auth/login
  2. Google OAuth 2.0  →  GET  /auth/google,    GET  /auth/google/callback
                          POST /auth/google/token  (called by NextAuth)

ACCOUNT LINKING:
- Users can link both email/password and Google auth to the same account
- When a user signs up with one method and later uses the other with the same email,
  the accounts are automatically linked
- Linked accounts can use either authentication method

Both methods issue the same internal JWT. The JWT payload includes
`auth_provider` ("email" | "google" | "linked") so downstream code can tell them apart.

MongoDB user document schema
─────────────────────────────
{
  _id:            ObjectId,
  email:          str   (unique),
  name:           str,
  avatar_url:     str | None,
  role:           "user" | "admin",
  auth_provider:  "email" | "google" | "linked",

  # Email-auth (null for Google-only users)
  password_hash:  str | None,
  email_verified: bool,          # True for Google users, configurable for email users

  # Google-auth (null for email-only users)
  google_id:      str | None,

  created_at:     datetime,
  last_login_at:  datetime,
}
"""

import secrets
import httpx
from datetime import datetime, timezone
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from passlib.context import CryptContext

from app.core.config import settings
from app.auth.jwt import create_token, get_current_user, get_token_remaining_ttl
from app.models.user import RegisterRequest, LoginRequest, AuthResponse
from app.db.database import get_db
from app.db.redis_client import get_redis
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Argon2 context — more secure than bcrypt, no byte limitations
pwd_ctx = CryptContext(schemes=["argon2"], deprecated="auto")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
SCOPES = "openid email profile"


# ═════════════════════════════════════════════════════════════════════════════
# EMAIL / PASSWORD
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest, db=Depends(get_db)):
    """
    Create a new account with email + password.

    Rules:
    - Email must be unique across the entire users collection.
    - If the email already exists with a Google account, offer to link the account.
    - Password is hashed using Argon2; the plaintext is never stored.
    """
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})

    if existing:
        # Check if it's a Google-only user - allow linking by adding password
        if existing.get("google_id") and not existing.get("password_hash"):
            # Link password to existing Google account
            now = datetime.now(timezone.utc)
            password_hash = pwd_ctx.hash(body.password)
            await db.users.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "password_hash":  password_hash,
                        "name":           body.name,
                        "auth_provider":  "linked",  # Now has both auth methods
                        "email_verified": True,  # Google verifies
                        "last_login_at":  now,
                    }
                }
            )
            existing["password_hash"] = password_hash
            existing["name"] = body.name
            existing["auth_provider"] = "linked"
            existing["email_verified"] = True
            existing["last_login_at"] = now
            logger.info(f"Linked password to existing Google user: {email}")

            token = create_token(existing)
            return AuthResponse(
                token=token,
                user_id=str(existing["_id"]),
                email=email,
                name=body.name,
                role=existing.get("role", "user"),
            )

        # Email already has a password (either email-only or linked account)
        raise HTTPException(
            status_code=409,
            detail={"code": "EMAIL_TAKEN", "message": "An account with this email already exists."},
        )

    now = datetime.now(timezone.utc)
    password_hash = pwd_ctx.hash(body.password)

    doc = {
        "email":          email,
        "name":           body.name,
        "avatar_url":     None,
        "role":           "user",
        "auth_provider":  "email",
        "password_hash":  password_hash,
        "email_verified": False,   # set True when email confirmation is implemented
        "google_id":      None,
        "created_at":     now,
        "last_login_at":  now,
    }

    result = await db.users.insert_one(doc)
    doc["_id"] = result.inserted_id

    token = create_token(doc)
    return AuthResponse(
        token=token,
        user_id=str(doc["_id"]),
        email=email,
        name=body.name,
        role="user",
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db=Depends(get_db)):
    """
    Sign in with email + password.

    Supports:
    - Email-only accounts
    - Linked accounts (has both password AND google_id)

    Deliberately uses the same error message for 'email not found' and
    'wrong password' to prevent user enumeration.
    """
    email = body.email.lower().strip()
    user  = await db.users.find_one({"email": email})

    INVALID = HTTPException(
        status_code=401,
        detail={"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."},
    )

    if not user:
        raise INVALID

    # Google-only users cannot sign in with password
    if user.get("auth_provider") == "google" and not user.get("password_hash"):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "GOOGLE_ACCOUNT",
                "message": "This account uses Google sign-in. Please continue with Google.",
            },
        )

    password_hash = user.get("password_hash")
    if not password_hash:
        raise INVALID

    if not pwd_ctx.verify(body.password, password_hash):
        raise INVALID

    # Update last_login_at
    now = datetime.now(timezone.utc)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now}})
    user["last_login_at"] = now

    token = create_token(user)
    return AuthResponse(
        token=token,
        user_id=str(user["_id"]),
        email=user["email"],
        name=user.get("name"),
        role=user.get("role", "user"),
    )


# ═════════════════════════════════════════════════════════════════════════════
# GOOGLE OAUTH
# ═════════════════════════════════════════════════════════════════════════════

async def _google_upsert(google_id: str, email: str, name: str, avatar_url: str | None, db):
    """
    Handle Google sign-in with account linking.

    Strategy:
    1. First, check if a user with this google_id already exists (returning user)
    2. If not, check if a user with this email exists (account linking scenario)
    3. If email user exists, link the Google account to it
    4. Otherwise, create a new Google-only user

    Returns the user document.
    """
    now = datetime.now(timezone.utc)
    email_normalized = email.lower().strip()

    # Case 1: Existing Google user (returning)
    existing_by_google = await db.users.find_one({"google_id": google_id})
    if existing_by_google:
        await db.users.update_one(
            {"_id": existing_by_google["_id"]},
            {
                "$set": {
                    "email":         email_normalized,
                    "name":          name,
                    "avatar_url":    avatar_url,
                    "last_login_at": now,
                }
            }
        )
        existing_by_google["email"] = email_normalized
        existing_by_google["name"] = name
        existing_by_google["avatar_url"] = avatar_url
        existing_by_google["last_login_at"] = now
        return existing_by_google

    # Case 2: Email user exists - LINK the accounts
    existing_by_email = await db.users.find_one({"email": email_normalized})
    if existing_by_email:
        # Link Google account to existing email user
        await db.users.update_one(
            {"_id": existing_by_email["_id"]},
            {
                "$set": {
                    "google_id":      google_id,
                    "avatar_url":     avatar_url or existing_by_email.get("avatar_url"),
                    "last_login_at":  now,
                    "email_verified": True,  # Google verifies the email
                    "auth_provider":  "linked",  # Now has both auth methods
                    "name":           name or existing_by_email.get("name"),
                }
            }
        )
        existing_by_email["google_id"] = google_id
        existing_by_email["avatar_url"] = avatar_url or existing_by_email.get("avatar_url")
        existing_by_email["last_login_at"] = now
        existing_by_email["email_verified"] = True
        existing_by_email["auth_provider"] = "linked"
        existing_by_email["name"] = name or existing_by_email.get("name")
        logger.info(f"Linked Google account to existing email user: {email_normalized}")
        return existing_by_email

    # Case 3: New user - create Google-only account
    doc = {
        "email":          email_normalized,
        "name":           name,
        "avatar_url":     avatar_url,
        "role":           "user",
        "auth_provider":  "google",
        "password_hash":  None,
        "email_verified": True,
        "google_id":      google_id,
        "created_at":     now,
        "last_login_at":  now,
    }
    result = await db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    logger.info(f"Created new Google user: {email_normalized}")
    return doc


@router.get("/google")
async def google_login():
    """Initiate the Google OAuth 2.0 authorization flow."""
    state = secrets.token_urlsafe(32)
    redis = get_redis()
    await redis.setex(f"oauth_state:{state}", 600, "1")

    params = {
        "client_id":     settings.google_client_id,
        "redirect_uri":  settings.google_redirect_uri,
        "response_type": "code",
        "scope":         SCOPES,
        "state":         state,
        "access_type":   "offline",
        "prompt":        "select_account",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{qs}")


@router.get("/google/callback")
async def google_callback(code: str, state: str, db=Depends(get_db)):
    """Handle the Google redirect. Creates or updates the user, issues JWT."""
    redis = get_redis()
    if not await redis.get(f"oauth_state:{state}"):
        raise HTTPException(status_code=400, detail={"code": "INVALID_STATE"})
    await redis.delete(f"oauth_state:{state}")

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri":  settings.google_redirect_uri,
            "grant_type":    "authorization_code",
        })
        if token_resp.status_code != 200:
            logger.error(f"Google token exchange failed: {token_resp.text}")
            raise HTTPException(status_code=400, detail={"code": "TOKEN_EXCHANGE_FAILED"})

        access_token = token_resp.json().get("access_token")
        info_resp    = await client.get(
            GOOGLE_INFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if info_resp.status_code != 200:
            raise HTTPException(status_code=400, detail={"code": "PROFILE_FETCH_FAILED"})
        profile = info_resp.json()

    user = await _google_upsert(
        google_id=profile["sub"],
        email=profile["email"],
        name=profile.get("name", ""),
        avatar_url=profile.get("picture"),
        db=db,
    )
    token = create_token(user)

    frontend_base = settings.google_redirect_uri.replace("/auth/google/callback", "")
    return RedirectResponse(url=f"{frontend_base}/auth/callback?token={token}")


@router.post("/google/token")
async def google_token_exchange(body: dict, db=Depends(get_db)):
    """
    Exchange a Google ID token for an internal JWT.
    Called by NextAuth's signIn callback on the server side.

    This endpoint handles account linking:
    - If the email matches an existing email/password user, links the Google account
    - If the google_id matches an existing user, updates and returns that user
    - Otherwise creates a new Google-only user
    """
    id_token = body.get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail={"code": "MISSING_TOKEN"})

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}")
        if resp.status_code != 200:
            logger.error(f"Google tokeninfo failed: {resp.text}")
            raise HTTPException(status_code=401, detail={"code": "INVALID_ID_TOKEN"})
        info = resp.json()

    if info.get("aud") != settings.google_client_id:
        raise HTTPException(status_code=401, detail={"code": "INVALID_AUDIENCE"})

    user = await _google_upsert(
        google_id=info["sub"],
        email=info["email"],
        name=info.get("name", ""),
        avatar_url=info.get("picture"),
        db=db,
    )
    return {"token": create_token(user)}


# ═════════════════════════════════════════════════════════════════════════════
# SHARED
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/refresh")
async def refresh_token(current_user: dict = Depends(get_current_user)):
    """Re-issue a JWT. Fetches latest role/name from DB."""
    db = get_db()
    try:
        user = await db.users.find_one({"_id": ObjectId(current_user["user_id"])})
    except Exception:
        user = None

    if not user:
        # Fallback: re-issue from payload (role may be stale)
        user = {
            "_id":           current_user["user_id"],
            "email":         current_user["email"],
            "role":          current_user.get("role", "user"),
            "auth_provider": current_user.get("auth_provider", "email"),
            "google_id":     current_user.get("google_id"),
        }

    return {"token": create_token(user)}


@router.post("/logout")
async def logout(request: Request, current_user: dict = Depends(get_current_user)):
    """Blacklist the current token in Redis for its remaining lifetime."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    ttl   = get_token_remaining_ttl(token)
    if ttl > 0:
        redis = get_redis()
        await redis.setex(f"blacklist:{token}", ttl, "1")
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Return full user profile. Never returns password_hash."""
    db = get_db()
    try:
        user = await db.users.find_one(
            {"_id": ObjectId(current_user["user_id"])},
            {"password_hash": 0},   # always strip hash from responses
        )
    except Exception:
        user = None

    if not user:
        return {
            "user_id":       current_user["user_id"],
            "email":         current_user["email"],
            "role":          current_user.get("role", "user"),
            "auth_provider": current_user.get("auth_provider", "email"),
        }

    return {
        "user_id":        str(user["_id"]),
        "email":          user.get("email"),
        "name":           user.get("name"),
        "avatar_url":     user.get("avatar_url"),
        "role":           user.get("role", "user"),
        "auth_provider":  user.get("auth_provider", "email"),
        "email_verified": user.get("email_verified", False),
        "created_at":     user.get("created_at"),
        "last_login_at":  user.get("last_login_at"),
    }
