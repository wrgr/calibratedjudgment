"""Layer B: RelianceScope 3×3 AI-reliance coding — port of TGFWA src/lib/layerb.ts.

Layer B describes HOW the student worked with the AI (help-seeking × response-use
per segment, verification behavior, interpretive label per Hou et al. 2025).
It is never blended with Layer A writing-mastery scores.
"""

from .prompts import build_segment_prompt, build_segment_system

MODES = ("passive", "active", "constructive")


def segment_trace(trace: dict) -> list:
    """Split the dialogue into segments: each student turn plus the assistant reply
    that follows it (and the assistant turn it responds to, for context)."""
    segments = []
    turns = trace.get("turns", [])
    for i, turn in enumerate(turns):
        if turn.get("speaker") != "student":
            continue
        seg = []
        if i > 0 and turns[i - 1].get("speaker") == "assistant":
            seg.append(turns[i - 1])
        seg.append(turn)
        if i + 1 < len(turns) and turns[i + 1].get("speaker") == "assistant":
            seg.append(turns[i + 1])
        segments.append(seg)
    return segments


def summarize_segments(segments: list) -> dict:
    if not segments:
        # No codeable student-authored interaction at all (empty trace, or every
        # segment below failed to code even after retry) — a "thoughtless"/etc.
        # label would assert a value judgment about behavior that never happened.
        return {
            "segments": [],
            "grid": {h: {m: 0 for m in MODES} for h in MODES},
            "dominantHelpSeeking": "passive",
            "dominantResponseUse": "passive",
            "interpretiveLabel": "undetermined",
            "verificationRate": 0,
        }

    grid = {h: {m: 0 for m in MODES} for h in MODES}
    for s in segments:
        grid[s["helpSeeking"]][s["responseUse"]] += 1

    def count(dim, mode):
        return sum(1 for s in segments if s[dim] == mode)

    def dominant(dim):
        best = "passive"
        for m in MODES:
            if count(dim, m) > count(dim, best):
                best = m
        return best

    dominant_help_seeking = dominant("helpSeeking")
    dominant_response_use = dominant("responseUse")
    verification_rate = (sum(1 for s in segments if s["verification"]) / len(segments)
                         if segments else 0)

    # Interpretive label heuristic per Hou et al. (2025): a hypothesis, not a verdict.
    if dominant_response_use == "passive" and verification_rate < 0.2:
        label = "thoughtless"
    elif dominant_response_use == "constructive" and dominant_help_seeking == "constructive":
        label = "collaborative"
    elif verification_rate >= 0.5:
        label = "reflective"
    else:
        label = "cautious"

    return {
        "segments": segments,
        "grid": grid,
        "dominantHelpSeeking": dominant_help_seeking,
        "dominantResponseUse": dominant_response_use,
        "interpretiveLabel": label,
        "verificationRate": verification_rate,
    }


def code_layer_b(llm_json, trace: dict, on_progress=None) -> dict:
    raw_segments = segment_trace(trace)
    codings = []
    for done, seg in enumerate(raw_segments, start=1):
        text = "\n\n".join(f"[turn {t['turnId']} | {t['speaker'].upper()}]\n{t['text']}"
                           for t in seg)
        try:
            raw = llm_json(build_segment_system(), build_segment_prompt(text))
        except Exception:
            raw = llm_json(build_segment_system(), build_segment_prompt(text))  # one retry, mirrors grade_criterion
        raw = raw if isinstance(raw, dict) else {}
        help_seeking, response_use = raw.get("helpSeeking"), raw.get("responseUse")
        if help_seeking not in MODES or response_use not in MODES:
            # Malformed/unparseable coding for this segment — drop it rather
            # than fabricate a value (mirrors engine.normalize_pass's guard).
            if on_progress:
                on_progress(done, len(raw_segments))
            continue
        codings.append({
            "segmentTurns": [t["turnId"] for t in seg],
            "helpSeeking": help_seeking,
            "responseUse": response_use,
            "verification": bool(raw.get("verification")),
            "evidence": raw.get("evidence", ""),
        })
        if on_progress:
            on_progress(done, len(raw_segments))
    return summarize_segments(codings)
