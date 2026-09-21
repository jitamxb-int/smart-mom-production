import logging
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.core.config import settings
from app.db.redis_client import get_redis

logger = logging.getLogger(__name__)

oauth2_scheme = HTTPBearer()


def create_token(user: dict) -> str:
    """
    Create a signed JWT for a user document.
    Works for both Google-authenticated and email/password users.
    google_id is optional — email users have None.
    """
    payload = {
        "user_id":       str(user["_id"]),
        "email":         user["email"],
        "role":          user.get("role", "user"),
        "auth_provider": user.get("auth_provider", "email"),
        # google_id only present for Google users
        "google_id":     user.get("google_id"),
        "iat":           datetime.now(timezone.utc),
        "exp":           datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(oauth2_scheme),
) -> dict:
    """Decode and validate JWT. Returns the full payload dict."""
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "UNAUTHORIZED", "message": "Invalid or expired token"},
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise credentials_exception

    # Redis blacklist check
    redis = get_redis()
    if redis and await redis.get(f"blacklist:{token}"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token has been revoked"},
        )

    if not payload.get("user_id"):
        raise credentials_exception

    return payload


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency that enforces admin role."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Admin access required"},
        )
    return current_user


def get_token_remaining_ttl(token: str) -> int:
    """Return remaining seconds before the token expires (0 if already expired)."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        exp = payload.get("exp")
        if exp:
            return max(int(exp - datetime.now(timezone.utc).timestamp()), 0)
    except JWTError:
        pass
    return 0
