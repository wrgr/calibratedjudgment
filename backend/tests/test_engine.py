"""Unit tests for engine._style_status and normalize_pass's styleApplied
handling: styleApplied is a free-text model claim, so the server enforces it
can't be fabricated — for any of the three non-"applied" states, the forced
guard text overrides whatever the model itself claims."""

from app.services.grading import engine


def _raw(**overrides):
    base = {"score": 4, "evidence": [], "anchorMatched": None, "selfConfidence": "high"}
    base.update(overrides)
    return base


def _criterion(style_eligible=False):
    return {"criterionId": "C1", "styleEligible": style_eligible}


def test_style_status_none_when_no_style_set():
    assert engine._style_status(_criterion(), "", "") == "none"


def test_style_status_applied_when_note_present():
    assert engine._style_status(_criterion(True), "be lenient", "a note") == "applied"


def test_style_status_unavailable_when_eligible_but_no_note():
    assert engine._style_status(_criterion(True), "be lenient", "") == "unavailable"


def test_style_status_ineligible_when_not_eligible_and_no_note():
    assert engine._style_status(_criterion(False), "be lenient", "") == "ineligible"


def test_style_applied_passthrough_when_well_formed():
    p = engine.normalize_pass(_raw(styleApplied="Weighted clarity per the stated style."),
                              "product", {"essay": ""}, style_status="applied")
    assert p["styleApplied"] == "Weighted clarity per the stated style."


def test_style_applied_fallback_when_missing_but_applied():
    p = engine.normalize_pass(_raw(), "product", {"essay": ""}, style_status="applied")
    assert p["styleApplied"] == "Model did not report how the grading style was applied."


def test_style_applied_fallback_when_non_string():
    p = engine.normalize_pass(_raw(styleApplied=42), "product", {"essay": ""},
                              style_status="applied")
    assert p["styleApplied"] == "Model did not report how the grading style was applied."


def test_style_applied_forced_when_no_style_provided():
    p = engine.normalize_pass(_raw(styleApplied="I applied the teacher's lenient style."),
                              "product", {"essay": ""}, style_status="none")
    assert p["styleApplied"] == "No instructor grading style was provided."


def test_style_applied_forced_when_ineligible_overrides_model_claim():
    """Core anti-hallucination guarantee for attempt 5: even if the model
    claims it applied the style, an ineligible criterion's guard text wins."""
    p = engine.normalize_pass(_raw(styleApplied="I definitely applied the lenient style here."),
                              "product", {"essay": ""}, style_status="ineligible")
    assert "does not apply to it" in p["styleApplied"]


def test_style_applied_forced_when_unavailable():
    p = engine.normalize_pass(_raw(styleApplied="I applied it anyway."),
                              "product", {"essay": ""}, style_status="unavailable")
    assert "could not be safely generated" in p["styleApplied"]


def test_numeric_score_with_no_evidence_key_is_demoted():
    """A model can claim a score with zero evidence attached (omitting the
    `evidence` field, rather than supplying evidence that gets rejected) —
    the guard must catch this case too, not just the "evidence was fabricated"
    case, or the "no score without evidence" invariant has a hole."""
    raw = {"score": 4, "anchorMatched": "some anchor", "selfConfidence": "high"}
    p = engine.normalize_pass(raw, "product", {"essay": "The essay text."})
    assert p["score"] == "no-evidence"
    assert p["evidence"] == []
