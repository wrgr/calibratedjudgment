"""Attempt 5: per-criterion grading-style "reconciliation notes."

Attempt 4 folded an instructor's raw free-text grading_style straight into
every scoring prompt, and found (via manual live-provider testing) that the
model treats it as decorative next to the literal ANCHORED LEVELS text it's
told is non-negotiable — reporting "no effect" even on criteria the style
should obviously move.

Rather than rewriting the rubric's anchor text (risks the mold being "too
strong" — grade inflation, lost rigor), this module generates a small, scoped
note per criterion, gated by an explicit `styleEligible` allowlist in the
rubric JSON (only criteria about HOW the argument is expressed — tone,
register, mechanics — never WHAT is argued). The note is molded once per
(rubric content_id, version, grading_style text) triple, always derived from
the pristine rubric baseline (never from a prior mold), and cached — so
editing the style by one character produces a fresh mold from scratch, never
a mold-of-a-mold.
"""

import hashlib

from ...db import database as db
from .prompts import _anchors_block

MAX_NOTE_CHARS = 240  # ~40 words — a note can't become a disguised anchor rewrite

DEFAULT_INTENSITY = "moderate"

# How assertively the reconciliation note should lean into the stated style on
# a genuinely borderline call. This is the ONLY thing intensity changes — the
# eligible-criteria allowlist and validate_mold's anti-rewrite/length checks
# below are absolute at every intensity level, by explicit design choice.
_INTENSITY_CLAUSE = {
    "subtle": "Mention the style only where it is clearly and directly relevant; "
             "when a call is close, lean toward the anchors' literal language.",
    "moderate": "Where the essay is a genuine borderline case between two anchor "
               "levels, let the stated style tip the balance.",
    "strong": "Actively favor the interpretation that aligns with the stated style "
             "whenever the anchors reasonably permit it; treat borderline calls "
             "generously toward the style, not just as a light tiebreaker.",
}

VALID_INTENSITIES = frozenset(_INTENSITY_CLAUSE)


def eligible_criteria(rubric: dict) -> list:
    return [c for c in rubric.get("criteria", []) if c.get("styleEligible")]


def _style_hash(grading_style: str) -> str:
    return hashlib.sha256((grading_style or "").strip().encode()).hexdigest()[:24]


def build_mold_system(intensity: str = DEFAULT_INTENSITY) -> str:
    clause = _INTENSITY_CLAUSE.get(intensity, _INTENSITY_CLAUSE[DEFAULT_INTENSITY])
    return (
        "You help an instructor's stated grading-style preference apply consistently "
        "to a fixed assessment rubric. For EACH criterion given, write ONE short "
        "reconciliation note (max ~40 words) explaining how a rater should read that "
        "criterion's anchors in light of the instructor's style.\n\n"
        "Rules (non-negotiable):\n"
        "1. Do NOT rewrite, replace, or restate the anchor level descriptions. Write a "
        "short interpretive note only.\n"
        "2. Do NOT change what floor behavior (level 0/1) means — a genuinely absent or "
        "incoherent effort must still score at the floor regardless of style.\n"
        "3. Only address the criteria given to you. Never invent a note for a criterion "
        "not listed.\n"
        "4. Output only the JSON object.\n"
        f"5. {clause}\n\n"
        "OUTPUT — a single JSON object, exactly this shape:\n"
        '{"notes": [{"criterionId": "<id from the list given>", "note": "<short note>"}]}'
    )


def build_mold_prompt(eligible: list, grading_style: str) -> str:
    criteria_block = "\n\n".join(
        f"CRITERION {c['criterionId']} ({c.get('dimension', '')}): {c['statement']}\n"
        f"ANCHORED LEVELS (0-5):\n{_anchors_block(c)}"
        for c in eligible
    )
    return f"""TEACHER'S STATED GRADING STYLE:
<<<
{grading_style.strip()}
>>>

CRITERIA ELIGIBLE FOR A STYLE RECONCILIATION NOTE (these are the ONLY criteria you may address):
{criteria_block}

For each criterion above, write one short reconciliation note."""


def mold_notes(llm_json, rubric: dict, grading_style: str,
               intensity: str = DEFAULT_INTENSITY) -> dict:
    """One LLM call (one retry on transient failure). Returns {criterionId: note},
    defense-in-depth filtered to the eligible-id set and length-capped — this
    filtering happens regardless of what validate_mold later decides, so a
    caller of mold_notes alone never sees an out-of-scope or oversized note."""
    eligible = eligible_criteria(rubric)
    style = (grading_style or "").strip()
    if not style or not eligible:
        return {}

    eligible_ids = {c["criterionId"] for c in eligible}
    system = build_mold_system(intensity)
    prompt = build_mold_prompt(eligible, style)
    try:
        raw = llm_json(system, prompt)
    except Exception:
        raw = llm_json(system, prompt)  # one retry, mirrors grade_criterion

    raw = raw if isinstance(raw, dict) else {}
    raw_notes = raw.get("notes")
    if not isinstance(raw_notes, list):
        return {}

    notes = {}
    for entry in raw_notes:
        if not isinstance(entry, dict):
            continue
        cid = entry.get("criterionId")
        note = entry.get("note")
        if cid not in eligible_ids or not isinstance(note, str) or not note.strip():
            continue
        notes[cid] = note.strip()[:MAX_NOTE_CHARS]
    return notes


def validate_mold(notes: dict, eligible: list) -> bool:
    """Golden/regression gate: rejects the whole batch (returns False) if any
    note is for a non-eligible criterionId, exceeds MAX_NOTE_CHARS, or contains
    an anchor-rewrite fingerprint — a "note" masquerading as a full rewrite."""
    eligible_ids = {c["criterionId"] for c in eligible}
    for cid, note in notes.items():
        if cid not in eligible_ids:
            return False
        if not isinstance(note, str) or len(note) > MAX_NOTE_CHARS:
            return False
        if "ANCHORED LEVELS" in note:
            return False
        anchor_line_count = sum(
            1 for line in note.splitlines()
            if len(line.strip()) > 2 and line.strip()[0].isdigit() and line.strip()[1] == ":"
        )
        if anchor_line_count >= 2:
            return False
    return True


def get_or_mold_notes(llm_json, *, content_id: str, version: str, rubric: dict,
                      grading_style: str, intensity: str = DEFAULT_INTENSITY) -> dict:
    """Cache-checked entry point used by api/grading.py. Always molds from the
    pristine rubric passed in (never from a cached mold), keyed on the current
    full style text AND intensity — so editing either is a cache miss and a
    fresh mold, never a mold-of-a-mold."""
    style = (grading_style or "").strip()
    eligible = eligible_criteria(rubric)
    if not style or not eligible:
        return {}
    if intensity not in VALID_INTENSITIES:
        intensity = DEFAULT_INTENSITY

    style_hash = _style_hash(style)
    cache_key = f"{content_id}:{version}:{style_hash}:{intensity}"
    cached = db.get_style_mold(cache_key)
    if cached is not None:
        return cached

    notes = mold_notes(llm_json, rubric, style, intensity)
    if not validate_mold(notes, eligible):
        return {}  # fail open, but don't cache a failure as if it were a real result

    db.set_style_mold(cache_key, content_id, version, style_hash, notes)
    return notes
