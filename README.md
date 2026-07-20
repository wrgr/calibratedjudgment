# Assessment Platform

A research platform for assessing writing competence from **process, not just
outcome**: writing-standard mastery inferred from both the final essay
(*product*) and the student↔AI dialogue that produced it (*trace*), with their
divergence as the formative signal. One-criterion-per-LLM-call grading, 3
passes, median + spread, a verbatim evidence-provenance guard, and a
student-attribution guard.

Plus: instructor review queue with overrides, versioned rubrics, a grading
reliability dashboard (LLM-vs-instructor calibration, derived from overrides),
and a versioned research export.

**Governing rule ("no row, no claim"):** every signal rendered as a claim anywhere in the platform must have a row in [`docs/evidence-model.md`](docs/evidence-model.md) stating the claim it supports, its confidence, and what it does *not* rule out.

## Quick start

Prerequisites: Python ≥ 3.10, Node ≥ 20 (Docker optional, for deployment).

```bash
make setup      # python venv + npm install
make seed       # seed demo users and content
make dev        # API on :8000, web on :5173
```

Open http://localhost:5173 and sign in with a demo account:

| Account | Password | Role |
|---|---|---|
| `admin` | `admin123` | admin (users, reliability dashboard, export) |
| `instructor` | `Teach@2024` | instructor (review queue, overrides, rubric/library) |
| `emma` `liam` `sofia` `james` `priya` `tyler` | `Learn@2024` | students (own assessments only) |

Change these before any non-demo use.

No API key? Bundled exemplar sessions still carry precomputed demo scores, so the cold-start demo needs zero setup. Two ways to enable live LLM grading of a new essay+trace assessment:

- **Server keys** (default): add provider keys to `.env` (copy `.env.example`). They stay server-side and are never sent to the browser.
- **Bring your own key**: any signed-in user can save a personal key under **Settings → Use your own API key**. It lives in that browser's localStorage only and rides on each of the user's grading requests as a header; the server uses it transiently and never stores or logs it. While set, it takes precedence over the server key.

## Architecture

- `backend/` — FastAPI + SQLite. All LLM calls, grading, scoring, and the research database live here.
- `frontend/` — React 18 + Vite + TypeScript + Tailwind SPA.
- `content/` — seed corpus: rubrics and exemplar sessions (loaded into the DB by `make seed`).
- `docs/` — the unified evidence model, research-export data dictionary, testing notes.

## Development

```bash
make test       # backend pytest suite (69 tests, no network or keys needed)
make build      # typecheck + production frontend build
make e2e        # zero-API-key end-to-end smoke test
```

CI (`.github/workflows/ci.yml`) runs the backend suite and the strict-TypeScript
frontend build on every push and pull request.

## Deployment

The platform deploys as a **single process**: uvicorn serves the API and, when
`frontend/dist/` exists, the built SPA and its assets on the same port. All
state lives in one SQLite database plus generated report files under
`backend/data/` — persist that directory and you've persisted everything.

### Option A — Docker (recommended)

```bash
cp .env.example .env    # optional: add provider keys for live grading
docker compose up --build
```

Serves everything on http://localhost:8000. The `app-data` named volume holds
`backend/data/` (database + reports) across container rebuilds.

### Option B — bare metal

```bash
make setup && make build         # install deps, build frontend/dist
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The app seeds demo users and content on first boot; `make seed` is only needed
if you want the seed output printed explicitly.

### Production checklist

- **Change the demo passwords** (Admin → Users) or replace the seed accounts
  before real use.
- **Run behind TLS.** Put a reverse proxy (Caddy, nginx, etc.) in front.
  Session cookies get the `Secure` flag when the app sees an HTTPS scheme — the
  Docker image already runs uvicorn with `--proxy-headers` so the proxy's
  `X-Forwarded-Proto` is honored; add those flags yourself on bare metal
  (`--proxy-headers --forwarded-allow-ips '<proxy-ip>'`). Browser-supplied
  (BYO) keys especially should never transit plain HTTP.
- **Persist and back up `backend/data/`** (or point `ASSESSMENT_DATA_DIR` /
  `ASSESSMENT_DB_PATH` somewhere durable). The SQLite file is the research
  record: assessments, score records, and instructor overrides.
- **Provider keys** go in `.env` (see `.env.example`); they are read at startup
  and never exposed to the browser. `DEFAULT_PROVIDER` picks the fallback
  provider for users with no preference.
- **Schema migrations are automatic**: on startup, `init_db()` widens existing
  tables idempotently — upgrading the code and restarting is the whole
  procedure.
- **Scope note:** this is a research instrument. BYO-key mode and the demo
  accounts are suited to pilots and demos; review your institution's data
  handling requirements (e.g. FERPA) before collecting real student data.

## Exporting as a standalone repository

This tree is self-contained. To publish it as its own repository:

```bash
git push <new-repo-url> <this-branch>:main
```

## Lineage

Consolidates `wrgr/essay-grading` (TGFWA) and `wrgr/tacitknowledge` (Performative Assessment V5, `assessmentRework` branch).
