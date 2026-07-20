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
