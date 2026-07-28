"""TAMU AI gateway provider registration.

TAMU's OpenAI-compatible gateway must (1) be selectable like any other provider,
(2) route down the OpenAI-compatible dispatch path rather than the Anthropic SDK
path — its base URL is not api.anthropic.com even though it serves Claude models
— and (3) survive the gateway being unreachable when listing models.
"""

import urllib.error

import pytest

from app import config
from app.core import llm
from app.services import llm_bridge

TAMU = "TAMU AI"
FAKE_KEY = "sk-tamu-test-key-XYZZY"


def test_registered_with_openai_compatible_endpoint():
    cfg = config.PROVIDERS[TAMU]
    assert cfg["base_url"] == "https://chat-api.tamu.ai/openai"
    # Not the Anthropic SDK branch in _call_llm, despite serving Claude models.
    assert llm._ANTHROPIC_HOST not in cfg["base_url"]
    # Undocumented seed support → the parameter must be omitted, not guessed at.
    assert not llm._supports_seed(cfg["base_url"])


def test_key_from_either_env_var(monkeypatch):
    # TAMU_CHAT_API_KEY is the name TAMU's own client library uses.
    for var in ("TAMU_AI_API_KEY", "TAMU_CHAT_API_KEY"):
        monkeypatch.delenv("TAMU_AI_API_KEY", raising=False)
        monkeypatch.delenv("TAMU_CHAT_API_KEY", raising=False)
        monkeypatch.setenv(var, FAKE_KEY)
        assert (config._env("TAMU_AI_API_KEY") or config._env("TAMU_CHAT_API_KEY")) == FAKE_KEY


def test_selectable_once_keyed(monkeypatch):
    monkeypatch.setitem(config.PROVIDERS[TAMU], "api_key", FAKE_KEY)
    names = [p["name"] for p in llm.get_configured_providers(config.PROVIDERS)]
    assert TAMU in names

    user = {"username": "emma", "preferred_provider": TAMU, "preferred_model": ""}
    name, model, cfg = llm_bridge.resolve_for_user(user)
    assert name == TAMU
    assert model == config.PROVIDERS[TAMU]["model"] == "protected.gpt-4o"
    assert cfg["api_key"] == FAKE_KEY


def test_byo_key_accepted_for_tamu():
    user = {"username": "emma", "preferred_provider": "", "preferred_model": ""}
    name, model, cfg = llm_bridge.resolve_for_user(
        user, {"provider": TAMU, "model": "protected.gpt-5", "api_key": FAKE_KEY})
    assert (name, model) == (TAMU, "protected.gpt-5")
    assert cfg["api_key"] == FAKE_KEY
    assert config.PROVIDERS[TAMU]["api_key"] != FAKE_KEY  # global config untouched


# ── live model listing ────────────────────────────────────────────────────────

def test_model_listing_prefers_live_catalogue(monkeypatch):
    monkeypatch.setattr(llm, "_list_openai_models", lambda cfg: ["protected.brand-new"])
    assert llm.get_available_models(TAMU, config.PROVIDERS[TAMU]) == ["protected.brand-new"]


def test_model_listing_falls_back_when_gateway_unreachable(monkeypatch):
    monkeypatch.setattr(llm, "_list_openai_models", lambda cfg: [])
    models = llm.get_available_models(TAMU, config.PROVIDERS[TAMU])
    assert models == llm._PROVIDER_MODELS[TAMU]
    assert all(m.startswith("protected.") for m in models)


def test_list_openai_models_skips_call_without_key():
    # No key → no request attempted (so an unconfigured provider never blocks on I/O).
    assert llm._list_openai_models({"base_url": "https://chat-api.tamu.ai/openai", "api_key": ""}) == []


def test_stdlib_calls_send_an_explicit_user_agent(monkeypatch):
    """urllib's default "Python-urllib/3.x" UA is 403'd by TAMU's Cloudflare
    (error code 1010) before the request reaches the API, making every key look
    invalid. Every stdlib request must therefore carry our own UA."""
    seen = []

    def _capture(req, *a, **k):
        seen.append(req)
        raise urllib.error.HTTPError(req.full_url, 401, "unauthorized", {}, None)

    monkeypatch.setattr(llm.urllib.request, "urlopen", _capture)

    llm._list_openai_models({"base_url": "https://chat-api.tamu.ai/openai", "api_key": FAKE_KEY})
    llm.validate_api_key(TAMU, FAKE_KEY, "protected.gpt-4o", "https://chat-api.tamu.ai/openai")
    with pytest.raises(llm.LLMError):
        llm._raw_chat("protected.gpt-4o", FAKE_KEY, "https://chat-api.tamu.ai/openai",
                      16, "sys", "hi")

    assert seen, "no requests captured"
    for req in seen:
        ua = req.get_header("User-agent")
        assert ua and "Python-urllib" not in ua, f"bad UA on {req.full_url}: {ua!r}"
        # Identify honestly rather than impersonating a browser.
        assert "Mozilla" not in ua


@pytest.mark.parametrize("payload", [
    {"data": [{"id": "protected.gpt-4o"}, {"id": "protected.gpt-5"}]},
    {"data": [{"id": "protected.gpt-4o"}, "junk", {"no_id": 1}]},
    {},
])
def test_list_openai_models_parses_and_tolerates_junk(monkeypatch, payload):
    import contextlib
    import json

    class _Resp:
        def read(self):
            return json.dumps(payload).encode()

    monkeypatch.setattr(llm.urllib.request, "urlopen",
                        lambda *a, **k: contextlib.nullcontext(_Resp()))
    models = llm._list_openai_models({"base_url": "https://chat-api.tamu.ai/openai",
                                      "api_key": FAKE_KEY})
    assert models == [m["id"] for m in payload.get("data", []) if isinstance(m, dict) and m.get("id")]
