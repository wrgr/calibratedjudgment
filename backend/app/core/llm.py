"""
llm.py — LLM provider dispatch and response parsing.

Ported near-verbatim from Performative_Assessment_V5 (assessmentRework branch).
Platform changes: API keys come exclusively from server-side configuration
(app.config, which reads the environment).
"""

import json
import logging
import re
import socket
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

_ANTHROPIC_HOST = "api.anthropic.com"

# Identify this client on stdlib HTTP calls. urllib otherwise sends
# "Python-urllib/3.x", which some WAFs in front of provider gateways reject
# outright -- TAMU's Cloudflare returns 403 "error code: 1010" to that UA, so
# the request never reaches the API and any key looks invalid. The SDK paths
# (openai/anthropic via httpx) send their own UA and were never affected, which
# is why grading could work while the stdlib "Test key" check failed.
# This is a truthful identifier, not browser impersonation.
_USER_AGENT = "assessment-platform/0.1 (+https://github.com/ohburks/essay-grading)"

# Extra attempts after the first HTTP 429 before giving up.
_RATE_LIMIT_MAX_RETRIES = 2

# SDK/transport exception class names that mean "the request never completed".
# Matched by name so this module keeps its no-import-at-module-scope property
# for the optional openai/anthropic/httpx packages.
_TRANSPORT_ERROR_NAMES = frozenset({
    "APIConnectionError", "APITimeoutError",          # openai
    "ConnectError", "ConnectTimeout", "ReadTimeout", "ReadError", "PoolTimeout",  # httpx
})

# ─────────────────────────────────────────────────────────────────────────────
# DETERMINISM SETTINGS FOR EVALUATIVE / SCORING LLM CALLS
#
# NOTE: temperature=0 substantially reduces but does not guarantee bit-identical
# output across all providers -- floating-point non-associativity in parallel
# batch execution and provider infrastructure differences can still produce
# rare small variance even at temperature=0. Seed support is provider-dependent
# and applied best-effort -- see _supports_seed(). Narrative/generative calls
# (the writing-session tutor chat) intentionally do NOT use these -- their
# variability is harmless or desirable.
# ─────────────────────────────────────────────────────────────────────────────
EVALUATIVE_TEMPERATURE = 0.0
EVALUATIVE_SEED = 42  # arbitrary fixed seed; only applied where the provider supports it

# Providers/endpoints known to accept an OpenAI-style top-level "seed" field in
# the chat-completions request body, based on each provider's public docs at
# the time of writing. This is a snapshot, not a permanent truth -- providers
# add, rename, or drop parameters over time (e.g. Mistral uses "random_seed"
# instead of "seed"), so re-verify against current docs before trusting this
# list, and update it if a provider's behaviour changes.
_SEED_SUPPORTED_HOSTS = (
    "api.openai.com",
    "api.groq.com",
    "localhost",     # Ollama's OpenAI-compatible endpoint
    "127.0.0.1",
)


def _supports_seed(base_url):
    """Best-effort check: does this provider's endpoint accept a `seed` field?

    Unknown/undocumented providers default to False (the parameter is simply
    omitted from the request) rather than sent-and-possibly-ignored, since a
    silently-ignored parameter is worse than an omitted one -- the caller
    can't tell the two apart from the response alone.
    """
    base = (base_url or "").lower()
    return any(host in base for host in _SEED_SUPPORTED_HOSTS)


class LLMError(Exception):
    """An LLM API call failed. The message is concise and safe to surface."""


class LLMRateLimitError(LLMError):
    """The provider returned HTTP 429 — rate limit or quota exhausted."""


def _describe_http_status(code):
    """Map an HTTP status code to a clear, actionable message."""
    if code == 429:
        return ("Rate limit exceeded (HTTP 429): the provider is throttling requests. "
                "Wait for the quota window to reset, or use a key/tier with higher limits.")
    if code in (401, 403):
        return (f"Authentication failed (HTTP {code}): the API key was rejected or is not "
                "authorised for this model.")
    if code == 404:
        return "Not found (HTTP 404): check the model name and base URL."
    if code == 400:
        return ("Bad request (HTTP 400): the provider rejected the request — often an "
                "invalid model name or malformed input.")
    if 500 <= code < 600:
        return f"Provider server error (HTTP {code}): usually temporary — retry shortly."
    return f"The provider returned HTTP {code}."


