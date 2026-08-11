"""
Authentication, rate limiting, and input sanitisation.

Ported from Performative_Assessment_V5 auth.py (assessmentRework branch), with
Flask signed-cookie sessions replaced by DB-backed opaque tokens: the cookie
carries a random token, only its SHA-256 hash is stored, and expiry lives in
the auth_sessions table so logout/restart semantics are explicit.

CSRF model: the SPA is same-origin, cookies are SameSite=Lax + HttpOnly, and
every mutating route additionally requires the custom `X-Requested-With: fetch`
header (browsers refuse to attach custom headers cross-site without CORS
consent), so no per-form token dance is needed.
"""

import hashlib
import secrets
import time

from fastapi import Cookie, Depends, HTTPException, Request
from werkzeug.security import check_password_hash

from ..db import database as db

COOKIE_NAME = "ap_session"

# ── In-memory rate-limit store — keyed by client IP ───────────────────────────
# Login brute-force protection only; fine to reset on restart. IMPORTANT:
# this is per-process memory, not DB-backed. Under a single-process dev
# deployment this is exactly right. Running with `uvicorn --workers N>1` (or
# multiple instances behind a load balancer) gives each process its own
# independent counter, so the effective limit becomes GENERAL_MAX/ADMIN_MAX
# times N, and an attacker spreading requests across workers evades the
# lockout entirely. A DB-backed limiter would be needed before scaling to
# multiple worker processes.
_rate: dict = {}

WINDOW_SECS = 60
GENERAL_MAX = 10
ADMIN_MAX = 3
ADMIN_LOCKOUT_SECS = 900


def sanitize_str(value, max_len=128):
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "").strip()[:max_len]


def _ip_state(ip):
    if ip not in _rate:
        _rate[ip] = {
            "count": 0,
            "window_start": time.monotonic(),
            "admin_attempts": 0,
            "admin_locked_until": 0.0,
        }
    return _rate[ip]


def is_admin_locked(ip):
    return time.monotonic() < _ip_state(ip)["admin_locked_until"]


def check_limit(ip):
    now = time.monotonic()
    s = _ip_state(ip)
    if now - s["window_start"] > WINDOW_SECS:
        s["count"] = 0
        s["window_start"] = now
    return s["count"] < GENERAL_MAX


def record_failed(ip, is_admin_attempt):
    now = time.monotonic()
    s = _ip_state(ip)
    if now - s["window_start"] > WINDOW_SECS:
        s["count"] = 0
        s["window_start"] = now
    s["count"] += 1
    if is_admin_attempt:
        s["admin_attempts"] += 1
        if s["admin_attempts"] >= ADMIN_MAX:
            s["admin_locked_until"] = now + ADMIN_LOCKOUT_SECS
            return True
    return False


def record_success(ip, is_admin):
    s = _ip_state(ip)
    s["count"] = 0
    if is_admin:
        s["admin_attempts"] = 0


# ── Credentials & sessions ─────────────────────────────────────────────────────

def authenticate(username, password):
    user = db.get_user(username)
    if not user:
        return None
    if not check_password_hash(user["password_hash"], password):
        return None
    return user


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    db.create_auth_session(_hash_token(token), username)
    return token


def destroy_session(token: str):
    db.delete_auth_session(_hash_token(token))


def session_user(token: str):
    sess = db.get_auth_session(_hash_token(token))
    if not sess:
        return None
    return db.get_user(sess["username"])


# ── FastAPI dependencies ───────────────────────────────────────────────────────

def require_user(request: Request, ap_session: str = Cookie(default=None)):
    if not ap_session:
        raise HTTPException(status_code=401, detail="Not signed in.")
    user = session_user(ap_session)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired.")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-requested-with") != "fetch":
            raise HTTPException(status_code=403, detail="Missing request header.")
    return user


def require_role(*roles):
    def _dep(user: dict = Depends(require_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions.")
        return user
    return _dep


require_staff = require_role("admin", "instructor")
require_admin = require_role("admin")
