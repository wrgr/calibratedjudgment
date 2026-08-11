"""Bridge between a user's provider preference and the core LLM helpers.

Everything evaluative goes through JSON mode at temperature 0 with the fixed
seed (best-effort, provider-dependent — see core.llm). Raises LLMNotConfigured
when no provider has a server-side key, so callers can fall back to keyword
scoring or return a clear error.

Browser-specified keys (BYO key): a signed-in user may send their own key on a
request via the X-LLM-Key / X-LLM-Provider / X-LLM-Model headers (see
llm_override below). The key is used for that single request and is NEVER
persisted or logged — it exists only in the request headers and the transient
cfg copy handed to the core LLM call. Server .env keys remain the default.
"""

from fastapi import Request

from .. import config
from ..core import llm


class LLMNotConfigured(Exception):
    pass


class UnknownProvider(Exception):
    """The override named a provider that does not exist in config.PROVIDERS."""


# Headers carrying a browser-specified key. The custom names double as part of
# the CSRF posture: browsers won't attach them cross-site without CORS consent.
HEADER_KEY = "x-llm-key"
HEADER_PROVIDER = "x-llm-provider"
HEADER_MODEL = "x-llm-model"


def llm_override(request: Request) -> dict | None:
    """FastAPI dependency: extract a per-request BYO-key override from headers.

    Returns {"provider", "model", "api_key"} (any value may be None) or None
    when no override header is present. Do not log the returned dict.
    """
    api_key = (request.headers.get(HEADER_KEY) or "").strip()
    provider = (request.headers.get(HEADER_PROVIDER) or "").strip()
    model = (request.headers.get(HEADER_MODEL) or "").strip()
    if not (api_key or provider or model):
        return None
    return {"provider": provider or None, "model": model or None,
            "api_key": api_key or None}


def resolve_for_user(user: dict, override: dict | None = None):
    """Returns (provider_name, model, cfg) for a user's preferences.

    With a BYO-key override, the named provider (override → user pref →
    default) is used with the caller's key in a COPY of the provider config —
    config.PROVIDERS itself is never mutated, and an unconfigured provider
    becomes usable because the caller supplies the key.
    """
    override = override or {}
    if override.get("api_key"):
        name = (override.get("provider") or user.get("preferred_provider")
                or config.DEFAULT_PROVIDER)
        base_cfg = config.provider_config(name)
        if not base_cfg:
            raise UnknownProvider(f"Unknown provider: {name}")
        cfg = {**base_cfg, "api_key": override["api_key"]}
        model = override.get("model") or cfg["model"]
        return name, model, cfg

    name, cfg = config.resolve_provider(user.get("preferred_provider", ""))
    if not cfg:
        raise LLMNotConfigured(
            "No LLM provider is configured on the server. Add an API key to .env, "
            "or supply your own key in Settings.")
    model = override.get("model") or user.get("preferred_model") or cfg["model"]
    # A model preference saved for a different provider must not leak across.
    if not override.get("model") and user.get("preferred_provider") != name:
        model = cfg["model"]
    return name, model, cfg


def make_llm_json(user: dict, override: dict | None = None):
    """Zero-config evaluative JSON caller bound to the user's provider prefs
    (or their BYO-key override): llm_json(system, prompt) -> dict."""
    _, model, cfg = resolve_for_user(user, override)

    def llm_json(system: str, prompt: str) -> dict:
        raw = llm.llm_chat_json(model, system, prompt, cfg["api_key"], cfg["base_url"],
                                temperature=llm.EVALUATIVE_TEMPERATURE,
                                seed=llm.EVALUATIVE_SEED)
        return llm._extract_json(raw)

    return llm_json


def make_llm_chat(user: dict, override: dict | None = None):
    """Narrative chat caller: llm_chat(system, message) -> str."""
    _, model, cfg = resolve_for_user(user, override)

    def llm_chat(system: str, message: str) -> str:
        return llm.llm_chat(model, system, message, cfg["api_key"], cfg["base_url"])

    return llm_chat
