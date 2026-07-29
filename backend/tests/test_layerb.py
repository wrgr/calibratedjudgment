"""Unit tests for layerb.code_layer_b / summarize_segments hardening:
retry-once on failure, drop (never fabricate) a malformed segment coding,
and an honest "undetermined" label instead of a false "thoughtless" verdict
when there's nothing codeable."""

from app.services.grading import layerb


def _trace(turns):
    return {"turns": turns}


def _student(tid, text):
    return {"turnId": tid, "speaker": "student", "text": text}


def _assistant(tid, text):
    return {"turnId": tid, "speaker": "assistant", "text": text}


def test_summarize_segments_empty_is_undetermined_not_thoughtless():
    r = layerb.summarize_segments([])
    assert r["interpretiveLabel"] == "undetermined"
    assert r["verificationRate"] == 0
    assert r["segments"] == []


def test_code_layer_b_retries_once_then_succeeds():
    trace = _trace([_assistant(0, "How can I help?"), _student(1, "Help me with my thesis.")])
    calls = {"n": 0}

    def flaky_llm(system, prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient provider error")
        return {"helpSeeking": "active", "responseUse": "active",
                "verification": False, "evidence": "asked a targeted question"}

    result = layerb.code_layer_b(flaky_llm, trace)
    assert calls["n"] == 2
    assert result["interpretiveLabel"] != "undetermined"


def test_code_layer_b_drops_malformed_segment_instead_of_fabricating():
    trace = _trace([_assistant(0, "How can I help?"), _student(1, "Help me with my thesis.")])

    def bad_llm(system, prompt):
        return {"helpSeeking": "not-a-real-mode", "responseUse": None}

    result = layerb.code_layer_b(bad_llm, trace)
    # No codeable segments survived -> honest "undetermined", not a fabricated "active".
    assert result["interpretiveLabel"] == "undetermined"
    assert result["segments"] == []


def test_trace_with_no_student_turns_is_undetermined():
    trace = _trace([_assistant(0, "Welcome."), _assistant(1, "Let me know if you need help.")])

    def llm(system, prompt):
        raise AssertionError("should never be called — no student turns to segment")

    result = layerb.code_layer_b(llm, trace)
    assert result["interpretiveLabel"] == "undetermined"
