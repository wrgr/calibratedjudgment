"""Trace-vs-product divergence — port of TGFWA src/lib/divergence.ts.

Both channels score the same atomic criteria, so per-dimension divergence is
apples-to-apples. Interpretive frames are surfaced as HYPOTHESES, not verdicts.
"""

from .aggregate import median


def effective_score(record: dict):
    """Instructor override wins (the teacher is authoritative); no-evidence → None."""
    if record.get("override_ts"):
        return record.get("override_score")
    return None if record.get("no_evidence") else record.get("median")


def compute_divergence(rubric: dict, scores: list) -> list:
    dims = {}
    for c in rubric.get("criteria", []):
        d = dims.setdefault(c["dimension"], {"standard": c["standard"], "criterionIds": []})
        d["criterionIds"].append(c["criterionId"])

    by_key = {(s["criterion_id"], s["channel"]): s for s in scores}

    result = []
    for dimension, info in dims.items():
        def chan(channel):
            vals = [effective_score(by_key[(cid, channel)])
                    for cid in info["criterionIds"] if (cid, channel) in by_key]
            vals = [v for v in vals if v is not None]
            return median(vals) if vals else None

        trace_score = chan("trace")
        product_score = chan("product")
        result.append({
            "dimension": dimension,
            "standard": info["standard"],
            "traceScore": trace_score,
            "productScore": product_score,
            "divergence": (product_score - trace_score
                           if trace_score is not None and product_score is not None else None),
            "criterionIds": info["criterionIds"],
        })
    return result


def interpret_divergence(dims: list, layer_b: dict | None) -> dict:
    """Interpretive frames — surfaced as hypotheses, not verdicts."""
    with_both = [d for d in dims if d["divergence"] is not None]
    if not with_both:
        return {
            "headline": "Not enough overlapping evidence to compare channels",
            "detail": ("Most criteria surfaced in only one channel. This is expected for "
                       "short dialogues — no divergence inference is made."),
            "tone": "neutral",
        }
    mean = sum(d["divergence"] for d in with_both) / len(with_both)
    passive_reliance = layer_b is not None and (
        layer_b.get("interpretiveLabel") == "thoughtless"
        or (layer_b.get("dominantResponseUse") == "passive"
            and layer_b.get("verificationRate", 0) < 0.3)
    )
    constructive = layer_b is not None and layer_b.get("interpretiveLabel") == "collaborative"

    if mean >= 1 and passive_reliance:
        return {
            "headline": "Hypothesis: possible over-reliance — essay quality may not reflect student capability",
            "detail": ("Product scores substantially exceed trace-inferred mastery, and the "
                       "reliance profile is passive/thoughtless. The polish of the final essay "
                       "may come from the AI rather than the student. Formative flag: probe the "
                       "flagged dimensions in conference or an unassisted task."),
            "tone": "flag",
        }
    if mean >= 1:
        return {
            "headline": "Product exceeds trace — interpret with the reliance profile in mind",
            "detail": ("The final essay scores higher than the dialogue-inferred estimates. The "
                       "reliance profile does not look passive, so this may reflect "
                       "drafting/revision work not visible in the dialogue — but verify before "
                       "crediting."),
            "tone": "neutral",
        }
    if mean <= -1:
        return {
            "headline": "Hypothesis: execution gap — understanding shown in dialogue, not in the artifact",
            "detail": ("Trace-inferred mastery exceeds the product scores: the student "
                       "demonstrates understanding in conversation but fails to execute it in "
                       "the essay. Instructional target is transfer/execution (drafting, time, "
                       "integration), not concepts."),
            "tone": "target",
        }
    if constructive:
        return {
            "headline": "Channels converge with constructive engagement — strongest validity for these scores",
            "detail": ("Trace and product estimates agree, and the student engaged "
                       "constructively with the AI. Divergence analysis raises no flags; the "
                       "rubric scores can be read at face value (pending teacher review of "
                       "routed items)."),
            "tone": "valid",
        }
    return {
        "headline": "Channels roughly converge",
        "detail": ("Trace and product estimates agree within one point on average. Review "
                   "per-dimension rows for local exceptions."),
        "tone": "neutral",
    }
