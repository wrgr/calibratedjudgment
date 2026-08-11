"""Research export v3 + override corpus.

One row per graded essay+trace assessment, aggregated from score_records,
documented in docs/research_export_data_dictionary.md. EXPORT_FIELDS below is
the single source of truth for the column order — the doc and this list must
move together (tests enforce both).
"""

import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from ..core import security
from ..db import database as db
from ..services.grading import divergence as div

router = APIRouter(prefix="/api/export", tags=["export"])

EXPORT_FIELDS = [
    "username",
    "display_name",
    "role",
    "assessment_id",
    "mode",
    "task_title",
    "report_type",
    "timestamp",
    "export_schema_version",
    "word_count",
    "trace_score_median",
    "product_score_median",
    "mean_divergence",
    "layer_b_label",
    "layer_b_verification_rate",
    "override_count",
    "needs_review_count",
]


def build_export_rows() -> list[dict]:
    rows = []

    # One row per graded essay_trace assessment, aggregated from score_records
    for a in db.list_assessments(mode="essay_trace"):
        records = db.get_score_records(a["id"])
        if not records:
            continue
        user = db.get_user(a["username"]) or {}
        layer_b = db.get_layer_b(a["id"]) or {}
        rubric_item = db.get_content("rubric", a["content_id"], a["content_version"]) \
            or db.get_content("rubric", a["content_id"])

        def channel_median(channel):
            vals = [div.effective_score(r) for r in records if r["channel"] == channel]
            vals = [v for v in vals if v is not None]
            return round(div.median(vals), 2) if vals else ""

        mean_divergence = ""
        if rubric_item:
            dims = div.compute_divergence(rubric_item["payload"], records)
            with_both = [d["divergence"] for d in dims if d["divergence"] is not None]
            if with_both:
                mean_divergence = round(sum(with_both) / len(with_both), 2)

        row = {f: "" for f in EXPORT_FIELDS}
        row.update({
            "username": a["username"],
            "display_name": user.get("display_name", a["username"]),
            "role": user.get("role", ""),
            "assessment_id": a["id"],
            "mode": "essay_trace",
            "task_title": a["name"],
            "report_type": "essay_trace",
            "timestamp": a["completed_at"] or a["created_at"],
            "export_schema_version": db.EXPORT_SCHEMA_VERSION,
            "word_count": str(len((a["artifacts"].get("essay") or "").split())),
            "trace_score_median": str(channel_median("trace")),
            "product_score_median": str(channel_median("product")),
            "mean_divergence": str(mean_divergence),
            "layer_b_label": layer_b.get("interpretiveLabel", ""),
            "layer_b_verification_rate": (
                str(round(layer_b["verificationRate"], 3))
                if isinstance(layer_b.get("verificationRate"), (int, float)) else ""),
            "override_count": str(sum(1 for r in records if r["override_ts"])),
            "needs_review_count": str(sum(1 for r in records if r["needs_review"])),
        })
        rows.append(row)

    rows.sort(key=lambda r: (r["username"], r["timestamp"], r["task_title"]))
    return rows


@router.get("/research.json")
def research_json(user: dict = Depends(security.require_staff)):
    return {"export_schema_version": db.EXPORT_SCHEMA_VERSION,
            "fields": EXPORT_FIELDS,
            "rows": build_export_rows()}


@router.get("/research.csv", response_class=PlainTextResponse)
def research_csv(user: dict = Depends(security.require_staff)):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_FIELDS)
    writer.writeheader()
    for row in build_export_rows():
        writer.writerow(row)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=research_export_v3.csv"})


@router.get("/override-corpus")
def override_corpus(user: dict = Depends(security.require_staff)):
    """Every instructor override as a labeled calibration data point (the TGFWA
    override-corpus export, now cross-user and durable)."""
    records = db.override_corpus()
    overrides = [
        {
            "assessmentId": r["assessment_id"],
            "criterionId": r["criterion_id"],
            "channel": r["channel"],
            "llmPasses": r["passes"],
            "llmMedian": r["median"],
            "llmSpread": r["spread"],
            "llmConfidence": r["confidence"],
            "llmEvidence": r["evidence"],
            "rubricVersion": r["rubric_version"],
            "teacherScore": r["override_score"],
            "teacherRationale": r["override_rationale"],
            "overriddenAt": r["override_ts"],
            "student": r["username"],
        }
        for r in records
    ]
    return {"exportedAt": db.utcnow(), "n": len(overrides), "overrides": overrides}
