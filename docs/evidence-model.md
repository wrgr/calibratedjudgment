# Unified Evidence Model

This is the governing validity document for the platform, carried over from
`construct-map.md` — the Evidence-Centered Design construct map for essay + AI-
dialogue trace grading (TGFWA). Layer A / Layer B definitions, criterion→standard
mappings, channel semantics, divergence construct, and tracked threats to
validity live there.

## The global rule: no row, no claim

> Every signal rendered as a claim in the report or UI must have a row in an
> evidence table (here or in `construct-map.md`) stating (1) the claim it
> supports, (2) how much confidence that claim can bear, and (3) the plausible
> alternative interpretations it does not rule out. A signal with no row must not
> render as a claim anywhere — at most it may appear as a raw, unlabeled number
> in a debug/instructor-only view.

Its enforcement is partly automated: `backend/tests/` includes doc-contract
tests that fail when a claim-bearing row disappears from these documents.

## Layer separation (never blended)

- **Layer A — domain mastery.** Essay/trace criterion scores. These are
  competence estimates, always advisory to the instructor.
- **Layer B — process & AI-interaction context.** RelianceScope coding
  describes *how* the work was produced, and is never folded into a Layer A
  score. It contextualises interpretation; it never gates or adjusts
  competence estimates.

## Evidence summary

### Essay + AI-dialogue trace (see construct-map.md)

| Signal | Claim it supports | Confidence | Does NOT rule out |
|---|---|---|---|
| Per-criterion score record (3 passes, median + spread, verbatim evidence) | The student's essay/dialogue exhibits the anchored behavior at the scored level | Moderate; every quote is provenance-verified, and confidence is reported per record (evidence count × inter-pass agreement × referenceability) | Rubric ambiguity (high spread), criterion not surfacing in a short dialogue (no-evidence), grader miscalibration (why overrides are collected) |
| Trace-channel score | The student's OWN contributions evidence mastery (assistant text never counts, enforced by prompt constraint + server-side quote-in-student-turn guard) | Moderate | Mastery the student has but never displayed in dialogue |
| Product − trace divergence | The two channels measure related-but-distinct aspects; large divergence is a formative signal | Hypothesis-level by design — every interpretive frame is labeled a hypothesis, not a verdict | Drafting work invisible to the dialogue; legitimate assistance; short traces |
| RelianceScope label (Layer B) | Descriptive pattern of how the student worked with the AI | Low-moderate; a to-be-validated heuristic | Task-specific behavior; segment coding errors |

## Calibration ground truth

Instructor judgment is the authoritative layer:

- **Overrides** (per criterion×channel, rationale required) are the labeled
  human dataset.
- The reliability dashboard derives agreement/miscalibration directly from
  overrides: how often routed-for-judgment criteria get resolved, and by how
  much the teacher's score differs from the LLM's median once they do.
- Overrides export as a calibration corpus (`/api/export/override-corpus`) for
  the planned calibration layer (LLM-Rubric, Hashemi et al. 2024) and
  human–LLM agreement analysis.

## Standing limits

- The platform measures reasoning and declarative/procedural knowledge as
  expressed in text. It does not verify physical execution or psychomotor skill.
- No readiness-gate or certification claims. The research roadmap this platform
  serves tests a method; it certifies no one.
- LLM scores of any kind are preliminary/advisory. The instructor is the
  authoritative evaluator.
