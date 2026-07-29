"""Unit tests for molding.py — the attempt-5 per-criterion style
reconciliation-note mechanism. These focus on the three defense layers
against a "note" becoming a disguised full anchor rewrite: structural input
restriction, output-side filtering, and cache-key correctness."""

import pytest

from app.db import database as db
from app.services.grading import molding

# These tests hit the style_molds cache table directly (no TestClient/fixture
# involved), so make sure the schema exists regardless of test collection order.
db.init_db()


def _rubric():
    return {
        "criteria": [
            {"criterionId": "W1a-1", "dimension": "Claims", "statement": "States a claim.",
             "anchors": {"0": "No claim.", "5": "Precise claim."}},
            {"criterionId": "W1d-1", "dimension": "Style & Tone",
             "statement": "Maintains a formal style.", "styleEligible": True,
             "anchors": {"0": "Consistently informal.", "5": "Formal and precise."}},
        ]
    }


def test_eligible_criteria_filters_by_flag():
    elig = molding.eligible_criteria(_rubric())
    assert [c["criterionId"] for c in elig] == ["W1d-1"]


def test_build_mold_prompt_omits_ineligible_criterion_text():
    rubric = _rubric()
    prompt = molding.build_mold_prompt(molding.eligible_criteria(rubric), "be lenient")
    assert "States a claim" not in prompt
    assert "No claim." not in prompt
    assert "Maintains a formal style" in prompt


def test_mold_notes_drops_note_for_non_eligible_criterion_id():
    rubric = _rubric()

    def fake_llm(system, prompt):
        return {"notes": [
            {"criterionId": "W1d-1", "note": "A real note."},
            {"criterionId": "W1a-1", "note": "Sneaky note for an ineligible criterion."},
        ]}

    notes = molding.mold_notes(fake_llm, rubric, "be lenient")
    assert "W1a-1" not in notes
    assert notes["W1d-1"] == "A real note."


def test_mold_notes_truncates_oversized_note():
    rubric = _rubric()
    long_note = "x" * 2000

    def fake_llm(system, prompt):
        return {"notes": [{"criterionId": "W1d-1", "note": long_note}]}

    notes = molding.mold_notes(fake_llm, rubric, "be lenient")
    assert len(notes["W1d-1"]) == molding.MAX_NOTE_CHARS


def test_mold_notes_retries_once_then_succeeds():
    rubric = _rubric()
    calls = {"n": 0}

    def flaky_llm(system, prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return {"notes": [{"criterionId": "W1d-1", "note": "ok"}]}

    notes = molding.mold_notes(flaky_llm, rubric, "be lenient")
    assert calls["n"] == 2
    assert notes["W1d-1"] == "ok"


def test_mold_notes_short_circuits_on_empty_style_or_no_eligible():
    rubric = _rubric()
    calls = {"n": 0}

    def counting_llm(system, prompt):
        calls["n"] += 1
        return {"notes": []}

    assert molding.mold_notes(counting_llm, rubric, "") == {}
    assert molding.mold_notes(counting_llm, {"criteria": []}, "be lenient") == {}
    assert calls["n"] == 0


def test_validate_mold_rejects_non_eligible_criterion_id():
    elig = molding.eligible_criteria(_rubric())
    assert not molding.validate_mold({"W1a-1": "sneaky"}, elig)


def test_validate_mold_rejects_anchor_rewrite_fingerprint():
    elig = molding.eligible_criteria(_rubric())
    rewrite = "0: No style at all.\n1: Barely.\n2: Some.\n3: Mostly.\n4: Good.\n5: Great."
    assert not molding.validate_mold({"W1d-1": rewrite}, elig)


def test_validate_mold_accepts_a_real_scoped_note():
    elig = molding.eligible_criteria(_rubric())
    assert molding.validate_mold({"W1d-1": "A short, scoped note."}, elig)


def test_get_or_mold_notes_cache_hit_avoids_second_llm_call():
    rubric = _rubric()
    calls = {"n": 0}

    def counting_llm(system, prompt):
        calls["n"] += 1
        return {"notes": [{"criterionId": "W1d-1", "note": "ok"}]}

    kwargs = dict(content_id="test-rubric", version="1.0", rubric=rubric,
                 grading_style="be lenient")
    first = molding.get_or_mold_notes(counting_llm, **kwargs)
    second = molding.get_or_mold_notes(counting_llm, **kwargs)
    assert first == second == {"W1d-1": "ok"}
    assert calls["n"] == 1


def test_get_or_mold_notes_cache_key_sensitive_to_style_text_and_version():
    rubric = _rubric()
    calls = {"n": 0}

    def counting_llm(system, prompt):
        calls["n"] += 1
        return {"notes": [{"criterionId": "W1d-1", "note": "ok"}]}

    molding.get_or_mold_notes(counting_llm, content_id="test-rubric-2", version="1.0",
                              rubric=rubric, grading_style="be lenient")
    molding.get_or_mold_notes(counting_llm, content_id="test-rubric-2", version="1.0",
                              rubric=rubric, grading_style="be lenient!")  # one char different
    molding.get_or_mold_notes(counting_llm, content_id="test-rubric-2", version="2.0",
                              rubric=rubric, grading_style="be lenient!")  # version bump
    assert calls["n"] == 3


def test_get_or_mold_notes_caches_validation_failure_as_empty():
    rubric = _rubric()
    calls = {"n": 0}

    def bad_llm(system, prompt):
        calls["n"] += 1
        return {"notes": [{"criterionId": "W1a-1", "note": "sneaky"}]}  # filtered to {} by mold_notes,
        # but exercise the validate_mold() path too via a rewrite-fingerprint case below

    result = molding.get_or_mold_notes(bad_llm, content_id="test-rubric-3", version="1.0",
                                       rubric=rubric, grading_style="be lenient")
    assert result == {}
    # Second call within the same cache key must not re-invoke the LLM.
    result2 = molding.get_or_mold_notes(bad_llm, content_id="test-rubric-3", version="1.0",
                                        rubric=rubric, grading_style="be lenient")
    assert result2 == {}
    assert calls["n"] == 1
