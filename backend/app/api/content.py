"""Content routes: rubrics (versioned) + provider info."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import config
from ..core import llm, security
from ..db import database as db

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


@router.get("/content/{path_kind}/{content_id}/versions")
def item_versions(path_kind: str, content_id: str,
                  user: dict = Depends(security.require_staff)):
    return db.list_content_versions(_kind(path_kind), content_id)


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
    else:
        new_version = payload.get("version") or "1.0"
    payload["version"] = new_version

    db.upsert_content(kind, content_id, new_version, payload,
                      created_by=user["username"])
    return {"contentId": content_id, "version": new_version, "payload": payload}


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