def _http_error_detail(http_error):
    """Extract the provider's own error message from an HTTPError body, if any."""
    try:
        raw = http_error.read().decode("utf-8", "replace")
    except Exception:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return raw[:300].strip() or None
    # Google's OpenAI-compatible endpoint wraps the error object in a JSON
    # array ([{"error": {...}}]); OpenAI and others return it bare.
    if isinstance(data, list):
        data = next((d for d in data if isinstance(d, dict)), {})
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            return err.get("message")
        if isinstance(err, str):
            return err
        if isinstance(data.get("message"), str):
            return data["message"]
        # FastAPI-style gateways (TAMU's among them) return {"detail": "..."}.
        if isinstance(data.get("detail"), str):
            return data["detail"]
    return None


def _raise_http_error(http_error, api_key=None):
    """Translate an HTTPError into a clear LLMError / LLMRateLimitError (always raises).

    `api_key` is scrubbed from the provider's message: these errors reach the
    browser (job error rows, the chat 502 body), and some providers quote the
    rejected credential back. With a server-side key in use that would hand a
    student the platform's own API key.
    """
    msg = _describe_http_status(http_error.code)
    detail = _redact(_http_error_detail(http_error), api_key)
    if detail:
        msg += f" Provider said: {detail}"
    if http_error.code == 429:
        raise LLMRateLimitError(msg) from http_error
    raise LLMError(msg) from http_error


def _retry_after_seconds(http_error, attempt):
    """Honour a Retry-After header when present; otherwise exponential backoff."""
    try:
        ra = http_error.headers.get("Retry-After")
    except Exception:
        ra = None
    if ra:
        try:
            return min(float(ra), 30.0)
        except (TypeError, ValueError):
            pass
    return min(2 ** attempt, 8)

_PROVIDER_MODELS = {
    "OpenAI":  ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    "Claude":  ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    "Gemini":  ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    "Groq":    ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    "Mistral": ["mistral-large-latest", "mistral-small-latest", "mistral-nemo"],
    # GitHub Models — publisher/model IDs. gpt-4o-mini first: JSON mode + best free-tier limits.
    "GitHub Models": ["openai/gpt-4o-mini", "openai/gpt-4o", "meta/Llama-3.3-70B-Instruct", "mistral-ai/Mistral-Nemo"],
    # TAMU AI gateway — model IDs carry a `protected.` prefix denoting the
    # campus-licensed (institutional-data-approved) deployment of each model.
    # Fallback list only: get_available_models queries the gateway live, since
    # TAMU adds and retires models without notice.
    "TAMU AI": ["protected.gpt-4o", "protected.gpt-4.1", "protected.gpt-5",
                "protected.Claude Opus 4.1", "protected.Claude 3.5 Sonnet",
                "protected.gemini-2.0-flash"],
}


def llm_is_available(api_key):
    return bool(api_key) and not api_key.startswith("your-")


def _redact(text, secret):
    """Strip `secret` out of provider-supplied text.

    Some providers quote the offending credential back in their error body. The
    validate-key endpoint contracts that a browser-supplied key is never echoed
    back, so scrub it before the message crosses that boundary.
    """
    if not text or not secret or len(secret) < 8:
        return text
    return text.replace(secret, "[redacted]")


