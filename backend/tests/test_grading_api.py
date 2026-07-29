"""End-to-end Mode A API: exemplars seeded, grading job with a FakeLLM,
override flow, review queue, access control."""

import json
import time

import pytest

from app.db import database as db
from app.services import llm_bridge
from app.services.grading import prompts


def test_exemplars_seeded_and_visible(admin_client):
    items = admin_client.get("/api/assessments", params={"mode": "essay_trace"}).json()
    ids = {a["id"] for a in items}
    assert {"exemplar-maya", "exemplar-jordan", "exemplar-sam", "exemplar-alex"} <= ids


def test_student_sees_only_own(student_client):
    items = student_client.get("/api/assessments").json()
    assert items, "emma owns exemplar-maya"
    assert all(a["username"] == "emma" for a in items)
    # cannot fetch another student's assessment
    assert student_client.get("/api/assessments/exemplar-jordan").status_code == 404


def test_assessment_detail_has_scores_divergence_layerb(admin_client):
    a = admin_client.get("/api/assessments/exemplar-maya").json()
    assert len(a["scores"]) == 24  # 12 criteria × 2 channels
    assert a["layerB"]["interpretiveLabel"]
    assert a["divergence"]
    assert a["interpretation"]["headline"]
    # parrot flags over-reliance... actually alex is the guard test; jordan is the flag
    jordan = admin_client.get("/api/assessments/exemplar-jordan").json()
    assert jordan["interpretation"]["tone"] == "flag"


def test_override_flow_and_review_queue(admin_client):
    queue_before = admin_client.get("/api/review-queue").json()
    assert queue_before, "weak-referenceability criteria must be routed"
    item = next(r for r in queue_before if r["teacherOverride"] is None)
    r = admin_client.post(
        f"/api/assessments/{item['assessmentId']}/override",
        json={"criterionId": item["criterionId"], "channel": item["channel"],
              "score": 4, "rationale": "Reviewed the evidence; anchor 4 fits."},
        headers={"X-Requested-With": "fetch"},
    )
    assert r.status_code == 200
    detail = admin_client.get(f"/api/assessments/{item['assessmentId']}").json()
    rec = next(s for s in detail["scores"]
               if s["criterionId"] == item["criterionId"] and s["channel"] == item["channel"])
    assert rec["teacherOverride"]["score"] == 4


def test_override_requires_rationale(admin_client):
    r = admin_client.post(
        "/api/assessments/exemplar-maya/override",
        json={"criterionId": "W1a-1", "channel": "product", "score": 3, "rationale": "  "},
        headers={"X-Requested-With": "fetch"},
    )
    assert r.status_code == 422


def test_students_cannot_override(student_client):
    r = student_client.post(
        "/api/assessments/exemplar-maya/override",
        json={"criterionId": "W1a-1", "channel": "product", "score": 3, "rationale": "x"},
        headers={"X-Requested-With": "fetch"},
    )
    assert r.status_code == 403


class FakeLLM:
    """Deterministic stand-in for llm_bridge.make_llm_json: quotes real source
    text so the provenance guard accepts it. Also answers molding calls
    (attempt 5) with canned notes for the eligible criteria, tracked via a
    separate call counter/prompt list so grading-call assertions stay clean."""

    def __init__(self):
        self.calls = 0
        self.prompts = []
        self.mold_calls = 0
        self.mold_prompts = []
        self.mold_systems = []

    def __call__(self, system, prompt):
        if "grading-style preference apply consistently" in system:
            self.mold_calls += 1
            self.mold_prompts.append(prompt)
            self.mold_systems.append(system)
            return {"notes": [
                {"criterionId": "W1d-1", "note": "Lean into an informal register; do not dock points for colloquial diction."},
                {"criterionId": "W1d-2", "note": "A passionate voice is fine as long as reasoning underlies it."},
                {"criterionId": "L1-1", "note": "Minor grammar slips that don't obscure meaning should not lower the score."},
            ]}
        self.calls += 1
        self.prompts.append(prompt)
        if "RelianceScope" in system:
            return {"helpSeeking": "active", "responseUse": "constructive",
                    "verification": True, "evidence": "checked the claim"}
        # Extract the source between <<< >>> and quote its first sentence-ish chunk.
        src = prompt.split("<<<", 1)[1].split(">>>", 1)[0].strip()
        if "DIALOGUE TRACE" in prompt:
            # find first student turn text
            quote = None
            for block in src.split("\n\n"):
                if "| STUDENT]" in block.splitlines()[0]:
                    quote = " ".join(block.splitlines()[1:])[:120]
                    break
            if not quote:
                return {"evidence": [], "score": "no-evidence", "selfConfidence": "med",
                        "styleApplied": "no evidence to apply style to"}
            return {"evidence": [{"turnId": 0, "quote": quote, "reasoning": "student-authored"}],
                    "anchorMatched": "anchor", "score": 3, "selfConfidence": "med",
                    "styleApplied": "applied the stated style to this trace criterion"}
        quote = src[:100]
        return {"evidence": [{"turnId": None, "quote": quote, "reasoning": "opens the essay"}],
                "anchorMatched": "anchor", "score": 4, "selfConfidence": "high",
                "styleApplied": "applied the stated style to this product criterion"}


