"""Assessment (session) routes: CRUD, scores, divergence, overrides, review queue."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core import security
from ..db import database as db
from ..services.grading import divergence as div

router = APIRouter(prefix="/api", tags=["sessions"])


def _can_view(user: dict, assessment: dict) -> bool:
    return user["role"] in ("admin", "instructor") or assessment["username"] == user["username"]


def _get_owned(assessment_id: str, user: dict) -> dict:
    a = db.get_assessment(assessment_id)
    if not a or not _can_view(user, a):
        # 404 for both cases so students can't probe other students' ids
        raise HTTPException(status_code=404, detail="Assessment not found.")
    return a


def _score_record_out(rec: dict) -> dict:
    return {
        "criterionId": rec["criterion_id"],
        "channel": rec["channel"],
        "passes": rec["passes"],
        "median": rec["median"],
        "spread": rec["spread"],
        "noEvidence": rec["no_evidence"],
        "confidence": rec["confidence"],
        "evidence": rec["evidence"],
        "anchorMatched": rec["anchor_matched"] or None,
        "styleApplied": rec.get("style_applied") or None,
        "rubricVersion": rec["rubric_version"],
        "gradedAt": rec["graded_at"],
        "needsReview": rec["needs_review"],
        "reviewReasons": rec["review_reasons"],
        "teacherOverride": (
            {"score": rec["override_score"], "rationale": rec["override_rationale"],
             "ts": rec["override_ts"]}
            if rec["override_ts"] else None
        ),
        "assessmentId": rec.get("assessment_id"),
        "assessmentName": rec.get("assessment_name"),
        "username": rec.get("username"),
    }


def _assessment_out(a: dict, include_detail: bool = False) -> dict:
    out = {
        "id": a["id"],
        "username": a["username"],
        "mode": a["mode"],
        "status": a["status"],
        "name": a["name"],
        "description": a["description"],
        "contentId": a["content_id"],
        "contentVersion": a["content_version"],
        "isExemplar": a["is_exemplar"],
        "gradedLive": a["graded_live"],
        "createdAt": a["created_at"],
        "completedAt": a["completed_at"],
    }
    if include_detail:
        out["artifacts"] = a["artifacts"]
    return out


@router.get("/assessments")
def list_assessments(mode: str = None, user: dict = Depends(security.require_user)):
    if user["role"] in ("admin", "instructor"):
        items = db.list_assessments(mode=mode)
    else:
        items = db.list_assessments(username=user["username"], mode=mode)
    return [_assessment_out(a) for a in items]


class CreateAssessment(BaseModel):
    mode: str
    name: str = ""
    description: str = ""
    contentId: str = ""
    artifacts: dict = {}


@router.post("/assessments")
def create_assessment(body: CreateAssessment, user: dict = Depends(security.require_user)):
    if body.mode not in db.VALID_MODES:
        raise HTTPException(status_code=422, detail="Invalid mode.")
    content_version = ""
    if body.contentId:
        item = db.get_content("rubric", body.contentId)
        if not item:
            raise HTTPException(status_code=404, detail="Content not found.")
        content_version = item["version"]
    aid = db.create_assessment(
        username=user["username"], mode=body.mode, name=body.name,
        description=body.description, content_id=body.contentId,
        content_version=content_version, artifacts=body.artifacts,
    )
    return _assessment_out(db.get_assessment(aid))


@router.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: str, user: dict = Depends(security.require_user)):
    a = _get_owned(assessment_id, user)
    out = _assessment_out(a, include_detail=True)

    records = db.get_score_records(assessment_id)
    layer_b = db.get_layer_b(assessment_id)
    out["scores"] = [_score_record_out(r) for r in records]
    out["layerB"] = layer_b
    rubric_item = db.get_content("rubric", a["content_id"], a["content_version"]) \
        or db.get_content("rubric", a["content_id"])
    if rubric_item and records:
        dims = div.compute_divergence(rubric_item["payload"], records)
        out["divergence"] = dims
        out["interpretation"] = div.interpret_divergence(dims, layer_b)
    return out


@router.delete("/assessments/{assessment_id}")
def delete_assessment(assessment_id: str, user: dict = Depends(security.require_user)):
    _get_owned(assessment_id, user)
    db.delete_assessment(assessment_id)
    return {"ok": True}


class OverrideRequest(BaseModel):
    criterionId: str
    channel: str
    score: float
    rationale: str


@router.post("/assessments/{assessment_id}/override")
def set_override(assessment_id: str, body: OverrideRequest,
                 user: dict = Depends(security.require_staff)):
    """Instructor override — the labeled calibration data point (teacher is
    authoritative; every override lands in the override corpus)."""
    if body.channel not in ("trace", "product"):
        raise HTTPException(status_code=422, detail="Invalid channel.")
    if not (0 <= body.score <= 5):
        raise HTTPException(status_code=422, detail="Score must be 0-5.")
    if not body.rationale.strip():
        raise HTTPException(status_code=422, detail="A rationale is required — overrides are calibration data.")
    if not db.get_assessment(assessment_id):
        raise HTTPException(status_code=404, detail="Assessment not found.")
    ok = db.set_score_override(assessment_id, body.criterionId, body.channel,
                               body.score, body.rationale.strip())
    if not ok:
        raise HTTPException(status_code=404, detail="Score record not found.")
    return {"ok": True}


class ClearOverrideRequest(BaseModel):
    criterionId: str
    channel: str


@router.post("/assessments/{assessment_id}/override/clear")
def clear_override(assessment_id: str, body: ClearOverrideRequest,
                   user: dict = Depends(security.require_staff)):
    if not db.get_assessment(assessment_id):
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if not db.clear_score_override(assessment_id, body.criterionId, body.channel):
        raise HTTPException(status_code=404, detail="Score record not found.")
    return {"ok": True}


@router.get("/review-queue")
def review_queue(user: dict = Depends(security.require_staff)):
    """All score records routed to instructor judgment, across every assessment."""
    return [_score_record_out(r) for r in db.review_queue()]