def validate_api_key(provider_name, api_key, model, base_url):
    """Try a minimal API call. Returns (ok, error_message)."""
    import urllib.error

    if provider_name == "Ollama":
        try:
            host = base_url.rstrip("/")
            if host.endswith("/v1"):
                host = host[:-3]
            req = urllib.request.Request(host + "/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5):
                pass
            return True, None
        except Exception:
            return False, "Cannot connect to Ollama"

    if _ANTHROPIC_HOST in base_url:
        try:
            import anthropic
        except ImportError:
            return False, "anthropic package not installed"
        try:
            client = anthropic.Anthropic(api_key=api_key)
            client.messages.create(
                model=model, max_tokens=1,
                messages=[{"role": "user", "content": "Hi"}],
            )
            return True, None
        except anthropic.AuthenticationError:
            return False, "Invalid API key"
        except Exception:
            return False, "Cannot connect to provider"

    # OpenAI-compatible providers (OpenAI, Groq, Mistral, Gemini, etc.)
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key,
        "User-Agent": _USER_AGENT,
    }
    body = json.dumps({
        "model": model, "max_tokens": 1,
        "messages": [{"role": "user", "content": "Hi"}],
    }).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=body, headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True, None
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return True, None  # rate-limited → key is valid
        # Append the provider's own message. Without it every non-auth failure
        # collapses to a bare status code, so a rejected *model* (HTTP 400 on
        # gateways like TAMU, whose model IDs are account-specific) is
        # indistinguishable from a rejected key.
        detail = _redact(_http_error_detail(e), api_key)
        headline = "Invalid API key" if e.code in (401, 403) else f"Provider error ({e.code})"
        return False, f"{headline}: {detail}" if detail else headline
    except Exception:
        return False, "Cannot connect to provider"


