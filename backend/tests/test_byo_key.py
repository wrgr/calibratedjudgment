"""Browser-specified (BYO) API key: per-request pass-through via X-LLM-* headers.

The key must (1) reach the core LLM call for that request, (2) make an
unconfigured provider usable, and (3) never be persisted anywhere — not in the
users table or assessment artifacts.
"""

import sqlite3
import time

import pytest

from app.services import llm_bridge

BYO_KEY = "sk-byo-test-key-XYZZY"
HEADERS = {
    "X-Requested-With": "fetch",
    "X-LLM-Key": BYO_KEY,
    "X-LLM-Provider": "Claude",
    "X-LLM-Model": "claude-opus-4-8",
}


# ── resolve_for_user override semantics ───────────────────────────────────────

USER = {"username": "emma", "preferred_provider": "", "preferred_model": ""}


def test_override_key_makes_unconfigured_provider_usable():
    # No server keys in the test env — without an override this raises.
    with pytest.raises(llm_bridge.LLMNotConfigured):
        llm_bridge.resolve_for_user(USER)
    name, model, cfg = llm_bridge.resolve_for_user(
        USER, {"provider": "Claude", "model": "claude-opus-4-8", "api_key": BYO_KEY})
    assert name == "Claude"
    assert model == "claude-opus-4-8"
    assert cfg["api_key"] == BYO_KEY
    assert "anthropic" in cfg["base_url"]


def test_override_provider_fallback_chain():
    from app import config
    # provider omitted → user preference → DEFAULT_PROVIDER
    user_with_pref = {**USER, "preferred_provider": "OpenAI"}
    name, model, _ = llm_bridge.resolve_for_user(user_with_pref, {"api_key": BYO_KEY})
    assert name == "OpenAI"
    assert model == config.PROVIDERS["OpenAI"]["model"]  # provider default
    name, _, _ = llm_bridge.resolve_for_user(USER, {"api_key": BYO_KEY})
    assert name == config.DEFAULT_PROVIDER


def test_override_unknown_provider_rejected():
    with pytest.raises(llm_bridge.UnknownProvider):
        llm_bridge.resolve_for_user(USER, {"provider": "NotAProvider", "api_key": BYO_KEY})


def test_override_never_mutates_global_config():
    from app import config
    before = config.PROVIDERS["Claude"]["api_key"]
    llm_bridge.resolve_for_user(USER, {"provider": "Claude", "api_key": BYO_KEY})
    assert config.PROVIDERS["Claude"]["api_key"] == before
    assert BYO_KEY not in str(config.PROVIDERS)


def test_headers_without_key_still_override_model():
    """Model-only override (no key) applies on top of a configured provider."""
    import app.config as config
    orig = config.PROVIDERS["OpenAI"]["api_key"]
    config.PROVIDERS["OpenAI"]["api_key"] = "sk-server-key"
    try:
        user = {**USER, "preferred_provider": "OpenAI"}
        _, model, cfg = llm_bridge.resolve_for_user(user, {"model": "gpt-4o-mini"})
        assert model == "gpt-4o-mini"
        assert cfg["api_key"] == "sk-server-key"
    finally:
        config.PROVIDERS["OpenAI"]["api_key"] = orig


# ── API pass-through (Mode A grading) ─────────────────────────────────────────

def _wait_for_job(client, job_id, timeout=60):
    deadline = time.time() + timeout
    job = None
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.2)
    return job


def test_grade_endpoint_uses_browser_key(admin_client, monkeypatch):
    """The header key must reach the core grading call — and only that call."""
    captured = {}

    def fake_chat_json(model, system, prompt, api_key, base_url, **kwargs):
        captured["api_key"] = api_key
        captured["model"] = model
        captured["base_url"] = base_url
        return '{"score": 4, "evidence": [], "selfConfidence": "high"}'

    monkeypatch.setattr("app.core.llm.llm_chat_json", fake_chat_json)

    r = admin_client.post("/api/assessments/exemplar-alex/grade", headers=HEADERS)
    assert r.status_code == 200, r.text
    job = _wait_for_job(admin_client, r.json()["jobId"])
    assert job["status"] == "done", job

    assert captured["api_key"] == BYO_KEY
    assert captured["model"] == "claude-opus-4-8"
    assert "anthropic" in captured["base_url"]


def test_unknown_provider_header_is_422(admin_client):
    r = admin_client.post("/api/assessments/exemplar-alex/grade",
                          headers={**HEADERS, "X-LLM-Provider": "Bogus"})
    assert r.status_code == 422