def test_grading_job_end_to_end(admin_client, monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: fake)

    r = admin_client.post("/api/assessments/exemplar-maya/grade",
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    job_id = r.json()["jobId"]
    total = r.json()["total"]
    assert total == 24 + 6  # 12 criteria × 2 channels + 6 reliance segments

    deadline = time.time() + 60
    while time.time() < deadline:
        job = admin_client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.2)
    assert job["status"] == "done", job
    assert job["done"] == total

    detail = admin_client.get("/api/assessments/exemplar-maya").json()
    assert detail["status"] == "graded"
    assert detail["gradedLive"] is True
    assert len(detail["scores"]) == 24
    # every product record scored 4 with verbatim evidence accepted by the guard
    product = [s for s in detail["scores"] if s["channel"] == "product"]
    assert all(s["median"] == 4 for s in product)
    assert all(s["evidence"] for s in product)
    assert detail["layerB"]["dominantResponseUse"] == "constructive"


def test_grading_without_provider_is_409(admin_client, monkeypatch):
    def raise_unconfigured(user, override=None):
        raise llm_bridge.LLMNotConfigured("No LLM provider is configured on the server.")
    monkeypatch.setattr(llm_bridge, "make_llm_json", raise_unconfigured)
    r = admin_client.post("/api/assessments/exemplar-sam/grade",
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 409


def test_failed_job_marks_assessment_error_not_stuck_grading(admin_client, monkeypatch):
    def always_fails(system, prompt):
        raise RuntimeError("provider is down")
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: always_fails)
    r = admin_client.post("/api/assessments/exemplar-sam/grade",
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    job_id = r.json()["jobId"]

    deadline = time.time() + 60
    while time.time() < deadline:
        job = admin_client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.2)
    assert job["status"] == "error", job

    detail = admin_client.get("/api/assessments/exemplar-sam").json()
    assert detail["status"] == "error"


def test_sse_stream_replays_completed_job(admin_client, monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: fake)
    r = admin_client.post("/api/assessments/exemplar-alex/grade",
                          headers={"X-Requested-With": "fetch"})
    job_id = r.json()["jobId"]
    deadline = time.time() + 60
    while time.time() < deadline:
        if admin_client.get(f"/api/jobs/{job_id}").json()["status"] != "running":
            break
        time.sleep(0.2)
    with admin_client.stream("GET", f"/api/jobs/{job_id}/events") as resp:
        assert resp.status_code == 200
        events = []
        for line in resp.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
            if events and events[-1]["type"] in ("done", "error"):
                break
    assert events[-1]["type"] == "done"


def test_ineligible_criterion_prompt_unaffected_by_style():
    """W1a-1 (Claims) is not styleEligible. engine.grade_session only ever
    looks up a note for it via style_notes.get(cid, "") — which is "" whether
    an instructor has any grading_style at all, or a style is set but this
    criterion just isn't in the eligible set. Both situations hand
    build_product_prompt the same empty style_note, so the resulting prompts
    must be byte-identical."""
    rubric = db.get_content("rubric", "mccr-w11-12-arg")["payload"]
    criterion = next(c for c in rubric["criteria"] if c["criterionId"] == "W1a-1")
    essay = "An essay about civic duty."

    style_notes_when_style_set = {"W1d-1": "a note", "W1d-2": "a note", "L1-1": "a note"}
    note_with_style_set = style_notes_when_style_set.get("W1a-1", "")
    note_with_no_style = {}.get("W1a-1", "")

    prompt_a = prompts.build_product_prompt(criterion, essay, rubric, note_with_style_set)
    prompt_b = prompts.build_product_prompt(criterion, essay, rubric, note_with_no_style)
    assert prompt_a == prompt_b


