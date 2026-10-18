"""Password hashing and session tokens for member login."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 120_000)
    return f'{salt}${digest.hex()}'


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split('$', 1)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 120_000).hex()
    return secrets.compare_digest(check, digest)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def session_expiry(days: int = 30) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)
