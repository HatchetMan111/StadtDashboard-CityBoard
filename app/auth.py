from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import config
from .database import get_db
from .models import AdminUser, Display

SESSION_COOKIE = "sb_session"
SESSION_TTL_SECONDS = 12 * 3600


# ── Passwort-Hashing (scrypt, stdlib) ───────────────────────────────────────
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, digest_hex = stored.split("$", 2)
        if algo != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# ── Session-Cookie (HMAC-signiert) ──────────────────────────────────────────
def _sign(data: str | bytes) -> str:
    key = config.get_secret_key()
    if isinstance(data, str):
        data = data.encode()
    return hmac.new(key, data, hashlib.sha256).hexdigest()


def create_session(username: str) -> str:
    payload = json.dumps(
        {"u": username, "exp": time.time() + SESSION_TTL_SECONDS}, separators=(",", ":")
    ).encode()
    b64 = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return f"{b64}.{_sign(b64)}"


def read_session(token: str) -> str | None:
    try:
        b64, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, _sign(b64)):
            return None
        pad = "=" * (-len(b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(b64 + pad))
        if data.get("exp", 0) < time.time():
            return None
        return str(data.get("u"))
    except (ValueError, KeyError, TypeError):
        return None


def require_admin(request: Request, db: Session = Depends(get_db)) -> AdminUser:
    token = request.cookies.get(SESSION_COOKIE, "")
    username = read_session(token) if token else None
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    user = db.query(AdminUser).filter_by(username=username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    return user


def optional_admin(request: Request, db: Session = Depends(get_db)) -> AdminUser | None:
    try:
        return require_admin(request, db)
    except HTTPException:
        return None


# ── Display-Token-Auth ──────────────────────────────────────────────────────
def get_display_by_token(db: Session, authorization: str | None) -> Display:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Display-Token fehlt")
    token = authorization.split(" ", 1)[1].strip()
    display = db.query(Display).filter_by(token=token).first()
    if not display:
        raise HTTPException(status_code=401, detail="Unbekanntes Display-Token")
    return display


def require_approved_display(display: Display) -> Display:
    if not display.approved:
        raise HTTPException(status_code=403, detail="Display noch nicht gekoppelt")
    if not display.enabled:
        raise HTTPException(status_code=403, detail="Display ist gesperrt")
    return display
