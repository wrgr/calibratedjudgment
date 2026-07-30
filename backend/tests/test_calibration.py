"""Unit tests for calibration.py — idea #2's LLM-drafted teacherGuidance
patches. This module only ever drafts; api/content.py is what stages the
result as an inactive rubric version (see test_content.py for that half)."""

from app.services.grading import calibration


def _criterion(teacher_guidance=""):
    return {
        "criterionId": "W1d-1", "dimension": "Style & Tone",
        "statement": "Maintains a formal style.",
        "teacherGuidance": teacher_guidance,
        "anchors": {"0": "Consistently informal.", "5": "Formal and precise."},
    }


def _override_row(median=4, override_score=1, rationale="Too informal for this assignment."):
    return {"median": median, "override_score": override_score, "override_rationale": rationale}


def test_build_calibration_prompt_includes_corrections_and_current_guidance():
    prompt = calibration.build_calibration_prompt(
        _criterion("Existing note."), "Existing note.",
        [_override_row(), _override_row(median=3, override_score=1)])
    assert "Existing note." in prompt
    assert "LLM scored 4, instructor corrected to 1" in prompt
    assert "Too informal for this assignment." in prompt


def test_draft_guidance_returns_none_with_no_overrides():
    def fake_llm(system, prompt):
        return {"teacherGuidance": "should never be called"}
    assert calibration.draft_guidance(fake_llm, _criterion(), "", []) is None


def test_draft_guidance_returns_stripped_text_on_valid_response():
    def fake_llm(system, prompt):
        return {"teacherGuidance": "  Score informal diction strictly per the anchors.  "}
    draft = calibration.draft_guidance(fake_llm, _criterion(), "", [_override_row()] * 3)
    assert draft == "Score informal diction strictly per the anchors."


def test_draft_guidance_retries_once_then_succeeds():
    calls = {"n": 0}

    def flaky_llm(system, prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return {"teacherGuidance": "Recovered draft."}
    draft = calibration.draft_guidance(flaky_llm, _criterion(), "", [_override_row()] * 3)
    assert draft == "Recovered draft."
    assert calls["n"] == 2


def test_draft_guidance_none_on_malformed_response():
    def fake_llm(system, prompt):
        return {"notTheRightKey": "oops"}
    assert calibration.draft_guidance(fake_llm, _criterion(), "", [_override_row()] * 3) is None


def test_validate_guidance_draft_rejects_empty():
    assert calibration.validate_guidance_draft("") is False
    assert calibration.validate_guidance_draft("   ") is False


def test_validate_guidance_draft_rejects_oversized():
    huge = "x" * (calibration.MAX_GUIDANCE_CHARS + 1)
    assert calibration.validate_guidance_draft(huge) is False


def test_validate_guidance_draft_rejects_anchor_fingerprint():
    draft = "See ANCHORED LEVELS above for guidance."
    assert calibration.validate_guidance_draft(draft) is False

    multi_line_anchors = "0: informal\n5: formal\nDo whatever these say."
    assert calibration.validate_guidance_draft(multi_line_anchors) is False


def test_validate_guidance_draft_accepts_a_real_guidance_text():
    draft = ("Score strictly on register: informal diction should not be excused as "
             "voice, even when the argument is otherwise strong.")
    assert calibration.validate_guidance_draft(draft) is True
