"""Exit-criterion checks — Python port of TGFWA scripts/verify-entry.ts, run
against the SAME exemplar definitions (exported verbatim from the TS sources):

 - every product-channel evidence quote appears verbatim in the essay
 - every trace-channel evidence quote appears verbatim in a STUDENT turn,
   and its turnId points at that student turn
 - the adversarial parrot exemplar's trace channel contains no inflated scores
 - the expanded exemplars survive the live evidence-provenance guard
   (normalize_pass) unchanged — fabricated/assistant quotes get dropped
"""

import re

import pytest

from app.services.grading import exemplars as ex
from app.services.grading.engine import normalize_pass

DEFS = ex.load_exemplar_defs()


def normalize(s: str) -> str:
    return re.sub(r"[\"'‘’“”]", "'", re.sub(r"\s+", " ", s)).lower()


def test_exemplars_present():
    assert {d["id"] for d in DEFS} == {
        "exemplar-maya", "exemplar-jordan", "exemplar-sam", "exemplar-alex"}


@pytest.mark.parametrize("definition", DEFS, ids=lambda d: d["id"])
def test_evidence_quotes_verbatim(definition):
    essay = normalize(definition["essay"])
    student_turns = {t["turnId"]: normalize(t["text"])
                     for t in definition["trace"]["turns"] if t["speaker"] == "student"}

    for seed in definition["scoreSeeds"]:
        for ev in seed.get("evidence", []):
            q = normalize(ev["quote"])
            if seed["channel"] == "product":
                assert q in essay, \
                    f"{definition['id']} {seed['criterionId']}/product quote not in essay: {ev['quote']!r}"
            else:
                assert ev.get("turnId") is not None, \
                    f"{definition['id']} {seed['criterionId']}/trace evidence missing turnId"
                turn = student_turns.get(ev["turnId"])
                assert turn is not None, \
                    f"{definition['id']} {seed['criterionId']}/trace turnId {ev['turnId']} is not a student turn"
                assert q in turn, \
                    f"{definition['id']} {seed['criterionId']}/trace quote not in student turn {ev['turnId']}: {ev['quote']!r}"


@pytest.mark.parametrize("definition", DEFS, ids=lambda d: d["id"])
def test_layerb_segments_reference_real_turns(definition):
    turn_ids = {t["turnId"] for t in definition["trace"]["turns"]}
    for seg in definition["layerBSegments"]:
        for t in seg["segmentTurns"]:
            assert t in turn_ids, f"{definition['id']} layerB segment references missing turn {t}"


def test_parrot_trace_never_inflated():
    """Attribution-guard assertion: the parrot exemplar's trace passes must all be
    no-evidence or ≤1 (a naive grader would score 4-5 off the parroted text)."""
    alex = next(d for d in DEFS if d["id"] == "exemplar-alex")
    for seed in (s for s in alex["scoreSeeds"] if s["channel"] == "trace"):
        numeric = [p for p in seed["passes"] if isinstance(p, (int, float))]
        assert all(n <= 1 for n in numeric), \
            f"parrot trace inflated: {seed['criterionId']} passes {seed['passes']}"


def test_provenance_guard_keeps_real_exemplar_evidence():
    """The seeds' evidence must survive the live guard — otherwise the guard and
    the corpus disagree about what 'verbatim' means."""
    for definition in DEFS:
        source = {"essay": definition["essay"], "trace": definition["trace"]}
        for seed in definition["scoreSeeds"]:
            if not seed.get("evidence"):
                continue
            numeric = [p for p in seed["passes"] if isinstance(p, (int, float))]
            if not numeric:
                continue
            result = normalize_pass(
                {"evidence": seed["evidence"], "score": numeric[0], "selfConfidence": "med"},
                seed["channel"], source)
            assert result["score"] == numeric[0], \
                f"{definition['id']} {seed['criterionId']}/{seed['channel']} demoted by the guard"
            assert len(result["evidence"]) == len(seed["evidence"])


def test_provenance_guard_drops_fabricated_and_assistant_quotes():
    """Adversarial injections against the live guard."""
    alex = next(d for d in DEFS if d["id"] == "exemplar-alex")
    source = {"essay": alex["essay"], "trace": alex["trace"]}
    assistant_turn = next(t for t in alex["trace"]["turns"] if t["speaker"] == "assistant")

    # A fabricated quote on the product channel → dropped → pass demoted.
    fabricated = normalize_pass(
        {"evidence": [{"quote": "this sentence appears nowhere in the essay",
                       "reasoning": "x"}], "score": 5, "selfConfidence": "high"},
        "product", source)
    assert fabricated["score"] == "no-evidence"
    assert fabricated["evidence"] == []

    # An assistant-authored quote on the trace channel, even with a claimed
    # student turnId, fails the student-turn lookup → demoted.
    student_ids = [t["turnId"] for t in alex["trace"]["turns"] if t["speaker"] == "student"]
    parroted = normalize_pass(
        {"evidence": [{"turnId": student_ids[0],
                       "quote": assistant_turn["text"][:80], "reasoning": "x"}],
         "score": 5, "selfConfidence": "high"},
        "trace", source)
    assert parroted["score"] == "no-evidence"

    # A real student quote with the WRONG turnId gets its turnId corrected.
    student_turn = next(t for t in alex["trace"]["turns"] if t["speaker"] == "student"
                        and len(t["text"]) > 40)
    wrong_id = normalize_pass(
        {"evidence": [{"turnId": 99999, "quote": student_turn["text"][:60],
                       "reasoning": "x"}], "score": 3, "selfConfidence": "med"},
        "trace", source)
    assert wrong_id["score"] == 3
    assert wrong_id["evidence"][0]["turnId"] == student_turn["turnId"]


def test_expanded_exemplars_match_seed_semantics():
    """Expansion through the Python aggregate must preserve the seeds' medians —
    the cross-language check on the aggregate port."""
    from statistics import median as stat_median

    rubric = {"version": "1.0", "criteria": [
        {"criterionId": s["criterionId"], "standard": "", "dimension": "d",
         "statement": "", "anchors": {}, "referenceability": "strong", "source": ""}
        for s in DEFS[0]["scoreSeeds"]]}

    for definition in DEFS:
        expanded = ex.expand_exemplar(definition, rubric)
        by_key = {(r["criterion_id"], r["channel"]): r for r in expanded["scores"]}
        for seed in definition["scoreSeeds"]:
            rec = by_key[(seed["criterionId"], seed["channel"])]
            numeric = [p for p in seed["passes"] if isinstance(p, (int, float))]
            no_evidence = (len(seed["passes"]) - len(numeric)) > len(seed["passes"]) / 2 \
                or not numeric
            assert rec["no_evidence"] == no_evidence
            if not no_evidence:
                assert rec["median"] == stat_median(sorted(numeric))
