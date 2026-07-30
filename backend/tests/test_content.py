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

    # the superseded version is deactivated — content_items.active is now a
    # real "exactly one active version" invariant, not just a tie-break on
    # created_at
    from app.db import database as db
    assert db.get_content("rubric", target["contentId"], before)["active"] == 0
    assert db.get_content("rubric", target["contentId"], after)["active"] == 1


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


# ── Calibration drafts (idea #2: LLM-drafted teacherGuidance, staged only) ─────

CONTENT_ID = "mccr-w11-12-arg"
CRITERION_ID = "W1d-1"


def _seed_overrides(n, criterion_id=CRITERION_ID, median=4, override_score=1):
    from app.db import database as db
    for i in range(n):
        aid = f"calib-draft-test-{criterion_id}-{i}-{db.new_id()}"
        db.upsert_score_record(aid, {
            "criterion_id": criterion_id, "channel": "product",
            "passes": [median] * 3, "median": median, "spread": 0, "no_evidence": False,
            "confidence": "high", "evidence": [], "anchor_matched": None,
            "rubric_version": "1.0",
        })
        db.set_score_override(aid, criterion_id, "product", override_score,
                              f"too informal for this assignment {i}")


def _stub_llm(monkeypatch, response):
    from app.services import llm_bridge
    monkeypatch.setattr(llm_bridge, "make_llm_json",
                        lambda user, override=None: (lambda system, prompt: response))


def test_draft_guidance_below_threshold_is_422(admin_client, monkeypatch):
    # A real criterion this file doesn't otherwise seed overrides for, so it
    # stays under CALIBRATION_MIN_OVERRIDES regardless of test order.
    _seed_overrides(1, criterion_id="W1a-1")
    _stub_llm(monkeypatch, {"teacherGuidance": "should not be reached"})
    r = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/criteria/W1a-1/draft-guidance",
        headers={"X-Requested-With": "fetch"})
    assert r.status_code == 422


def test_draft_guidance_stages_inactive_version_with_only_target_criterion_changed(admin_client, monkeypatch):
    current = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}").json()
    _seed_overrides(3)
    _stub_llm(monkeypatch, {"teacherGuidance": "Score register strictly per the anchors."})

    r = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/criteria/{CRITERION_ID}/draft-guidance",
        headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["version"] != current["version"]

    changed = next(c for c in draft["payload"]["criteria"] if c["criterionId"] == CRITERION_ID)
    assert changed["teacherGuidance"] == "Score register strictly per the anchors."
    old_by_id = {c["criterionId"]: c for c in current["payload"]["criteria"]}
    for c in draft["payload"]["criteria"]:
        if c["criterionId"] != CRITERION_ID:
            assert c == old_by_id[c["criterionId"]]

    # Not live yet.
    live = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}").json()
    assert live["version"] == current["version"]

    # Shows up in the pending-drafts list.
    drafts = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}/drafts").json()
    assert any(d["version"] == draft["version"] for d in drafts)


def test_publish_activates_draft_and_deactivates_prior_version(admin_client, monkeypatch):
    current = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}").json()
    _seed_overrides(3)
    _stub_llm(monkeypatch, {"teacherGuidance": "Publish-flow guidance text."})
    draft = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/criteria/{CRITERION_ID}/draft-guidance",
        headers={"X-Requested-With": "fetch"}).json()

    r = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/versions/{draft['version']}/publish",
        headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text

    live = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}").json()
    assert live["version"] == draft["version"]

    # The version publish specifically superseded is deactivated (save_item's
    # plain-edit path doesn't maintain a stricter "only one active row ever"
    # invariant elsewhere, so this only asserts what publish itself guarantees).
    from app.db import database as db
    published = db.get_content("rubric", CONTENT_ID, draft["version"])
    assert bool(published["active"]) is True
    old = db.get_content("rubric", CONTENT_ID, current["version"])
    assert bool(old["active"]) is False


def test_dismiss_hides_draft_without_deleting_it(admin_client, monkeypatch):
    _seed_overrides(3, criterion_id="CALIB-DISMISS-TEST")
    _seed_overrides(3)
    _stub_llm(monkeypatch, {"teacherGuidance": "Dismiss-flow guidance text."})
    draft = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/criteria/{CRITERION_ID}/draft-guidance",
        headers={"X-Requested-With": "fetch"}).json()

    r = admin_client.post(
        f"/api/content/rubrics/{CONTENT_ID}/versions/{draft['version']}/dismiss",
        headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200, r.text

    drafts = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}/drafts").json()
    assert all(d["version"] != draft["version"] for d in drafts)

    # Still retrievable by version — dismissed, not deleted.
    still_there = admin_client.get(f"/api/content/rubrics/{CONTENT_ID}",
                                   params={"version": draft["version"]})
    assert still_there.status_code == 200


def test_students_cannot_reach_calibration_endpoints(student_client):
    for method, path in [
        ("get", f"/api/content/rubrics/{CONTENT_ID}/drafts"),
        ("post", f"/api/content/rubrics/{CONTENT_ID}/criteria/{CRITERION_ID}/draft-guidance"),
        ("post", f"/api/content/rubrics/{CONTENT_ID}/versions/1.0/publish"),
        ("post", f"/api/content/rubrics/{CONTENT_ID}/versions/1.0/dismiss"),
    ]:
        r = getattr(student_client, method)(path, headers={"X-Requested-With": "fetch"})
        assert r.status_code == 403, path
