"""Content pipeline: seeding, listing, version-bumping edits, provider info."""


def test_content_seeded(admin_client):
    rubrics = admin_client.get("/api/content/rubrics").json()
    assert any(r["contentId"] == "mccr-w11-12-arg" for r in rubrics)


def test_edit_bumps_version(admin_client):
    rubrics = admin_client.get("/api/content/rubrics").json()
    target = rubrics[0]
    before = target["version"]
    r = admin_client.put(
        f"/api/content/rubrics/{target['contentId']}",
        json={"payload": {**target["payload"], "assignmentGuidance": "edited"}},
        headers={"X-Requested-With": "fetch"},
    )
    assert r.status_code == 200
    after = r.json()["version"]
    assert after != before
    assert after == (f"{before}-t1" if "-t" not in before else after)
    # both versions retrievable
    old = admin_client.get(
        f"/api/content/rubrics/{target['contentId']}", params={"version": before}
    )
    assert old.status_code == 200


def test_students_cannot_edit_content(student_client):
    r = student_client.put(
        "/api/content/rubrics/mccr-w11-12-arg",
        json={"payload": {"assignmentGuidance": "x"}},
        headers={"X-Requested-With": "fetch"},
    )
    assert r.status_code == 403


def test_providers_endpoint_hides_keys(student_client):
    r = student_client.get("/api/providers")
    assert r.status_code == 200
    body = r.json()
    assert "providers" in body
    assert "api_key" not in str(body)
    assert "apiKey" not in str(body)


def test_bump_version_semantics():
    from app.api.content import bump_version
    assert bump_version("1.0") == "1.0-t1"
    assert bump_version("1.0-t1") == "1.0-t2"
    assert bump_version("2.3-t9") == "2.3-t10"
