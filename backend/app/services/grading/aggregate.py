"""Pass aggregation for Mode A — line-for-line port of TGFWA
src/lib/grading/aggregate.ts.

Aggregates ≥3 grading passes into one score record: median score + inter-pass
spread; high spread or weak referenceability routes to the instructor.
Confidence = f(evidence count, inter-pass agreement, referenceability class).
"""

from datetime import datetime, timezone


def median(nums):
    s = sorted(nums)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def aggregate_passes(*, criterion_id: str, channel: str, referenceability: str,
                     passes: list, rubric_version: str,
                     style_note: str = "", style_intensity: str = "") -> dict:
    """passes: list of dicts {score: int|'no-evidence', selfConfidence, evidence, anchorMatched}.

    Returns a score record dict (snake_case keys, matching the score_records table).
    """
    numeric = [p["score"] for p in passes if isinstance(p["score"], (int, float))]
    no_evidence_count = len(passes) - len(numeric)
    # Majority no-evidence → the criterion did not surface in this source (expected
    # for some trace criteria); displayed, not imputed.
    no_evidence = no_evidence_count > len(passes) / 2 or not numeric

    med = None if no_evidence else median(numeric)
    spread = None if (no_evidence or len(numeric) < 2) else (max(numeric) - min(numeric))

    # Evidence from the pass whose score is closest to the median (representative pass).
    evidence = []
    anchor_matched = None
    style_applied = None
    if not no_evidence and med is not None:
        scored = [p for p in passes if isinstance(p["score"], (int, float))]
        rep = min(scored, key=lambda p: abs(p["score"] - med), default=None)
        if rep:
            evidence = rep.get("evidence", [])
            anchor_matched = rep.get("anchorMatched")
            style_applied = rep.get("styleApplied")
    elif passes:
        # No representative pass to speak of (no-evidence) — still surface the
        # model's own explanation for why the style didn't apply, if it gave one.
        style_applied = passes[0].get("styleApplied")

    distinct_evidence = len({e["quote"].strip().lower() for e in evidence})

    if no_evidence:
        confidence = "low"
    elif referenceability == "weak":
        confidence = "low"  # advisory-only class
    elif (spread or 0) >= 2:
        confidence = "low"  # disagreement across runs usually indicates criterion ambiguity
    elif distinct_evidence >= 2 and (spread or 0) <= 1:
        confidence = "high"
    else:
        confidence = "med"  # e.g. single evidence instance

    # Routing: teacher-reserve criteria and high-spread scores only. Single-evidence
    # records show medium confidence but are not queued — flagging every thin record
    # buries the signals the instructor actually needs to act on.
    review_reasons = []
    if referenceability == "weak":
        review_reasons.append(
            "Teacher-reserve criterion (weak referenceability) — LLM read is advisory only")
    if (spread or 0) >= 2:
        review_reasons.append(
            f"High inter-pass spread ({spread}) — possible rubric ambiguity or borderline case")

    return {
        "criterion_id": criterion_id,
        "channel": channel,
        "passes": [p["score"] for p in passes],
        "median": med,
        "spread": spread,
        "no_evidence": no_evidence,
        "confidence": confidence,
        "evidence": evidence,
        "anchor_matched": anchor_matched,
        "style_applied": style_applied,
        "style_hash": style_hash,
        "style_note": style_note,
        "style_intensity": style_intensity,
        "rubric_version": rubric_version,
        "graded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "override_score": None,
        "override_rationale": "",
        "override_ts": "",
        "needs_review": bool(review_reasons),
        "review_reasons": review_reasons,
    }