def get_available_models(provider_name, provider_cfg):
    """Return the model list for a provider.
    Ollama: queried live from /api/tags so it reflects what the user actually has installed.
    Others: curated list from _PROVIDER_MODELS."""
    if provider_name == "Ollama":
        try:
            base = provider_cfg.get("base_url", "http://localhost:11434/v1").rstrip("/")
            host = base[:-3] if base.endswith("/v1") else base
            req = urllib.request.Request(host + "/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []
    if provider_name == "TAMU AI":
        # The gateway's catalogue changes as TAMU licenses/retires models, so
        # prefer the live list and fall back to the curated one on any failure.
        return _list_openai_models(provider_cfg) or _PROVIDER_MODELS["TAMU AI"]
    return _PROVIDER_MODELS.get(provider_name, [])


def _list_openai_models(provider_cfg):
    """GET /models on an OpenAI-compatible endpoint. Returns [] on any failure."""
    api_key = provider_cfg.get("api_key") or ""
    if not llm_is_available(api_key):
        return []
    try:
        req = urllib.request.Request(
            provider_cfg["base_url"].rstrip("/") + "/models",
            headers={"Authorization": "Bearer " + api_key, "User-Agent": _USER_AGENT},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return [m["id"] for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]
    except Exception as e:
        logger.debug("[llm] live model listing failed for %s: %s", provider_cfg.get("base_url"), e)
        return []


def _fix_unescaped_quotes(s):
    """Escape double-quote characters that appear inside JSON string values.

    LLMs occasionally emit strings like:
        "reasoning": "the response ("quoted term") was..."
    where the inner quotes are not escaped.  This walks the text character-by-
    character and escapes any " that is not a structural delimiter.  A quote is
    treated as structural (i.e. genuinely closes the string) when the next
    non-whitespace character is one of  :  ,  }  ]  — the only chars that can
    legally follow a closed JSON string.  Any other successor means the quote
    is inside the value and needs a backslash prepended.
    """
    result = []
    in_string = False
    i = 0
    while i < len(s):
        c = s[i]
        if in_string:
            if c == '\\':          # already-escaped sequence — copy both chars
                result.append(c)
                i += 1
                if i < len(s):
                    result.append(s[i])
                    i += 1
                continue
            if c == '"':
                # Peek at the next non-whitespace char to decide intent
                j = i + 1
                while j < len(s) and s[j] in ' \t\r\n':
                    j += 1
                next_c = s[j] if j < len(s) else ''
                if next_c in (':', ',', '}', ']'):
                    in_string = False   # legitimate closing quote
                    result.append(c)
                else:
                    result.append('\\')  # inner quote — escape it
                    result.append(c)
            else:
                result.append(c)
        else:
            if c == '"':
                in_string = True
            result.append(c)
        i += 1
    return ''.join(result)


def _extract_json(raw):
    """Extract the first valid JSON object from an LLM response.

    Handles three common failure modes:

    1. Greedy regex pollution — the old r"{.*}" (re.DOTALL) matched from the
       FIRST { to the LAST }, grabbing surrounding prose (e.g. "evaluation
       {of the transcript}: { ... }") and producing invalid JSON.  raw_decode()
       stops as soon as a complete object is found, so surrounding text is safe.

    2. Thinking-model leakage — reasoning models (DeepSeek R1, QWQ, Gemma 4)
       sometimes emit draft JSON inside <think>...</think> while they reason.
       Stripping those blocks before scanning means we never mistake a draft
       for the final answer.  llm_chat() also passes think=False to Ollama so
       thinking is suppressed at source; this strip is defense-in-depth for
       older Ollama builds that ignore that flag.

    3. Unescaped inner quotes — the LLM may write a double-quote inside a
       string value without escaping it (e.g. the word "quoted" inside a longer
       value).  If the strict pass fails, _fix_unescaped_quotes repairs these
       and a second parse attempt is made.
    """
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    decoder = json.JSONDecoder()

    # Pass 1: strict parse on the original text
    for m in re.finditer(r"\{", cleaned):
        try:
            obj, _ = decoder.raw_decode(cleaned, m.start())
            return obj
        except json.JSONDecodeError:
            continue

    # Pass 2: repair unescaped inner quotes and retry
    repaired = _fix_unescaped_quotes(cleaned)
    for m in re.finditer(r"\{", repaired):
        try:
            obj, _ = decoder.raw_decode(repaired, m.start())
            return obj
        except json.JSONDecodeError:
            continue

    logger.warning("[llm] _extract_json: no valid JSON found in response. Raw output:\n%s", raw[:500])
    return {}


def _raw_chat(model, api_key, base_url, max_tokens, system, user, think=None, json_mode=False,
             temperature=None, seed=None):
    """Stdlib-only HTTP call. Tries OpenAI-compatible format first; falls back to Ollama's native API on 404."""
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": user})

    base = base_url.rstrip("/")
    headers = {"Content-Type": "application/json", "User-Agent": _USER_AGENT}
    is_ollama = not api_key or api_key.lower() == "ollama"
    if not is_ollama:
        headers["Authorization"] = "Bearer " + api_key

    seed_applied = seed is not None and _supports_seed(base)
    if seed is not None and not seed_applied:
        logger.debug("[llm] seed=%s requested but not applied -- provider at %s has no known seed support", seed, base)

    # ── attempt 1: OpenAI-compatible /chat/completions (retry on HTTP 429) ──
    body = {"model": model, "max_tokens": max_tokens, "messages": msgs}
    if think is not None and is_ollama:
        body["think"] = think
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if temperature is not None:
        body["temperature"] = temperature
    if seed_applied:
        body["seed"] = seed
    payload = json.dumps(body).encode()
    for attempt in range(_RATE_LIMIT_MAX_RETRIES + 1):
        req = urllib.request.Request(base + "/chat/completions", data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read())
                if temperature is not None or seed is not None:
                    logger.debug("[llm] evaluative call: temperature=%s seed=%s (applied=%s) system_fingerprint=%s",
                                temperature, seed, seed_applied, data.get("system_fingerprint"))
                return data["choices"][0]["message"]["content"] or ""
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break   # not an OpenAI-compatible endpoint — try Ollama native below
            if e.code == 429 and attempt < _RATE_LIMIT_MAX_RETRIES:
                time.sleep(_retry_after_seconds(e, attempt))
                continue
            _raise_http_error(e, api_key)

    # ── attempt 2: Ollama native /api/chat (older Ollama or base_url without /v1) ──
    host = base[:-3] if base.endswith("/v1") else base
    body = {"model": model, "messages": msgs, "stream": False, "options": {"num_predict": max_tokens}}
    if think is not None:
        body["think"] = think
    if json_mode:
        body["format"] = "json"
    if temperature is not None:
        body["options"]["temperature"] = temperature
    if seed is not None:
        # Ollama's native API accepts seed unconditionally via options.
        body["options"]["seed"] = seed
    payload = json.dumps(body).encode()
    req = urllib.request.Request(host + "/api/chat", data=payload,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": _USER_AGENT}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())["message"]["content"] or ""


# Providers with hard per-request output-token ceilings. Requesting more than
# the ceiling either 400s or silently truncates mid-JSON (which surfaces as
# _extract_json failures), so clamp at the dispatch choke point.
_MAX_OUTPUT_TOKENS_BY_HOST = {
    "models.github.ai": 4000,   # GitHub Models free tier: 4000 output tokens/request
}


def _cap_max_tokens(base_url, max_tokens):
    for host, cap in _MAX_OUTPUT_TOKENS_BY_HOST.items():
        if host in (base_url or ""):
            return min(max_tokens, cap)
    return max_tokens


def _sse_text(raw):
    """Concatenate assistant text out of an OpenAI-style SSE stream body.

    Returns None when `raw` doesn't look like SSE, so the caller can fall
    through to a clearer error rather than silently yielding "".
    """
    chunks, saw_data = [], False
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        saw_data = True
        payload = line[5:].strip()
        if payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        for choice in obj.get("choices") or []:
            # Streaming chunks carry `delta`; some gateways send whole `message`s.
            part = (choice.get("delta") or {}).get("content") or \
                   (choice.get("message") or {}).get("content")
            if part:
                chunks.append(part)
    return "".join(chunks) if saw_data else None


def _openai_response_text(response):
    """Pull the assistant's text out of an openai-SDK response.

    The SDK hands back the raw body as a plain `str` instead of a parsed object
    whenever the provider's Content-Type doesn't end in `json` AND the body
    isn't parseable as a single JSON document -- an SSE stream is the common
    case. Without this, that path died on `'str' object has no attribute
    'choices'`, which the generic handler then mislabelled as a network error.
    """
    if not isinstance(response, str):
        return response.choices[0].message.content or ""

    text = _sse_text(response)
    if text is not None:
        logger.debug("[llm] provider returned an SSE body; decoded %d chars", len(text))
        return text
    try:
        obj = json.loads(response)
    except json.JSONDecodeError:
        raise LLMError(
            "The provider returned a body this client could not parse (not JSON, not an "
            f"SSE stream). First 200 chars: {response[:200]!r}"
        ) from None
    try:
        return obj["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError(
            f"The provider returned an unexpected JSON shape: {str(obj)[:200]}"
        ) from None


def _call_llm(model, api_key, base_url, max_tokens, system, user, think=None, json_mode=False,
              temperature=None, seed=None):
    """Dispatch to the right backend. No package is required at import time."""
    # Platform addition: fail fast (non-retryable) when no key is configured,
    # so keyword-fallback code paths never burn the retry ladder on a dead call.
    # Ollama's sentinel key ("ollama") passes llm_is_available.
    if not llm_is_available(api_key):
        raise LLMError("No API key configured for this provider.")
    max_tokens = _cap_max_tokens(base_url, max_tokens)
    try:
        if _ANTHROPIC_HOST in base_url:
            try:
                import anthropic
            except ImportError:
                raise ImportError(
                    "The 'anthropic' package is required for the Claude provider. "
                    "Run: pip install anthropic"
                )
            client = anthropic.Anthropic(api_key=api_key)
            kwargs = {"model": model, "max_tokens": max_tokens,
                      "messages": [{"role": "user", "content": user}]}
            if system:
                kwargs["system"] = system
            if temperature is not None:
                kwargs["temperature"] = temperature
            if seed is not None:
                # Anthropic's Messages API has no seed parameter -- there is nothing to send.
                logger.debug("[llm] seed=%s requested but not applied -- Claude/Anthropic has no seed parameter", seed)
            response = client.messages.create(**kwargs)
            if temperature is not None or seed is not None:
                logger.debug("[llm] evaluative call: temperature=%s seed=%s (applied=False)", temperature, seed)
            return next((b.text for b in response.content if b.type == "text"), "")
        else:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key, base_url=base_url)
                msgs = []
                if system:
                    msgs.append({"role": "system", "content": system})
                msgs.append({"role": "user", "content": user})
                is_ollama = not api_key or api_key.lower() == "ollama"
                extra = {"extra_body": {"think": think}} if think is not None and is_ollama else {}
                if json_mode:
                    extra["response_format"] = {"type": "json_object"}
                if temperature is not None:
                    extra["temperature"] = temperature
                seed_applied = seed is not None and _supports_seed(base_url)
                if seed_applied:
                    extra["seed"] = seed
                elif seed is not None:
                    logger.debug("[llm] seed=%s requested but not applied -- provider at %s has no known seed support",
                                seed, base_url)
                response = client.chat.completions.create(model=model, max_tokens=max_tokens, messages=msgs,
                                                         stream=False, **extra)
                if temperature is not None or seed is not None:
                    logger.debug("[llm] evaluative call: temperature=%s seed=%s (applied=%s) system_fingerprint=%s",
                                temperature, seed, seed_applied, getattr(response, "system_fingerprint", None))
                return _openai_response_text(response)
            except ImportError:
                return _raw_chat(model, api_key, base_url, max_tokens, system, user, think=think, json_mode=json_mode,
                                 temperature=temperature, seed=seed)
    except KeyboardInterrupt:
        raise
    except LLMError:
        raise   # already carries an accurate, user-facing message
    except urllib.error.HTTPError as e:
        _raise_http_error(e, api_key)
    except (urllib.error.URLError, TimeoutError, socket.timeout) as e:
        # URLError covers DNS/connection failures; the timeouts cover read timeouts.
        # (HTTPError is a URLError subclass but is handled above.)
        raise ConnectionError(
            "Cannot reach the LLM API — network error or timeout. "
            "Check your base URL and connection."
        ) from e
    except Exception as e:
        # SDK clients (openai / anthropic) usually expose the HTTP status code.
        code = getattr(e, "status_code", None)
        if not isinstance(code, int):
            code = getattr(e, "code", None)
        if isinstance(code, int):
            if code == 429:
                raise LLMRateLimitError(_describe_http_status(code)) from e
            raise LLMError(_describe_http_status(code)) from e
        # The SDKs wrap transport failures in their own classes, which subclass
        # neither URLError nor TimeoutError. Match by name (rather than importing
        # openai/httpx here) so these stay retryable ConnectionErrors.
        if type(e).__name__ in _TRANSPORT_ERROR_NAMES:
            raise ConnectionError(
                "Cannot reach the LLM API — network error or timeout. "
                f"Check your base URL and connection. ({type(e).__name__}: {e})"
            ) from e
        # Otherwise: not a network failure and not an HTTP status -- almost always
        # a bug or a response shape this client doesn't handle. Naming the
        # exception beats blaming the network, which sends debugging in entirely
        # the wrong direction (the request may well have succeeded). Raising
        # LLMError rather than ConnectionError also stops the retry ladder from
        # burning 15s per call on something a retry cannot fix.
        logger.exception("[llm] unexpected failure calling %s", base_url)
        # SDK exception text can embed the provider's response body, which may
        # quote the rejected credential -- and this string reaches the browser.
        raise LLMError(
            _redact(f"Unexpected LLM client failure ({type(e).__name__}): {e}", api_key)
        ) from e


_RETRYABLE = (LLMRateLimitError, ConnectionError)
_CHAT_MAX_RETRIES = 3


def _with_retry(fn, *args, **kwargs):
    """Retry fn on transient failures (rate limits, network errors) with exponential backoff.

    Delays: 5 s → 10 s before attempts 2 and 3. Non-retryable errors (auth, bad
    request) are re-raised immediately without waiting.
    """
    for attempt in range(_CHAT_MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except _RETRYABLE:
            if attempt < _CHAT_MAX_RETRIES - 1:
                time.sleep(min(5 * 2 ** attempt, 60))
                continue
            raise


def llm_chat(model, system, message, api_key, base_url, temperature=None, seed=None):
    # Full structured response — used for evaluation and report generation.
    # think=False prevents thinking models from spending their token budget on
    # reasoning and truncating the JSON response.
    # temperature/seed default to None (unchanged provider-default sampling) so
    # every existing call site that doesn't pass them keeps its current behaviour.
    return _with_retry(_call_llm, model, api_key, base_url, 8192, system, message, think=False,
                       temperature=temperature, seed=seed)


def llm_chat_json(model, system, message, api_key, base_url, temperature=None, seed=None):
    # Like llm_chat but enables JSON mode (Ollama: format=json, OpenAI: response_format).
    # Uses a higher token budget (8192) because structured JSON responses with evidence
    # quotes and multi-field schemas are larger than typical prose completions.
    return _with_retry(_call_llm, model, api_key, base_url, 8192, system, message, think=False, json_mode=True,
                       temperature=temperature, seed=seed)


