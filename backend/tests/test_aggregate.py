"""Unit tests for the aggregate port (TGFWA aggregate.ts semantics)."""

from app.services.grading.aggregate import aggregate_passes, median


def _pass(score, evidence=None, style_applied=None):
    return {"score": score, "selfConfidence": "med",
            "evidence": evidence or [], "anchorMatched": None,
            "styleApplied": style_applied}


def agg(passes, referenceability="strong"):
    return aggregate_passes(criterion_id="C1", channel="product",
                            referenceability=referenceability,
                            passes=passes, rubric_version="1.0")


def test_median_even_and_odd():
    assert median([3]) == 3
    assert median([1, 4]) == 2.5
    assert median([4, 1, 3]) == 3


def test_median_and_spread():
    r = agg([_pass(3), _pass(4), _pass(3)])
    assert r["median"] == 3
    assert r["spread"] == 1
    assert not r["no_evidence"]


def test_majority_no_evidence_wins():
    r = agg([_pass("no-evidence"), _pass("no-evidence"), _pass(4)])
    assert r["no_evidence"]
    assert r["median"] is None
    assert r["spread"] is None
    assert r["confidence"] == "low"
    assert r["evidence"] == []


def test_minority_no_evidence_keeps_score():
    r = agg([_pass(4), _pass(4), _pass("no-evidence")])
    assert not r["no_evidence"]
    assert r["median"] == 4


def test_representative_evidence_from_pass_closest_to_median():
    ev_a = [{"quote": "aaa", "reasoning": ""}]
    ev_b = [{"quote": "bbb", "reasoning": ""}]
    r = agg([_pass(1, ev_a), _pass(4, ev_b), _pass(4, ev_b)])
    assert r["median"] == 4
    assert r["evidence"] == ev_b


def test_high_spread_routes_to_review_with_low_confidence():
    r = agg([_pass(1), _pass(3), _pass(5)])
    assert r["spread"] == 4
    assert r["confidence"] == "low"
    assert r["needs_review"]
    assert any("spread" in reason.lower() for reason in r["review_reasons"])


def test_weak_referenceability_always_routed_and_low_confidence():
    r = agg([_pass(4), _pass(4), _pass(4)], referenceability="weak")
    assert r["confidence"] == "low"
    assert r["needs_review"]
    assert any("advisory" in reason.lower() for reason in r["review_reasons"])


def test_two_distinct_quotes_low_spread_is_high_confidence():
    ev = [{"quote": "first quote", "reasoning": ""}, {"quote": "second quote", "reasoning": ""}]
    r = agg([_pass(4, ev), _pass(4, ev), _pass(5, ev)])
    assert r["confidence"] == "high"
    assert not r["needs_review"]


def test_single_quote_is_medium_confidence_not_queued():
    ev = [{"quote": "only one", "reasoning": ""}]
    r = agg([_pass(4, ev), _pass(4, ev), _pass(4, ev)])
    assert r["confidence"] == "med"
    assert not r["needs_review"]


def test_style_applied_carried_from_pass_closest_to_median():
    r = agg([_pass(1, style_applied="a"), _pass(4, style_applied="b"),
              _pass(4, style_applied="b")])
    assert r["median"] == 4
    assert r["style_applied"] == "b"


def test_style_applied_falls_back_to_first_pass_when_no_evidence():
    r = agg([_pass("no-evidence", style_applied="no style was given"),
              _pass("no-evidence"), _pass(4)])
    assert r["no_evidence"]
    assert r["style_applied"] == "no style was given"
