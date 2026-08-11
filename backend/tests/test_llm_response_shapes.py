"""Response decoding and failure classification in core.llm.

Regression origin: grading against TAMU's gateway died with
`'str' object has no attribute 'choices'`, which the generic handler reported as
"Cannot reach the LLM API. Check your API key, base URL, and network." — a
network diagnosis for a request that had actually succeeded. The openai SDK
returns the raw body as a `str` (rather than a parsed object) whenever the
provider's Content-Type doesn't end in `json` and the body isn't a single JSON
document; an SSE stream hits both conditions.
"""

import json
import types

import pytest

from app.core import llm


def _parsed(content):
    """A stand-in for the SDK's parsed ChatCompletion object."""
    msg = types.SimpleNamespace(content=content)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


# ── the normal, parsed path still works ───────────────────────────────────────

def test_parsed_object_unchanged():
    assert llm._openai_response_text(_parsed("hello")) == "hello"


def test_parsed_object_none_content_becomes_empty_string():
    assert llm._openai_response_text(_parsed(None)) == ""


# ── SSE bodies (the TAMU case) ────────────────────────────────────────────────

SSE = (
    'data: {"choices":[{"delta":{"content":"{\\"score\\":"}}]}\n\n'
    'data: {"choices":[{"delta":{"content":" 4}"}}]}\n\n'
    'data: [DONE]\n\n'
)


def test_sse_stream_is_decoded():
    assert llm._openai_response_text(SSE) == '{"score": 4}'


def test_sse_with_whole_messages_instead_of_deltas():
    body = 'data: {"choices":[{"message":{"content":"whole"}}]}\ndata: [DONE]\n'
    assert llm._openai_response_text(body) == "whole"


def test_sse_decoded_output_survives_json_extraction():
    # The decoded text is what _extract_json sees downstream during grading.
    assert llm._extract_json(llm._openai_response_text(SSE)) == {"score": 4}


def test_sse_tolerates_unparseable_chunks():
    body = 'data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: not-json\ndata: [DONE]\n'
    assert llm._openai_response_text(body) == "ok"


def test_non_sse_returns_none_from_sse_helper():
    # So the caller falls through to a clearer error instead of yielding "".
    assert llm._sse_text("just some prose") is None


# ── plain-JSON body served with the wrong Content-Type ────────────────────────

def test_json_string_body_is_decoded():
    body = json.dumps({"choices": [{"message": {"content": "hi"}}]})
    assert llm._openai_response_text(body) == "hi"


# ── unparseable bodies raise something actionable ─────────────────────────────

def test_html_body_raises_llm_error_naming_the_content():
    with pytest.raises(llm.LLMError) as ei:
        llm._openai_response_text("<html><body>Access denied</body></html>")
    assert "could not parse" in str(ei.value)
    assert "Access denied" in str(ei.value)


def test_unexpected_json_shape_raises_llm_error():
    with pytest.raises(llm.LLMError) as ei:
        llm._openai_response_text('{"detail": "no completion here"}')
    assert "unexpected JSON shape" in str(ei.value)
    assert "no completion here" in str(ei.value)


# ── failure classification ────────────────────────────────────────────────────

class _FakeConnErr(Exception):
    pass


_FakeConnErr.__name__ = "APIConnectionError"


def _call(exc, base="https://gw.example/openai"):
    """Drive _call_llm's dispatch with a client that raises `exc`."""
    import openai

    class _Boom:
        def __init__(self, *a, **k):
            self.chat = types.SimpleNamespace(
                completions=types.SimpleNamespace(create=self._raise))

        def _raise(self, *a, **k):
            raise exc

    return openai, _Boom


def test_transport_errors_stay_retryable_connection_errors(monkeypatch):
    import openai
    monkeypatch.setattr(openai, "OpenAI", _call(_FakeConnErr("dns down"))[1])
    with pytest.raises(ConnectionError) as ei:
        llm._call_llm("m", "sk-key", "https://gw.example/openai", 16, "s", "u")
    assert "APIConnectionError" in str(ei.value)
    assert ConnectionError in llm._RETRYABLE


def test_shape_bugs_are_not_reported_as_network_failures(monkeypatch):
    import openai
    boom = AttributeError("'str' object has no attribute 'choices'")
    monkeypatch.setattr(openai, "OpenAI", _call(boom)[1])
    with pytest.raises(llm.LLMError) as ei:
        llm._call_llm("m", "sk-key", "https://gw.example/openai", 16, "s", "u")
    msg = str(ei.value)
    assert "AttributeError" in msg
    # The old behaviour: a network diagnosis for a non-network failure.
    assert "Check your API key, base URL, and network" not in msg
    # And it must not be retried -- a retry cannot fix a shape bug.
    assert not isinstance(ei.value, llm._RETRYABLE)
