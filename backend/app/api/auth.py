"""Auth routes: login/logout/me + per-user preferences."""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ..core import security
from ..db import database as db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class PrefsRequest(BaseModel):
    theme: str | None = None
    preferred_provider: str | None = None
    preferred_model: str | None = None
    grading_style: str | None = None


def _public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "role": user["role"],
        "displayName": user["display_name"],
        "theme": user["theme"],
        "preferredProvider": user["preferred_provider"],
        "preferredModel": user["preferred_model"],
        "gradingStyle": user["grading_style"],
    }


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    username = security.sanitize_str(body.username)
    password = security.sanitize_str(body.password, max_len=256)

    if security.is_admin_locked(ip):
        raise HTTPException(status_code=423, detail="Locked out. Try again later.")
    if not security.check_limit(ip):
        raise HTTPException(status_code=429, detail="Too many attempts. Slow down.")

    user = security.authenticate(username, password)
    if not user:
        target = db.get_user(username)
        locked = security.record_failed(ip, bool(target and target["role"] == "admin"))
        if locked:
            raise HTTPException(status_code=423, detail="Locked out. Try again later.")
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    security.record_success(ip, user["role"] == "admin")
    token = security.create_session(user["username"])
    response.set_cookie(
        security.COOKIE_NAME, token,
        httponly=True, samesite="lax", max_age=db.SESSION_TTL_DAYS * 86400,
        secure=request.url.scheme == "https", path="/",
    )
    return _public_user(user)


@router.post("/logout")
def logout(response: Response, ap_session: str = Cookie(default=None)):
    if ap_session:
        security.destroy_session(ap_session)
    response.delete_cookie(security.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(security.require_user)):
    return _public_user(user)


@router.put("/prefs")
def update_prefs(body: PrefsRequest, user: dict = Depends(security.require_user)):
    if body.theme is not None:
        db.set_theme(user["username"], security.sanitize_str(body.theme, 32))
    if body.preferred_provider is not None or body.preferred_model is not None:
        db.set_model_pref(
            user["username"],
            security.sanitize_str(body.preferred_provider or user["preferred_provider"], 64),
            security.sanitize_str(body.preferred_model or user["preferred_model"], 128),
        )
    if body.grading_style is not None:
        db.set_grading_style(user["username"], security.sanitize_str(body.grading_style, 2000))
    return _public_user(db.get_user(user["username"]))