def test_eligible_criterion_prompt_gets_scoped_note_not_raw_style_text(admin_client, monkeypatch):
    style_text = "Value authenticity and voice over rigid formal structure; be lenient on grammar."
    r = admin_client.put("/api/auth/prefs", json={"grading_style": style_text},
                         headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    assert r.json()["gradingStyle"] == style_text

    fake = FakeLLM()
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: fake)
    r = admin_client.post("/api/assessments/exemplar-jordan/grade",
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    job_id = r.json()["jobId"]

    deadline = time.time() + 60
    while time.time() < deadline:
        job = admin_client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.2)
    assert job["status"] == "done", job

    # The raw instructor paragraph never reaches a scoring prompt directly anymore.
    assert not any(style_text in p for p in fake.prompts)

    label = "TEACHER'S STYLE NOTE FOR THIS CRITERION"
    eligible_ids = {"W1d-1", "W1d-2", "L1-1"}
    saw_label = False
    for p in fake.prompts:
        if label not in p:
            continue
        saw_label = True
        criterion_id = p.split("CRITERION ", 1)[1].split(" ", 1)[0]
        assert criterion_id in eligible_ids
    assert saw_label, "expected at least one eligible criterion's prompt to carry the note"

    detail = admin_client.get("/api/assessments/exemplar-jordan").json()
    w1a1 = next(s for s in detail["scores"]
               if s["criterionId"] == "W1a-1" and s["channel"] == "product")
    assert "does not apply to it" in w1a1["styleApplied"]


def test_grading_style_mold_cached_across_regrade(admin_client, monkeypatch):
    # Distinct text from other tests in this module so this test's cache key
    # is guaranteed fresh, regardless of test execution order.
    style_text = "Cache-test style: reward bold, unconventional structure over the five-paragraph form."
    admin_client.put("/api/auth/prefs", json={"grading_style": style_text},
                     headers={"X-Requested-With": "fetch"})

    fake = FakeLLM()
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: fake)

    def run_and_wait():
        r = admin_client.post("/api/assessments/exemplar-jordan/grade",
                              headers={"X-Requested-With": "fetch"})
        assert r.status_code == 200, r.text
        job_id = r.json()["jobId"]
        deadline = time.time() + 60
        while time.time() < deadline:
            job = admin_client.get(f"/api/jobs/{job_id}").json()
            if job["status"] != "running":
                break
            time.sleep(0.2)
        assert job["status"] == "done", job

    run_and_wait()
    assert fake.mold_calls == 1
    run_and_wait()
    assert fake.mold_calls == 1  # unchanged style/rubric-version -> cache hit, no second mold call

    detail = admin_client.get("/api/assessments/exemplar-jordan").json()
    product = next(s for s in detail["scores"] if s["channel"] == "product")
    assert product["styleApplied"] == "applied the stated style to this product criterion"
    # Whether the LLM's *score* actually moves in response to a stated grading
    # style is a model-compliance question a hardcoded FakeLLM can't meaningfully
    # test — that remains a manual check against a live provider (see plan).


def test_style_intensity_prefs_round_trip(admin_client):
    r = admin_client.put("/api/auth/prefs", json={"style_intensity": "strong"},
                         headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    assert r.json()["styleIntensity"] == "strong"

    r = admin_client.get("/api/auth/me")
    assert r.json()["styleIntensity"] == "strong"

    # Reset to the default for isolation from any later tests in this module.
    admin_client.put("/api/auth/prefs", json={"style_intensity": "moderate"},
                     headers={"X-Requested-With": "fetch"})


def test_style_intensity_rejects_invalid_value(admin_client):
    r = admin_client.put("/api/auth/prefs", json={"style_intensity": "extreme"},
                         headers={"X-Requested-With": "fetch"})
    assert r.status_code == 422


def test_style_intensity_reaches_molding_prompt(admin_client, monkeypatch):
    style_text = "Intensity-test style: value voice and clarity over rigid formal structure."
    admin_client.put("/api/auth/prefs",
                     json={"grading_style": style_text, "style_intensity": "strong"},
                     headers={"X-Requested-With": "fetch"})

    fake = FakeLLM()
    monkeypatch.setattr(llm_bridge, "make_llm_json", lambda user, override=None: fake)
    r = admin_client.post("/api/assessments/exemplar-jordan/grade",
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    job_id = r.json()["jobId"]

    deadline = time.time() + 60
    while time.time() < deadline:
        job = admin_client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.2)
    assert job["status"] == "done", job

    assert fake.mold_calls == 1
    from app.services.grading import molding
    assert fake.mold_systems[0] == molding.build_mold_system("strong")

    # Reset to the default for isolation from any later tests in this module.
    admin_client.put("/api/auth/prefs", json={"style_intensity": "moderate"},
                     headers={"X-Requested-With": "fetch"})
