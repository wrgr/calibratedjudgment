# Testing and Validation

Run these checks after changing prompts, scoring, grading-engine, or
process-analysis code:

```bash
make test        # full backend suite (backend/tests)
make e2e         # zero-API-key end-to-end smoke path
make build       # frontend typecheck (tsc strict) + production build
```

All backend tests are local and deterministic: they require no LLM API key, no
network access, and no running server (ambient provider keys are explicitly
cleared by `tests/conftest.py`). LLM calls in tested paths are either driven by
a FakeLLM or mocked at the module boundary.

## What the suite covers

**Essay + trace grading — ported from TGFWA's CI exit criteria**
- `test_exemplars.py` — the `verify-exemplars` port: every exemplar evidence
  quote is verbatim in its source and student-turn-attributed; the adversarial
  parrot's trace is never inflated; the live provenance guard accepts the corpus
  and rejects fabricated/assistant-authored quotes; exemplar expansion through
  the Python aggregate matches seed semantics (the cross-language port check).
- `test_aggregate.py`, `test_divergence.py` — median/spread/no-evidence/
  confidence/routing semantics; override-wins effective scores; interpretation
  frames.
- `test_grading_api.py` — FakeLLM grading job end-to-end (jobs, SSE replay,
  progressive persistence), override flow, access control.

**Research surface & platform**
- `test_byo_key.py` — browser-specified (BYO) key pass-through: override
  resolution chain, header→core-call flow, unconfigured providers usable with a
  user key, and the hygiene guarantee (the key appears in no database table or
  API response).
- `test_assessment_export_schema.py` — schema v3: every export column is
  documented in the data dictionary (enforced).
- `test_research_surface.py` — export rows, override corpus, reliability
  dashboard, user management.
- `test_auth.py`, `test_content.py` — sessions, CSRF header guard, role gates,
  content versioning (bump semantics), key-material never serialized.
- `test_e2e_smoke.py` — the `git clone && make dev` zero-key guarantee, driving
  the platform over HTTP.

## Manual verification with a live provider

Set a key in `.env` (e.g. `ANTHROPIC_API_KEY`), `make dev`, then:

1. Grade an exemplar live from its session page and watch the SSE progress bar;
   check evidence quotes in the drill-in drawers are verbatim.
2. Override a routed criterion with a rationale and confirm it appears in the
   override corpus export and moves the numbers on the Admin reliability
   dashboard.
