# Assessment Platform

Grades a student's argumentative essay twice: once from the finished essay, and
once from the transcript of the conversation they had with an AI assistant while
writing it. The gap between those two scores is the point of the whole system.

An essay alone tells you what was produced. It cannot tell you who produced it,
which is an awkward problem now that every student has a capable writing
assistant. This platform treats the dialogue as a second, independent source of
evidence about the same rubric criteria. When the two agree, the scores are
worth more. When the essay scores far above the dialogue, that is a question
worth asking. When the dialogue scores higher, the student understands the
material and is failing to execute it, which is a completely different teaching
problem.

Everything is preliminary until an instructor confirms it. The system is built
to hand you evidence and its own uncertainty, not verdicts.

---

## Quick start

You need Python 3.10+ and Node 20+.

```bash
make setup && make dev
```

That installs a virtualenv under `backend/.venv`, installs npm packages, then
runs the API on `:8000` and the Vite dev server on `:5173`. Open
<http://localhost:5173>.

If `make setup` fails on the editable install, your `python3` is probably too
old — the macOS system Python 3.9 cannot do PEP 660 installs. Point the
Makefile at a newer one:

```bash
make setup PY=/path/to/python3.12
```

Four demo sessions are seeded with precomputed scores, so you can explore the
entire interface before configuring any LLM provider.

### Accounts

| Account | Password | Sees |
|---|---|---|
| `admin` | `admin123` | everything, plus user management and the research export |
| `instructor` | `Teach@2024` | review queue, rubric library, grading style, all students' sessions |
| `emma`, `liam`, `sofia`, `james`, `priya`, `tyler` | `Learn@2024` | their own sessions only |

Change these before the platform touches real student work.

### The in-app tour

**Settings → Take the tour** spotlights each control in turn and explains it,
opening drawers and expanding panels along the way. It is the fastest way to
learn the interface, and it adapts to your role: 15 steps for a student, 25 for
an instructor, 26 for an admin.

---

## What each screen does

**Home** lists assessment sessions as cards. A badge marks each one `demo`
(bundled exemplar with precomputed scores), `live` (graded by an LLM), or its
raw status. *Import trace & essay* takes a session name, the dialogue as JSON
(a `turns` array of `{speaker, text}` objects, where speaker is `student` or
`assistant`), and the essay as plain text.

**Writing Session** is the easier way to produce a gradeable session: chat with
the assistant as a student would, paste the finished essay, and save. The
conversation becomes the trace. The save button stays disabled until there is at
least one exchange and some essay text.

**Session detail** has two tabs. *Scores & Divergence* shows four headline
numbers, then a row per writing dimension with two bars — dialogue and essay —
and the gap between them. Clicking a row opens the criteria behind it, and each
criterion expands into its evidence trail: what each of the three grading passes
returned, the median and spread, the verbatim quotes the score rests on, the
anchor level matched, and the rubric version used. *AI Reliance* describes how
the student worked with the assistant, and is deliberately kept out of the
writing score.

**Needs Your Judgment** (instructors) is the queue of criteria the system
declined to score on its own. Open one, read the evidence, enter your score and
a rationale. Your score wins and becomes labeled calibration data.

