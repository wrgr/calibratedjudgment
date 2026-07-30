"""Content routes: rubrics (versioned) + provider info."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import config
from ..core import llm, security
from ..db import database as db
from ..services import llm_bridge
from ..services.grading import calibration

router = APIRouter(prefix="/api", tags=["content"])

_KIND_BY_PATH = {"rubrics": "rubric"}


def bump_version(version: str) -> str:
    """TGFWA rubric-versioning semantics: '1.0' -> '1.0-t1' -> '1.0-t2' ...
    (every instructor edit bumps, so every score can name the exact version
    that produced it)."""
    m = re.match(r"^(.*)-t(\d+)$", version)
    return f"{m.group(1)}-t{int(m.group(2)) + 1}" if m else f"{version}-t1"


def _kind(path_kind: str) -> str:
    kind = _KIND_BY_PATH.get(path_kind)
    if not kind:
        raise HTTPException(status_code=404, detail="Unknown content kind.")
    return kind


@router.get("/content/{path_kind}")
def list_items(path_kind: str, user: dict = Depends(security.require_user)):
    kind = _kind(path_kind)
    return list_content_public(kind)


def list_content_public(kind: str):
    items = db.list_content(kind)
    return [
        {
            "contentId": it["content_id"],
            "version": it["version"],
            "createdBy": it["created_by"],
            "createdAt": it["created_at"],
            "payload": it["payload"],
        }
        for it in items
    ]


@router.get("/content/{path_kind}/{content_id}")
def get_item(path_kind: str, content_id: str, version: str = None,
             user: dict = Depends(security.require_user)):
    kind = _kind(path_kind)
    item = db.get_content(kind, content_id, version)
    if not item:
        raise HTTPException(status_code=404, detail="Content not found.")
    return {
        "contentId": item["content_id"],
        "version": item["version"],
        "createdBy": item["created_by"],
        "createdAt": item["created_at"],
        "payload": item["payload"],
    }


class SavePayload(BaseModel):
    payload: dict


@router.put("/content/{path_kind}/{content_id}")
def save_item(path_kind: str, content_id: str, body: SavePayload,
              user: dict = Depends(security.require_staff)):
    """Save an edited content item as a NEW bumped version (never in place)."""
    kind = _kind(path_kind)
    current = db.get_content(kind, content_id)
    payload = body.payload

    if current:
        new_version = bump_version(current["version"])
        db.set_content_active(kind, content_id, current["version"], False)
    else:
        new_version = payload.get("version") or "1.0"
    payload["version"] = new_version

    db.upsert_content(kind, content_id, new_version, payload,
                      created_by=user["username"])
    return {"contentId": content_id, "version": new_version, "payload": payload}


# ── Calibration drafts (idea #2: LLM-drafted teacherGuidance, staged only) ─────

def _version_out(it: dict) -> dict:
    return {
        "contentId": it["content_id"],
        "version": it["version"],
        "createdBy": it["created_by"],
        "createdAt": it["created_at"],
        "active": it["active"],
        "dismissed": it["dismissed"],
        "payload": it.get("payload"),
    }


@router.get("/content/{path_kind}/{content_id}/drafts")
def list_drafts(path_kind: str, content_id: str,
                user: dict = Depends(security.require_staff)):
    kind = _kind(path_kind)
    return [_version_out(d) for d in db.list_pending_drafts(kind, content_id)]


@router.post("/content/{path_kind}/{content_id}/criteria/{criterion_id}/draft-guidance")
def draft_guidance(path_kind: str, content_id: str, criterion_id: str,
                   user: dict = Depends(security.require_staff),
                   override: dict | None = Depends(llm_bridge.llm_override)):
    """Draft a proposed teacherGuidance replacement for one criterion from its
    override history. Stages the result as an INACTIVE rubric version — it
    never affects grading until explicitly published."""
    kind = _kind(path_kind)
    current = db.get_content(kind, content_id)
    if not current:
        raise HTTPException(status_code=404, detail="Content not found.")
    rubric = current["payload"]
    criterion = next((c for c in rubric.get("criteria", [])
                      if c["criterionId"] == criterion_id), None)
    if not criterion:
        raise HTTPException(status_code=404, detail="Criterion not found.")

    override_rows = db.overrides_for_criterion(criterion_id)
    if len(override_rows) < db.CALIBRATION_MIN_OVERRIDES:
        raise HTTPException(
            status_code=422,
            detail=f"Need at least {db.CALIBRATION_MIN_OVERRIDES} overrides on this "
                   f"criterion to draft guidance (have {len(override_rows)}).")

    try:
        llm_json = llm_bridge.make_llm_json(user, override)
    except llm_bridge.UnknownProvider as e:
        raise HTTPException(status_code=422, detail=str(e))
    except llm_bridge.LLMNotConfigured as e:
        raise HTTPException(status_code=409, detail=str(e))

    current_guidance = criterion.get("teacherGuidance") or ""
    draft = calibration.draft_guidance(llm_json, criterion, current_guidance, override_rows)
    if not draft or not calibration.validate_guidance_draft(draft):
        raise HTTPException(status_code=422,
                            detail="Could not generate a valid guidance draft for this criterion.")

    payload = {**rubric, "criteria": [
        {**c, "teacherGuidance": draft} if c["criterionId"] == criterion_id else c
        for c in rubric.get("criteria", [])
    ]}
    new_version = bump_version(current["version"])
    payload["version"] = new_version
    db.upsert_content(kind, content_id, new_version, payload,
                      created_by=user["username"], active=False)
    return {"contentId": content_id, "version": new_version, "payload": payload}


@router.post("/content/{path_kind}/{content_id}/versions/{version}/publish")
def publish_version(path_kind: str, content_id: str, version: str,
                    user: dict = Depends(security.require_staff)):
    """Approve a staged draft: activate it, and deactivate whatever was
    previously active, so exactly one version is ever active at a time."""
    kind = _kind(path_kind)
    target = db.get_content(kind, content_id, version)
    if not target:
        raise HTTPException(status_code=404, detail="Version not found.")
    current = db.get_content(kind, content_id)
    if current and current["version"] != version:
        db.set_content_active(kind, content_id, current["version"], False)
    db.set_content_active(kind, content_id, version, True)
    return {"contentId": content_id, "version": version, "active": True}


@router.post("/content/{path_kind}/{content_id}/versions/{version}/dismiss")
def dismiss_version(path_kind: str, content_id: str, version: str,
                    user: dict = Depends(security.require_staff)):
    kind = _kind(path_kind)
    if not db.get_content(kind, content_id, version):
        raise HTTPException(status_code=404, detail="Version not found.")
    db.dismiss_content_draft(kind, content_id, version)
    return {"contentId": content_id, "version": version, "dismissed": True}


# ── Provider / model info ─────────────────────────────────────────────────────

@router.get("/providers")
def providers(user: dict = Depends(security.require_user)):
    """All known providers with model lists and a `configured` flag (a server
    key is present). Unconfigured providers are listed too so a user can pick
    one with their own browser-supplied key. Never returns key material."""
    out = []
    for name, cfg in config.PROVIDERS.items():
        configured = llm.llm_is_available(cfg["api_key"])
        models = llm.get_available_models(name, cfg)
        if name == "Ollama" and not models:
            continue  # Ollama not running — hide it
        out.append({"name": name, "defaultModel": cfg["model"], "models": models,
                    "configured": configured})
    return {"providers": out, "default": config.DEFAULT_PROVIDER}


class ValidateKeyRequest(BaseModel):
    apiKey: str
    model: str | None = None


@router.post("/providers/{name}/validate-key")
def validate_key(name: str, body: ValidateKeyRequest,
                 user: dict = Depends(security.require_user)):
    """Liveness-check a browser-supplied key against a provider (Settings "Test
    key"). The key is used for one minimal call and discarded — never stored,
    never logged, never echoed back."""
    cfg = config.provider_config(name)
    if not cfg:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    api_key = body.apiKey.strip()
    if not api_key:
        raise HTTPException(status_code=422, detail="An API key is required.")
    ok, err = llm.validate_api_key(name, api_key, body.model or cfg["model"],
                                   cfg["base_url"])
    return {"ok": ok, "error": err}


@router.get("/providers/{name}/status")
def provider_status(name: str, user: dict = Depends(security.require_staff)):
    cfg = config.provider_config(name)
    if not cfg:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    if not llm.llm_is_available(cfg["api_key"]):
        return {"configured": False, "ok": False, "error": "No API key configured."}
    ok, err = llm.validate_api_key(name, cfg["api_key"], cfg["model"], cfg["base_url"])
    return {"configured": True, "ok": ok, "error": err}
