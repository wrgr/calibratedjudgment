"""Regression tests for the issues found in the platform security audit.

Each test encodes a vulnerability that was demonstrated against a running
server, so a refactor that reintroduces it fails here rather than in production.
"""

import pytest

from app.core import llm


# ── 1. Path traversal in the SPA catch-all (CRITICAL) ─────────────────────────
#
# `FRONTEND_DIST / path` with an unvalidated path served any file on disk to an
# UNAUTHENTICATED caller: GET /../../backend/data/assessments.db returned the
# whole SQLite database (password hashes, every student essay). Starlette passes
# `..` segments through to the handler; Path.__truediv__ walks straight out of
# the directory.

def _spa_paths():
    return [
        "../package.json",
        "../../backend/app/config.py",
        "../vite.config.ts",
        "../../backend/data/assessments.db",
        "../../.env",
        "..%2fpackage.json",
        "....//backend/app/config.py",
    ]


@pytest.mark.parametrize("path", _spa_paths())
def test_spa_route_never_serves_files_outside_dist(tmp_path, monkeypatch, path):
    from app import main

    # Build a fake dist/ next to a secret the traversal would target.
    dist = tmp_path / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)  # the app mounts dist/assets
    (dist / "index.html").write_text("<!doctype html><title>spa</title>")
    (tmp_path / "frontend" / "package.json").write_text('{"secret": "LEAKED"}')
    secret = tmp_path / "backend" / "app"
    secret.mkdir(parents=True)
    (secret / "config.py").write_text("API_KEY = 'LEAKED'")

    monkeypatch.setattr(main, "FRONTEND_DIST", dist)
    app = main.create_app()
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        r = c.get("/" + path)
    assert "LEAKED" not in r.text, f"traversal via {path!r} escaped dist/"


def test_spa_still_serves_real_assets(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>spa</title>")
    (dist / "favicon.ico").write_text("icon-bytes")
    monkeypatch.setattr(main, "FRONTEND_DIST", dist)

    with TestClient(main.create_app()) as c:
        assert c.get("/favicon.ico").text == "icon-bytes"   # real file still served
        assert "<title>spa</title>" in c.get("/some/spa/route").text  # fallback intact


# ── 2. Job endpoints bypassed assessment ownership (HIGH) ─────────────────────

def test_job_routes_enforce_assessment_ownership(student_client, monkeypatch):
    """A student blocked from another user's assessment could still read that
    assessment's job — id, status, progress label and error text — through
    /api/jobs/{id} and its SSE stream."""
    from app.db import database as db

    other = db.create_assessment(username="someone-else", mode="essay_trace",
                                 name="not yours", description="", content_id="",
                                 content_version="", artifacts={})
    job_id = db.create_job(other, "grade_essay_trace", 10)
    db.update_job(job_id, done=3, label="criterion W1a-1", status="error",
                  error="secret provider message")

    assert student_client.get(f"/api/assessments/{other}").status_code == 404  # control
    assert student_client.get(f"/api/jobs/{job_id}").status_code == 404
    assert student_client.get(f"/api/jobs/{job_id}/events").status_code == 404


def test_job_routes_still_work_for_the_owner(student_client):
    from app.db import database as db

    mine = db.create_assessment(username="emma", mode="essay_trace", name="mine",
                                description="", content_id="", content_version="",
                                artifacts={})
    job_id = db.create_job(mine, "grade_essay_trace", 4)
    assert student_client.get(f"/api/jobs/{job_id}").status_code == 200


# ── 3. logout was exempt from the CSRF header gate (MEDIUM) ───────────────────

def test_logout_requires_the_csrf_header(student_client):
    assert student_client.post("/api/auth/logout").status_code == 403
    # still signed in
    assert student_client.get("/api/auth/me").status_code == 200
    ok = student_client.post("/api/auth/logout", headers={"X-Requested-With": "fetch"})
    assert ok.status_code == 200
    assert student_client.get("/api/auth/me").status_code == 401


# ── 4. Provider error text reaches the browser (MEDIUM) ───────────────────────
#
# Job error rows and the /api/chat 502 body are shown to the end user. Some
# providers quote the rejected credential back, so with a SERVER key configured
# an unmodified passthrough would hand a student the platform's own API key.

SERVER_KEY = "sk-server-side-key-DO-NOT-LEAK"


def _http_error(code, body):
    import io
    import urllib.error
    return urllib.error.HTTPError("https://gw.example/v1/chat/completions", code,
                                  "err", {}, io.BytesIO(body.encode()))


def test_http_error_redacts_the_api_key():
    err = _http_error(401, '{"error": {"message": "Incorrect API key provided: %s"}}' % SERVER_KEY)
    with pytest.raises(llm.LLMError) as ei:
        llm._raise_http_error(err, SERVER_KEY)
    assert SERVER_KEY not in str(ei.value)
    assert "[redacted]" in str(ei.value)


def test_http_error_without_a_key_still_reports_detail():
    err = _http_error(400, '{"error": {"message": "model not found"}}')
    with pytest.raises(llm.LLMError) as ei:
        llm._raise_http_error(err, None)
    assert "model not found" in str(ei.value)


def test_unexpected_client_failure_redacts_the_api_key(monkeypatch):
    import openai
    import types

    class _Boom:
        def __init__(self, *a, **k):
            self.chat = types.SimpleNamespace(
                completions=types.SimpleNamespace(create=self._raise))

        def _raise(self, *a, **k):
            raise ValueError(f"bad request with key={SERVER_KEY}")

    monkeypatch.setattr(openai, "OpenAI", _Boom)
    with pytest.raises(llm.LLMError) as ei:
        llm._call_llm("m", SERVER_KEY, "https://gw.example/v1", 16, "s", "u")
    assert SERVER_KEY not in str(ei.value)