**Library** (instructors) is the rubric editor. See [Rubrics](#rubrics-and-versioning).

**Grading Style** (instructors) lets you describe how you grade in your own
words, with an intensity slider. See [Grading style](#grading-style).

**Admin** covers users, the reliability dashboard, and the research export.

---

## How grading works

Start a run with *Grade live* on a session. It needs a working provider; the
button will error otherwise.

### Rubrics

The seeded rubric is `mccr-w11-12-arg`, twelve criteria mapped to Maryland
College and Career Ready standards for grades 11–12 argumentative writing. Each
criterion names one observable behavior and carries six anchored level
descriptors, 0 through 5.

Two criteria are marked **teacher-reserve** (`W1b-3`, audience awareness, and
`WR-1`, overall sophistication of reasoning). These are holistic judgments that
models are bad at discriminating on. The system still scores them, but the score
is advisory and always routed to a human.

The full criterion-to-standard mapping, with the theoretical source for each
choice, is in [`docs/construct-map.md`](docs/construct-map.md).

### One criterion per call, three times

A grading run builds one job per criterion per channel: 12 criteria × 2 channels
= 24 units of work, six at a time. Each unit runs the model **three times**, so a
full run is about 72 evaluative calls plus Layer B.

Each call sees exactly one criterion, its anchors, and one source document. The
model never sees its other scores. This is deliberate — a grader that can see it
just awarded a 5 will award another, and that halo is most of what makes
whole-essay LLM grading unreliable.

The output contract puts evidence before the score: quote first, reason against
the anchors, then commit to a number. `no-evidence` is a legitimate answer and
the prompt says so explicitly, because a criterion that never came up in a short
dialogue should read as absent, not as zero.

### Two guards

**Provenance.** Every quote is checked to appear verbatim in the source after
normalising whitespace and quote characters. Fabricated quotes are dropped, and
a pass whose quotes were all fabricated is demoted to `no-evidence`. A score
without surviving evidence does not exist.

**Attribution.** On the dialogue channel, quotes must come from a turn the
*student* wrote. Assistant text never counts as evidence of student mastery,
even when the student copies it back verbatim. The prompt states this as its
most important rule and the server re-checks it, because the prompt alone is not
trustworthy. There is a bundled adversarial exemplar (`Alex M.`) whose student
turns are entirely copied from the assistant, and it exists to keep this honest.

### Aggregating the passes

Given three passes for one criterion and channel:

- More than half `no-evidence`, or no numeric scores at all, and the record is
  `no-evidence`. Displayed as absent, never imputed.
- Otherwise the score is the **median** and the disagreement is the **spread**
  (max minus min).
- Evidence shown is taken from the pass closest to the median, so the quotes you
  read are the ones behind the number you see.

Confidence follows from that, not from the model's self-report: `low` for
no-evidence, teacher-reserve criteria, or spread ≥ 2; `high` for at least two
distinct quotes with spread ≤ 1; `med` otherwise.

Two things route a criterion to the review queue: it is teacher-reserve, or the
three passes disagreed by 2 or more points. Thin-but-consistent records are not
queued. Flagging everything marginal buries the cases an instructor actually
needs to look at.

### Grading style

Free text describing how you grade, plus a subtle/moderate/strong intensity.

Feeding that text straight into every scoring prompt does not work: next to
anchor descriptors the model is told are non-negotiable, a style instruction
reads as decorative and the model reports no effect. Instead the platform molds
the style into a short per-criterion reconciliation note (240 characters
maximum), once per rubric version and style text, cached thereafter.

Notes are only generated for criteria the rubric marks `styleEligible` — `W1d-1`
(formal style), `W1d-2` (objective tone), and `L1-1` (conventions). Style can
influence how expression is judged. It can never influence what was argued. The
allowlist and the anti-rewrite length checks hold at every intensity; intensity
only changes how assertively a note leans on genuinely borderline calls.

Each score record stores the note it was graded with, so the evidence trail can
show you what the model was actually told.

### Layer B: AI reliance

Separately, the dialogue is segmented (each student turn with its surrounding
assistant turns) and each segment is coded on the RelianceScope 3×3 grid:
help-seeking mode and response-use mode, each passive/active/constructive, plus
whether the student verified or challenged what the assistant said. Those roll
up to an interpretive label — reflective, cautious, thoughtless, or
collaborative.

This never touches the writing score. Teachers and stakeholders read rubric
scores as writing proficiency, and mixing reliance behavior into them would
corrupt the measurement.

### Divergence

Per dimension, `divergence = product − trace`. The platform surfaces a headline
framed as a hypothesis rather than a finding:

- Essay well above dialogue **and** a passive or thoughtless reliance profile:
  possible over-reliance. Probe the flagged dimensions in conference.
- Essay well above dialogue without that profile: possibly drafting work the
  dialogue never showed. Verify before crediting.
- Dialogue well above essay: an execution gap. The instructional target is
  drafting and transfer, not concepts.
- Convergence with constructive engagement: the strongest case that the scores
  can be read at face value.

---

## Rubrics and versioning

Rubrics are never edited in place. Saving publishes a new version (`1.0` →
`1.0-t1` → `1.0-t2`), and every score record stores the version that produced
it. That is what makes "I changed the guidance, re-graded, and the score moved"
a reproducible claim instead of an anecdote.

You can edit criterion statements, the six level descriptors, per-criterion
guidance, and the teacher-reserve flag. There is also assignment-level guidance
injected into every grading call — the place for things specific to one
assignment, like requiring two primary sources.

When your overrides on a criterion keep disagreeing with the model, that
criterion is flagged with the average gap and the number of overrides behind it.
*Draft guidance suggestion from overrides* asks the model to turn your own
corrections into guidance text. The result is staged as an inactive version
showing current versus proposed, and it changes nothing until you publish it.

---

## Providers and keys

Supported: OpenAI, Claude, Gemini, Groq, Mistral, GitHub Models, TAMU AI, and
Ollama.

**Server keys** are the default. Copy `.env.example` to `.env` and fill in what
you use. Keys are read at startup and never sent to the browser. `DEFAULT_PROVIDER`
picks the fallback for users with no preference.

**Bring your own key**: any signed-in user can paste a personal key under
Settings. It lives in that browser's localStorage, rides along on that user's
requests as `X-LLM-*` headers, is used for the call, and is never written to the
database or the logs. While set it takes precedence over the server key. *Test
key* makes one minimal call and reports what the provider actually said, which
is the quickest way to tell a bad key from a wrong model name.

### TAMU AI

Texas A&M's OpenAI-compatible gateway at `https://chat-api.tamu.ai/openai`. Get
a key from chat.tamu.ai and set `TAMU_AI_API_KEY` (`TAMU_CHAT_API_KEY` is
accepted as an alias, since that is what TAMU's own client library uses).

One key reaches OpenAI, Anthropic, and Gemini models under campus licensing, so
institutional data-handling terms apply instead of each vendor's consumer terms.
That is the reason to prefer it over a personal key when student essay text is
involved. Model IDs carry a `protected.` prefix and are listed live from the
gateway rather than hardcoded.

Two things about this gateway are worth knowing, because both cost real
debugging time. It sits behind Cloudflare, which rejects Python's default
`Python-urllib/3.x` user agent with a 403 before the request ever reaches the
API — every key looks invalid. And its successful responses are not served with
a JSON content type, so the OpenAI SDK hands back the raw body as a string
instead of a parsed object. Both are handled in `backend/app/core/llm.py`; the
comments there explain why the code looks the way it does.

---

## Where state lives

One SQLite file, `backend/data/assessments.db`. Back that up and you have backed
up everything. Override the location with `ASSESSMENT_DATA_DIR` or
`ASSESSMENT_DB_PATH`.

| Table | Holds |
|---|---|
| `users` | accounts, roles, per-user preferences and grading style |
| `auth_sessions` | opaque session tokens (SHA-256 hashes only), 14-day expiry |
| `content_items` | rubrics, every version, one active at a time |
| `assessments` | sessions and their artifacts (essay + trace JSON) |
| `score_records` | one row per criterion per channel: passes, median, spread, evidence, confidence, override |
| `layer_b_results` | reliance coding per assessment |
| `style_molds` | cached per-criterion style notes |
| `jobs` | grading job progress, for polling and SSE resume |

Schema changes apply themselves. `init_db()` adds missing columns idempotently
on startup, so upgrading means pulling the code and restarting.

---

## Development

```bash
make test     # 173 backend tests; no network, no API keys, no server needed
make build    # strict TypeScript typecheck + production frontend build
make e2e      # zero-key end-to-end smoke path over HTTP
make api      # API only, on :8000
make web      # Vite only, on :5173
make gen-api  # regenerate frontend API types from the live OpenAPI schema
```

Every backend test is deterministic and offline. LLM calls are driven by a fake
or mocked at the module boundary, and `tests/conftest.py` explicitly clears
ambient provider keys so a key in your environment cannot change a result. CI
runs the suite and the strict frontend build on every push.

Layout:

```
backend/app/
  api/          HTTP routes (auth, sessions, grading, content, chat, admin, export)
  core/         llm.py (provider dispatch, parsing, retries), security.py (auth, CSRF, rate limits)
  db/           database.py — schema, migrations, every query
  services/     grading/ (engine, prompts, aggregate, divergence, layerb, molding, calibration),
                jobs.py, llm_bridge.py
frontend/src/
  pages/        one file per screen
  components/   Dashboard, EvidenceTrail, RubricEditor, Drawer, Tour
content/        seed rubric and exemplar definitions
docs/           construct map, evidence model, export dictionary, testing notes
```

### The governing rule

Every signal the interface renders as a claim has a row in
[`docs/evidence-model.md`](docs/evidence-model.md) stating what it supports, how
confident it is, and what it does not rule out. If you add a number to a screen,
add its row. No row, no claim.

---

## Deployment

The platform runs as a single process. Uvicorn serves the API, and when
`frontend/dist/` exists it serves the built SPA from the same port.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

Everything on <http://localhost:8000>. The `app-data` volume persists
`backend/data/`.

### Bare metal

```bash
make setup && make build
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Before real use

- **Replace the demo accounts.** They are seeded on first boot with published
  passwords.
- **Terminate TLS in front of it.** Session cookies only get the `Secure` flag
  when the app sees an HTTPS scheme. The Docker image already passes
  `--proxy-headers`; on bare metal add `--proxy-headers --forwarded-allow-ips
  '<proxy-ip>'` yourself. Browser-supplied keys should never cross plain HTTP.
- **Back up `backend/data/`.** It is the research record.
- **Run one worker.** Login rate limiting is per-process memory. With
  `--workers N` the effective limit multiplies by N and an attacker spreading
  attempts across workers evades lockout entirely.
- **Check your institution's requirements** (FERPA and equivalents) before
  collecting real student work. This is a research instrument, not a cleared
  system of record.

Security posture, for review: sessions are opaque random tokens stored only as
SHA-256 hashes with server-side expiry; cookies are HttpOnly and SameSite=Lax;
every mutating route requires an `X-Requested-With: fetch` header as the CSRF
guard; passwords use pbkdf2-sha256 at 1,000,000 iterations; all SQL is
parameterised. Provider error text is scrubbed of API keys before it reaches the
browser, because those messages surface in job errors that students can see.

---

## Limitations

Worth being direct about these.

**The scores have never been validated against human grades.** The test suite
proves the machinery is correct — that aggregation, routing, guards, and
provenance behave as specified. It does not prove the scores are right. There is
no agreement study in this repository: no quadratic weighted kappa, no
exact/adjacent agreement against instructor grades on held-out essays. The
reliability dashboard derives calibration from overrides collected during use,
which is useful but is downstream of already trusting the output. If you plan to
rely on this for anything consequential, run that study first.

**It targets high-school writing.** The rubric is anchored to Maryland state
standards for grades 11–12. Using it for university work means replacing the
construct map, not just editing prompt text.

**Half the system needs a dialogue.** Without a trace, you have a product-only
rubric scorer and the divergence analysis, Layer B, and the entire premise are
inert.

**Only login is rate limited.** Any authenticated user can start unlimited
grading runs and chat turns against your provider credits.

**Concurrency is modest by design.** Six grading threads against one SQLite
writer is fine for a classroom and will not survive a campus.

There is also one piece of dead schema: the `assessment_runs` table and its
`save_run_state` / `load_run_state` / `delete_run_state` helpers have no callers.

---

## Lineage

Consolidates two prior prototypes: `wrgr/essay-grading` (TGFWA, the trace-and-product
grading engine) and `wrgr/tacitknowledge` (Performative Assessment V5,
`assessmentRework` branch, the platform shell and provider layer).
