# Research Export Data Dictionary — v3

The research export is downloaded from `/api/export/research.csv` (or `.json`).
Each row represents one graded essay+trace assessment. The export is for
analysis and review, not for certification or readiness gating.

**Schema version 3**: every value is written from structured data at grading
time (`export_schema_version` stamps which dictionary a row was written under,
so longitudinal datasets remain interpretable across schema changes).

## Column Groups

### Identity and Task Context

| Column | Source | Meaning |
|---|---|---|
| `username` | account database | Login username for the learner whose assessment was exported. |
| `display_name` | account database | Learner display name. |
| `role` | account database | Account role at export time. |
| `assessment_id` | assessments table | Stable id of the assessment this row belongs to. |
| `mode` | assessments table | Always `essay_trace`. |
| `report_type` | export pipeline | Always `essay_trace`. |
| `task_title` | assessments table | Session name. |
| `timestamp` | assessments table | Completion time, or creation time if not yet completed. |
| `export_schema_version` | export pipeline | Version of the structured export schema used to persist this row. |
| `word_count` | assessment artifacts | Word count of the submitted essay. |

### Essay + AI Trace Aggregates

Per-criterion records (passes, medians, evidence, overrides) live in the
`score_records` table and the override-corpus export
(`/api/export/override-corpus`); these columns are the per-session rollup.

| Column | Source | Meaning |
|---|---|---|
| `trace_score_median` | score_records | Median effective score across trace-channel criteria (instructor overrides win). |
| `product_score_median` | score_records | Median effective score across product-channel criteria. |
| `mean_divergence` | score_records + rubric | Mean per-dimension (product − trace) divergence. |
| `layer_b_label` | layer_b_results | RelianceScope interpretive label (hypothesis, not verdict). |
| `layer_b_verification_rate` | layer_b_results | Fraction of dialogue segments with verification behavior. |
| `override_count` | score_records | Number of instructor overrides on this session. |
| `needs_review_count` | score_records | Number of records routed to instructor judgment. |

## Interpretation Cautions

- Divergence and RelianceScope labels are hypothesis-level interpretive frames,
  not verdicts — see `docs/evidence-model.md`.
- LLM scores are preliminary/advisory; the instructor override is the
  authoritative calibration signal.
- Empty aggregate columns mean the assessment has not yet been graded (no
  `score_records` rows exist for it).

## Recommended Analysis Use

1. Compare `trace_score_median` against `product_score_median` to study
   process/product divergence (`mean_divergence`).
2. Cross-reference `override_count`/`needs_review_count` against the
   `/api/admin/reliability` dashboard to study LLM-vs-instructor calibration.
3. Join to the override corpus (`/api/export/override-corpus`) for the
   criterion-level detail behind each session's aggregates.
