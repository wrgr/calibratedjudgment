"""Research surface: export v3 rows, override corpus, reliability dashboard,
user management."""

import csv
import io


def test_export_includes_essay_trace(admin_client):
    r = admin_client.get("/api/export/research.json")
    assert r.status_code == 200
    body = r.json()
    assert body["export_schema_version"] == "3"
    modes = {row["mode"] for row in body["rows"]}
    assert "essay_trace" in modes  # exemplars carry precomputed score records

    mode_a = next(row for row in body["rows"] if row["mode"] == "essay_trace")
    assert mode_a["trace_score_median"] != ""
    assert mode_a["product_score_median"] != ""
    assert mode_a["layer_b_label"] != ""


def test_export_csv_has_documented_header(admin_client):
    from app.api.export import EXPORT_FIELDS
    r = admin_client.get("/api/export/research.csv")
    assert r.status_code == 200
    reader = csv.reader(io.StringIO(r.text))
    header = next(reader)
    assert header == EXPORT_FIELDS


def test_override_corpus_export(admin_client):
    queue = admin_client.get("/api/review-queue").json()
    item = next(i for i in queue if i["teacherOverride"] is None)
    admin_client.post(
        f"/api/assessments/{item['assessmentId']}/override",
        json={"criterionId": item["criterionId"], "channel": item["channel"],
              "score": 2, "rationale": "Anchor 2 fits the evidence better."},
        headers={"X-Requested-With": "fetch"})
    corpus = admin_client.get("/api/export/override-corpus").json()
    assert corpus["n"] >= 1
    row = corpus["overrides"][-1]
    assert {"criterionId", "channel", "llmPasses", "llmMedian", "teacherScore",
            "teacherRationale", "rubricVersion"} <= set(row)


def test_reliability_dashboard_reflects_overrides(admin_client):
    queue = admin_client.get("/api/review-queue").json()
    item = next(i for i in queue if i["teacherOverride"] is None)
    r = admin_client.post(
        f"/api/assessments/{item['assessmentId']}/override",
        json={"criterionId": item["criterionId"], "channel": item["channel"],
              "score": 2, "rationale": "Reliability-dashboard smoke test."},
        headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200

    stats = admin_client.get("/api/admin/reliability").json()
    assert stats["total"] > 0
    assert stats["overridden"] >= 1
    assert stats["by_criterion"], "per-criterion breakdown must exist"
    recent = stats["recent"][0]
    assert recent["criterion_id"]
    assert recent["override_score"] is not None


def test_reliability_flags_criterion_crossing_calibration_threshold():
    """needs_calibration_review/flagged_criteria are a threshold applied on top
    of avg_delta/overridden — CALIBRATION_MIN_OVERRIDES overrides AND
    CALIBRATION_AVG_DELTA_THRESHOLD points, both required, so a single
    correction or a small delta never lights up the flag."""
    from app.db import database as db

    def _override_with_delta(criterion_id, median, override_score, n, rationale):
        for i in range(n):
            aid = f"calib-test-{criterion_id}-{i}-{db.new_id()}"
            db.upsert_score_record(aid, {
                "criterion_id": criterion_id, "channel": "product",
                "passes": [median, median, median], "median": median, "spread": 0,
                "no_evidence": False, "confidence": "high", "evidence": [],
                "anchor_matched": None, "rubric_version": "1.0",
            })
            db.set_score_override(aid, criterion_id, "product", override_score,
                                  f"{rationale} {i}")

    # Crosses both thresholds: 3 overrides, delta of 3 points.
    _override_with_delta("CALIB-TEST-FLAGGED", median=4, override_score=1, n=3,
                         rationale="big consistent correction")
    # Big delta, but only 1 override — under CALIBRATION_MIN_OVERRIDES.
    _override_with_delta("CALIB-TEST-TOO-FEW", median=4, override_score=1, n=1,
                         rationale="one-off correction")
    # Enough overrides, but a small delta — under CALIBRATION_AVG_DELTA_THRESHOLD.
    _override_with_delta("CALIB-TEST-SMALL-DELTA", median=4, override_score=4, n=3,
                         rationale="negligible correction")

    stats = db.mode_a_reliability_stats()
    by_id = {r["criterion_id"]: r for r in stats["by_criterion"]}

    assert by_id["CALIB-TEST-FLAGGED"]["needs_calibration_review"] is True
    assert "CALIB-TEST-FLAGGED" in stats["flagged_criteria"]

    assert by_id["CALIB-TEST-TOO-FEW"]["needs_calibration_review"] is False
    assert "CALIB-TEST-TOO-FEW" not in stats["flagged_criteria"]

    assert by_id["CALIB-TEST-SMALL-DELTA"]["needs_calibration_review"] is False
    assert "CALIB-TEST-SMALL-DELTA" not in stats["flagged_criteria"]


def test_students_cannot_reach_research_surface(student_client):
    for path in ("/api/export/research.json", "/api/export/override-corpus",
                 "/api/admin/reliability", "/api/admin/users"):
        assert student_client.get(path).status_code == 403, path


def test_user_management(admin_client):
    r = admin_client.post("/api/admin/users",
                          json={"username": "newkid", "password": "Pw@12345",
                                "role": "student", "displayName": "New Kid"},
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    users = admin_client.get("/api/admin/users").json()
    assert any(u["username"] == "newkid" for u in users)

    r = admin_client.put("/api/admin/users/newkid",
                         json={"displayName": "Renamed Kid", "role": "instructor"},
                         headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200
    users = admin_client.get("/api/admin/users").json()
    u = next(u for u in users if u["username"] == "newkid")
    assert u["displayName"] == "Renamed Kid"
    assert u["role"] == "instructor"

    # the last admin cannot be demoted
    r = admin_client.put("/api/admin/users/admin", json={"role": "student"},
                         headers={"X-Requested-With": "fetch"})
    assert r.status_code == 422
