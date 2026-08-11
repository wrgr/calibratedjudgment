"""Admin & instructor research surface: user management, grading-reliability
dashboard."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core import security
from ..db import database as db

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── User management (admin) ───────────────────────────────────────────────────

@router.get("/users")
def list_users(user: dict = Depends(security.require_admin)):
    return [
        {"username": u["username"], "role": u["role"], "displayName": u["display_name"],
         "createdAt": u["created_at"]}
        for u in db.all_users()
    ]


class CreateUser(BaseModel):
    username: str
    password: str
    role: str
    displayName: str


@router.post("/users")
def create_user(body: CreateUser, user: dict = Depends(security.require_admin)):
    username = security.sanitize_str(body.username, 64)
    if not username or not body.password:
        raise HTTPException(status_code=422, detail="Username and password are required.")
    ok, err = db.create_user(username, body.password, body.role,
                             security.sanitize_str(body.displayName, 128) or username)
    if not ok:
        raise HTTPException(status_code=422, detail=err)
    return {"ok": True}


class UpdateUser(BaseModel):
    username: str | None = None
    role: str | None = None
    displayName: str | None = None
    password: str | None = None


@router.put("/users/{username}")
def update_user(username: str, body: UpdateUser,
                user: dict = Depends(security.require_admin)):
    existing = db.get_user(username)
    if not existing:
        raise HTTPException(status_code=404, detail="User not found.")
    ok, err = db.update_user(
        username,
        security.sanitize_str(body.username, 64) or username,
        security.sanitize_str(body.displayName, 128) or existing["display_name"],
        body.role or existing["role"],
    )
    if not ok:
        raise HTTPException(status_code=422, detail=err)
    if body.password:
        db.set_password(security.sanitize_str(body.username, 64) or username, body.password)
    return {"ok": True}


# ── Grading reliability dashboard (staff) ─────────────────────────────────────

@router.get("/reliability")
def reliability(user: dict = Depends(security.require_staff)):
    """LLM-vs-instructor calibration for essay/trace grading: how often
    routed-for-judgment criteria get overridden, and by how much the teacher's
    score differs from the LLM's median once they do."""
    return db.mode_a_reliability_stats()
