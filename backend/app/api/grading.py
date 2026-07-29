"""Mode A grading routes: start a grading job, stream/poll its progress."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..core import security
from ..db import database as db
from ..services import jobs, llm_bridge
from ..services.grading import engine, layerb, molding

router = APIRouter(prefix="/api", tags=["grading"])


@router.post("/assessments/{assessment_id}/grade")
def grade(assessment_id: str, user: dict = Depends(security.require_user),
          override: dict | None = Depends(llm_bridge.llm_override)):
    a = db.get_assessment(assessment_id)
    if not a or (user["role"] not in ("admin", "instructor")
                 and a["username"] != user["username"]):
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if a["mode"] != "essay_trace":
        raise HTTPException(status_code=422, detail="Only essay+trace assessments use this endpoint.")

    rubric_item = db.get_content("rubric", a["content_id"]) if a["content_id"] else None
    if not rubric_item:
        raise HTTPException(status_code=422, detail="Assessment has no rubric attached.")
    rubric = rubric_item["payload"]

    essay = a["artifacts"].get("essay", "")
    trace = a["artifacts"].get("trace", {})
    if not essay or not trace.get("turns"):
        raise HTTPException(status_code=422, detail="Assessment needs both an essay and a trace.")

    try:
        llm_json = llm_bridge.make_llm_json(user, override)
    except llm_bridge.UnknownProvider as e:
        raise HTTPException(status_code=422, detail=str(e))
    except llm_bridge.LLMNotConfigured as e:
        raise HTTPException(status_code=409, detail=str(e))

    n_grading = len(rubric.get("criteria", [])) * 2
    segments = layerb.segment_trace(trace)
    total = n_grading + len(segments)
    grading_style = user.get("grading_style", "")
    style_intensity = user.get("style_intensity") or molding.DEFAULT_INTENSITY

    # Re-grade replaces prior records; the run stamps the current rubric version.
    db.delete_score_records(assessment_id)
    db.update_assessment(assessment_id, status="grading",
                         content_version=rubric_item["version"])

    def work(report):
        try:
            style_notes = molding.get_or_mold_notes(
                llm_json, content_id=a["content_id"], version=rubric_item["version"],
                rubric=rubric, grading_style=grading_style, intensity=style_intensity)

            def on_result(rec):
                db.upsert_score_record(assessment_id, rec)

            engine.grade_session(
                llm_json=llm_json, rubric=rubric, essay=essay, trace=trace,
                grading_style=grading_style, style_notes=style_notes,
                on_progress=lambda done, _t, label: report(done, total, label),
                on_result=on_result,
            )

            def on_seg_progress(done, seg_total):
                report(n_grading + done, total, f"reliance segment {done}/{seg_total}")

            layer_b = layerb.code_layer_b(llm_json, trace, on_progress=on_seg_progress)
            db.upsert_layer_b(assessment_id, layer_b)
            db.update_assessment(assessment_id, status="graded", graded_live=True,
                                 completed_at=db.utcnow())
        except Exception:
            db.update_assessment(assessment_id, status="error")
            raise

    job_id = jobs.start_job(assessment_id, "grade_essay_trace", total, work)
    return {"jobId": job_id, "total": total}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user: dict = Depends(security.require_user)):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("/jobs/{job_id}/events")
def job_events(job_id: str, user: dict = Depends(security.require_user)):
    return StreamingResponse(jobs.sse_events(job_id), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})