def test_byo_key_is_never_persisted(admin_client, monkeypatch):
    """After a BYO-key grading request, the key must not exist anywhere in the database."""
    monkeypatch.setattr(
        "app.core.llm.llm_chat_json",
        lambda *a, **k: '{"score": 3, "evidence": [], "selfConfidence": "med"}')
    r = admin_client.post("/api/assessments/exemplar-alex/grade", headers=HEADERS)
    assert r.status_code == 200, r.text
    job = _wait_for_job(admin_client, r.json()["jobId"])
    assert job["status"] == "done", job

    from app.db import database as db
    with sqlite3.connect(str(db.DB_FILE)) as conn:
        for (table,) in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            for row in conn.execute(f"SELECT * FROM {table}").fetchall():
                assert BYO_KEY not in str(row), f"BYO key leaked into table {table}"


# ── providers endpoint & validate-key ─────────────────────────────────────────

def test_providers_lists_unconfigured_with_flag(student_client):
    body = student_client.get("/api/providers").json()
    assert body["providers"], "unconfigured providers must still be listed for BYO keys"
    assert all(p["configured"] is False for p in body["providers"])
    assert "api_key" not in str(body) and "apiKey" not in str(body)


def test_validate_key_endpoint(student_client, monkeypatch):
    monkeypatch.setattr("app.core.llm.validate_api_key",
                        lambda name, key, model, base_url: (key == BYO_KEY, None))
    ok = student_client.post("/api/providers/Claude/validate-key",
                             json={"apiKey": BYO_KEY},
                             headers={"X-Requested-With": "fetch"}).json()
    assert ok["ok"] is True
    bad = student_client.post("/api/providers/Claude/validate-key",
                              json={"apiKey": "wrong"},
                              headers={"X-Requested-With": "fetch"}).json()
    assert bad["ok"] is False
    assert BYO_KEY not in str(ok) + str(bad)


# ── validate_api_key error reporting ──────────────────────────────────────────
#
# A bare status code makes a rejected *model* look identical to a rejected key,
# which is the common failure on gateways whose model IDs are account-specific.

def _http_error(code, body):
    import io
    import urllib.error
    return urllib.error.HTTPError(
        "https://gw.example/openai/chat/completions", code, "err", {},
        io.BytesIO(body.encode()))


def _validate_raising(monkeypatch, err):
    from app.core import llm
    def _raise(*a, **k):
        raise err
    monkeypatch.setattr(llm.urllib.request, "urlopen", _raise)
    return llm.validate_api_key(
        "TAMU AI", BYO_KEY, "protected.nonexistent", "https://gw.example/openai")


def test_validate_key_surfaces_provider_message(monkeypatch):
    err = _http_error(400, '{"error": {"message": "model protected.nonexistent not found"}}')
    ok, msg = _validate_raising(monkeypatch, err)
    assert ok is False
    assert "Provider error (400)" in msg
    assert "model protected.nonexistent not found" in msg


def test_validate_key_surfaces_fastapi_detail_body(monkeypatch):
    # TAMU's gateway reports errors as {"detail": "..."}, not OpenAI's
    # {"error": {"message": ...}}.
    err = _http_error(401, '{"detail": "Your session has expired or the token is invalid."}')
    ok, msg = _validate_raising(monkeypatch, err)
    assert ok is False
    assert "Your session has expired" in msg


def test_validate_key_auth_failure_keeps_headline(monkeypatch):
    err = _http_error(401, '{"error": {"message": "token expired"}}')
    ok, msg = _validate_raising(monkeypatch, err)
    assert ok is False
    assert msg.startswith("Invalid API key")
    assert "token expired" in msg


def test_validate_key_never_echoes_the_key(monkeypatch):
    # Some providers quote the offending credential back in the error body.
    err = _http_error(401, json_body := '{"error": {"message": "bad key: %s"}}' % BYO_KEY)
    assert BYO_KEY in json_body  # the provider really did echo it
    ok, msg = _validate_raising(monkeypatch, err)
    assert ok is False
    assert BYO_KEY not in msg
    assert "[redacted]" in msg


def test_validate_key_rate_limit_still_means_valid(monkeypatch):
    ok, msg = _validate_raising(monkeypatch, _http_error(429, "slow down"))
    assert ok is True and msg is None


def test_validate_key_requires_auth(client):
    r = client.post("/api/providers/Claude/validate-key", json={"apiKey": "x"},
                    headers={"X-Requested-With": "fetch"})
    assert r.status_code == 401
