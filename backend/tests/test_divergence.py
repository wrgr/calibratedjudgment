"""Divergence port: effective-score override rule, per-dimension medians, frames."""

from app.services.grading.divergence import (compute_divergence, effective_score,
                                             interpret_divergence)

RUBRIC = {
    "version": "1.0",
    "criteria": [
        {"criterionId": "A1", "standard": "S.A", "dimension": "Claims"},
        {"criterionId": "A2", "standard": "S.A", "dimension": "Claims"},
        {"criterionId": "B1", "standard": "S.B", "dimension": "Evidence"},
    ],
}


def rec(cid, channel, med, no_evidence=False, override=None):
    r = {"criterion_id": cid, "channel": channel, "median": med,
         "no_evidence": no_evidence, "override_score": None, "override_ts": ""}
    if override is not None:
        r["override_score"] = override
        r["override_ts"] = "2026-01-01T00:00:00Z"
    return r


def test_override_wins_and_no_evidence_is_none():
    assert effective_score(rec("A1", "trace", 2, override=5)) == 5
    assert effective_score(rec("A1", "trace", 2, no_evidence=True)) is None
    assert effective_score(rec("A1", "trace", 2)) == 2


def test_per_dimension_divergence():
    scores = [
        rec("A1", "trace", 2), rec("A1", "product", 4),
        rec("A2", "trace", 3), rec("A2", "product", 5),
        rec("B1", "trace", 4, no_evidence=True), rec("B1", "product", 3),
    ]
    dims = {d["dimension"]: d for d in compute_divergence(RUBRIC, scores)}
    claims = dims["Claims"]
    assert claims["traceScore"] == 2.5
    assert claims["productScore"] == 4.5
    assert claims["divergence"] == 2
    evidence = dims["Evidence"]
    assert evidence["traceScore"] is None
    assert evidence["divergence"] is None


def test_interpretation_overreliance_flag():
    dims = [{"dimension": "Claims", "standard": "", "traceScore": 2,
             "productScore": 4, "divergence": 2, "criterionIds": []}]
    layer_b = {"interpretiveLabel": "thoughtless", "dominantResponseUse": "passive",
               "verificationRate": 0.0}
    out = interpret_divergence(dims, layer_b)
    assert out["tone"] == "flag"
    assert "over-reliance" in out["headline"]


def test_interpretation_execution_gap():
    dims = [{"dimension": "Claims", "standard": "", "traceScore": 4,
             "productScore": 2, "divergence": -2, "criterionIds": []}]
    out = interpret_divergence(dims, None)
    assert out["tone"] == "target"


def test_interpretation_convergent_constructive():
    dims = [{"dimension": "Claims", "standard": "", "traceScore": 4,
             "productScore": 4, "divergence": 0, "criterionIds": []}]
    layer_b = {"interpretiveLabel": "collaborative", "dominantResponseUse": "constructive",
               "verificationRate": 0.8}
    out = interpret_divergence(dims, layer_b)
    assert out["tone"] == "valid"


def test_interpretation_no_overlap():
    dims = [{"dimension": "Claims", "standard": "", "traceScore": None,
             "productScore": 4, "divergence": None, "criterionIds": []}]
    out = interpret_divergence(dims, None)
    assert out["tone"] == "neutral"
    assert "Not enough" in out["headline"]
