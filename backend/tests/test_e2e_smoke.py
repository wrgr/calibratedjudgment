"""End-to-end smoke path with ZERO API keys — the `git clone && make dev`
guarantee. Drives the platform over HTTP:

  login → Mode A exemplar with precomputed scores → override → corpus export
        → research export
"""


def test_zero_key_smoke(client):
    # ── sign in as an instructor ──────────────────────────────────────────────
    r = client.post("/api/auth/login",
                    json={"username": "instructor", "password": "Teach@2024"},
                    headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200

    # no provider configured → providers are still listed so a user could
    # bring their own key
    providers = client.get("/api/providers").json()["providers"]
    assert all(not p["configured"] for p in providers)

    # ── Mode A: exemplar carries precomputed demo scores ─────────────────────
    detail = client.get("/api/assessments/exemplar-maya").json()
    assert len(detail["scores"]) == 24
    assert detail["interpretation"]["tone"] == "valid"

    queue = client.get("/api/review-queue").json()
    item = next(i for i in queue if i["teacherOverride"] is None)
    r = client.post(f"/api/assessments/{item['assessmentId']}/override",
                    json={"criterionId": item["criterionId"], "channel": item["channel"],
                          "score": 3, "rationale": "Smoke-test override."},
                    headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200

    corpus = client.get("/api/export/override-corpus").json()
    assert corpus["n"] >= 1

    # ── research export covers what was just produced ────────────────────────
    rows = client.get("/api/export/research.json").json()["rows"]
    modes = {row["mode"] for row in rows}
    assert "essay_trace" in modes
