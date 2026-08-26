import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional
import jwt
from passlib.context import CryptContext
from src.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = settings.secret_key if hasattr(settings, "secret_key") else "supersecretkey"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    # jti ensures uniqueness even when two tokens for the same user are issued
    # within the same second (same sub + exp would otherwise be byte-identical).
    to_encode.update({"exp": expire, "type": "access", "jti": uuid.uuid4().hex})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def generate_refresh_token() -> str:
    """Generate an opaque, high-entropy refresh token.

    Unlike the access token, this is NOT a JWT: its validity is always
    checked against the `refresh_tokens` table (to support revocation), so
    there is nothing to gain from it being self-describing/signed — a
    random string is the standard approach for refresh tokens. 48 bytes of
    randomness (~384 bits, base64url-encoded) is far beyond brute-force
    range.
    """
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Hash an opaque token for storage. A fast hash (SHA-256) is
    appropriate here — unlike a password, this value is already
    high-entropy and random, so there's no brute-force risk to defend
    against with a slow/salted hash; the only goal is that a leaked DB
    doesn't hand out directly-usable tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()