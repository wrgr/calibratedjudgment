"""Idea #2 of the override-calibration follow-up: drafts a proposed
`teacherGuidance` replacement for a criterion the reliability dashboard has
flagged as consistently miscalibrated (see database.py's
CALIBRATION_MIN_OVERRIDES / CALIBRATION_AVG_DELTA_THRESHOLD and
mode_a_reliability_stats' needs_calibration_review).

This module only ever DRAFTS — it never writes to the live rubric. The
caller (api/content.py) stages the result as an inactive content_items row;
a staff member has to explicitly publish it before it affects a single
grading call. Mirrors molding.py's separation of concerns: `anchors` (the
rubric's ground truth) are shown to the model as read-only context and are
never eligible to be rewritten, only `teacherGuidance` (already an
explicitly instructional, editable field — see prompts.py's
_guidance_block) is.
"""

from .prompts import _anchors_block

MAX_GUIDANCE_CHARS = 600  # generous vs. molding's MAX_NOTE_CHARS — teacherGuidance can run longer


def build_calibration_system() -> str:
    return (
        "You help an instructor spot and correct a pattern in how an LLM has been "
        "misgrading ONE rubric criterion, using a set of the instructor's own prior "
        "corrections as evidence. Propose replacement guidance text for that "
        "criterion's `teacherGuidance` field.\n\n"
        "Rules (non-negotiable):\n"
        "1. Output the COMPLETE replacement text for teacherGuidance — not a diff, "
        "not an addition to append, a full replacement a rater would read on its own.\n"
        "2. Do NOT rewrite, quote at length, or restate the anchor level descriptions. "
        "You may refer to them only in your own words, briefly.\n"
        "3. Do NOT change what floor behavior (level 0/1) means — a genuinely absent "
        "or incoherent effort must still score at the floor.\n"
        "4. Base the guidance only on the pattern actually visible across the "
        "corrections given — do not invent a rationale beyond what the evidence "
        "supports, and do not address any criterion other than the one given.\n"
        "5. Keep it concise: a rater-facing instruction, not an essay.\n"
        "6. Output only the JSON object.\n\n"
        "OUTPUT — a single JSON object, exactly this shape:\n"
        '{"teacherGuidance": "<complete replacement guidance text>"}'
    )


def build_calibration_prompt(criterion: dict, current_guidance: str, override_rows: list) -> str:
    corrections_block = "\n\n".join(
        f"- LLM scored {r['median']}, instructor corrected to {r['override_score']}. "
        f"Instructor's rationale: {r['override_rationale']}"
        for r in override_rows
    )
    return f"""CRITERION {criterion['criterionId']} ({criterion.get('dimension', '')}): {criterion['statement']}

ANCHORED LEVELS (0-5) — for context only, do not restate these:
{_anchors_block(criterion)}

CURRENT teacherGuidance (may be empty):
<<<
{current_guidance.strip()}
>>>

INSTRUCTOR CORRECTIONS TO LEARN FROM:
{corrections_block}

Propose complete replacement guidance for this criterion's teacherGuidance field
that would help a future LLM rater avoid the pattern shown in these corrections."""


def draft_guidance(llm_json, criterion: dict, current_guidance: str,
                   override_rows: list) -> str | None:
    """One LLM call (one retry on transient failure). Returns the proposed
    replacement text, or None if the response was structurally invalid —
    filtering that happens regardless of what validate_guidance_draft later
    decides, so a caller of draft_guidance alone never sees a malformed
    result."""
    if not override_rows:
        return None

    system = build_calibration_system()
    prompt = build_calibration_prompt(criterion, current_guidance, override_rows)
    try:
        raw = llm_json(system, prompt)
    except Exception:
        raw = llm_json(system, prompt)  # one retry, mirrors mold_notes

    raw = raw if isinstance(raw, dict) else {}
    draft = raw.get("teacherGuidance")
    if not isinstance(draft, str) or not draft.strip():
        return None
    return draft.strip()


def validate_guidance_draft(draft: str) -> bool:
    """Golden/regression gate: rejects a draft that's empty, oversized, or
    carries an anchor-rewrite fingerprint — guidance masquerading as a full
    anchor restatement."""
    if not isinstance(draft, str) or not draft.strip():
        return False
    if len(draft) > MAX_GUIDANCE_CHARS:
        return False
    if "ANCHORED LEVELS" in draft:
        return False
    anchor_line_count = sum(
        1 for line in draft.splitlines()
        if len(line.strip()) > 2 and line.strip()[0].isdigit() and line.strip()[1] == ":"
    )
    if anchor_line_count >= 2:
        return False
    return True
