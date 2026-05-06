# ── auth.py ───────────────────────────────────────────────
# JWT creation / verification and password hashing
# ─────────────────────────────────────────────────────────

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Cookie

SECRET_KEY   = os.getenv("JWT_SECRET", "change-this-secret-in-production")
ALGORITHM    = "HS256"
EXPIRE_DAYS  = 7
COOKIE_NAME  = "ct_session"

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


def create_token(user_id: str) -> str:
    expire  = datetime.now(timezone.utc) + timedelta(days=EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def get_user_id_from_cookie(ct_session: Optional[str] = Cookie(None)) -> Optional[str]:
    """FastAPI dependency — returns user_id or None (never raises)."""
    if not ct_session:
        return None
    return decode_token(ct_session)
