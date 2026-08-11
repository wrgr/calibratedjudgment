# Calibrated Judgment

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

**Live demo: <https://calibratedjudgment.org>** — no install, no account, no
server. Explore four fully-graded example sessions, or paste in your own API key
and grade a real essay + trace directly from your browser.

---

## Two ways to run it

The same React app runs in two modes, from one codebase.

### 1. The static site (GitHub Pages) — the default

There is **no backend**. The browser *is* the backend: the grading engine, the
data store, and provider dispatch all run client-side. This is what
<https://calibratedjudgment.org> serves, and what you get from `make
build-static`.

- **Bring your own key (BYO).** No API token is ever baked into the site. To
  grade live, you paste your own provider key under **Settings → Your API key**;
  the browser calls the provider **directly** and the key is used for that call,
  stored only in your browser, and never uploaded or written to any exported
  file. See [Providers and keys](#providers-and-keys).
- **Your data lives in your browser.** Sessions you create, rubric edits, and
  instructor overrides persist in `localStorage`. **Settings → Your data** lets
  you download it all as a single JSON file and load it back on any machine — a
  poor-man's account until real sign-in exists.
- **Sign-in is bypassed.** Enter any name and pick a role (student / instructor /
  admin) to explore; a role switcher in the sidebar flips between them live.
  This is a placeholder for OAuth (future work).
- **Four demo sessions are bundled** with precomputed scores — one per
  divergence pattern, including the adversarial parrot — so the whole interface
  is explorable before you configure anything.

### 2. Self-hosted backend — full platform

Run the FastAPI backend for durable multi-user storage, server-side keys, SSE
streaming, and the research export. This is also the path for the features the
browser can't do yet (see [Future work](#future-work)).

```bash
make setup && make dev
```

That installs a virtualenv under `backend/.venv`, installs npm packages, then
runs the API on `:8000` and the Vite dev server on `:5173`. Open
<http://localhost:5173>.

If `make setup` fails on the editable install, your `python3` is probably too
old — the macOS system Python 3.9 cannot do PEP 660 installs. Point the
Makefile at a newer one: `make setup PY=/path/to/python3.12`.

#### Demo accounts (self-hosted only)

The static site needs no accounts; the backend seeds these on first boot:

| Account | Password | Sees |
|---|---|---|
| `admin` | `admin123` | everything, plus user management and the research export |
| `instructor` | `Teach@2024` | review queue, rubric library, grading style, all students' sessions |
| `emma`, `liam`, `sofia`, `james`, `priya`, `tyler` | `Learn@2024` | their own sessions only |

Change these before the platform touches real student work.

### The in-app tour

**Settings → Take the tour** spotlights each control in turn and explains it,
opening drawers and expanding panels along the way. It is the fastest way to
learn the interface, and it adapts to your role.

---

## What each screen does

**Home** lists assessment sessions as cards. A badge marks each one `demo`
(bundled exemplar with precomputed scores), `live` (graded by an LLM), or its
raw status. *Import trace & essay* takes a session name, the dialogue as JSON
(a `turns` array of `{speaker, text}` objects, where speaker is `student` or
`assistant`), and the essay as plain text.

**Writing Session** is the easier way to produce a gradeable session: chat with
the assistant as a student would, paste the finished essay, and save. The
conversation becomes the trace. (The chat needs a working provider key.)

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
button will error otherwise. In the static build the grading engine
([`frontend/src/local/grading/`](frontend/src/local/grading/)) is a faithful
TypeScript port of the backend engine
([`backend/app/services/grading/`](backend/app/services/grading/)) — same
prompts, same guards, same aggregation — so a browser-graded session and a
server-graded session are produced the same way.

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
most important rule and the engine re-checks it, because the prompt alone is not
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
maximum), once per run.

Notes are only generated for criteria the rubric marks `styleEligible` — `W1d-1`
(formal style), `W1d-2` (objective tone), and `L1-1` (conventions). Style can
influence how expression is judged. It can never influence what was argued. The
allowlist and the anti-rewrite length checks hold at every intensity; intensity
only changes how assertively a note leans on genuinely borderline calls.

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

**Bring your own key** is the model. Any user pastes a personal key under
**Settings → Your API key**. It lives in that browser's `localStorage`, is used
for that user's calls, and is never written to the store, the exported data
file, or any log.

- On the **static site**, the browser calls the provider **directly** with your
  key. Some providers do not send CORS headers and will refuse a direct browser
  call regardless of key validity — **Claude** and **Gemini** are the most
  reliable for a keyless-server setup; OpenAI and gateways behind Cloudflare
  (TAMU) typically need a proxy, which is [future work](#future-work). *Test
  key* in Settings tells you immediately whether a provider answers your browser.
- On the **self-hosted backend**, the same key rides along as `X-LLM-*` headers
  and the *server* makes the call, so the CORS limitation does not apply and any
  provider works. Server-side `.env` keys are supported too but optional; see
  [`.env.example`](.env.example).

### TAMU AI

Texas A&M's OpenAI-compatible gateway at `https://chat-api.tamu.ai/openai`. One
key reaches OpenAI, Anthropic, and Gemini models under campus licensing, so
institutional data-handling terms apply instead of each vendor's consumer terms.
Model IDs carry a `protected.` prefix. The gateway sits behind Cloudflare, which
is why it needs the server-side path rather than a direct browser call.

---

## Where state lives

**Static build:** one JSON blob in the browser's `localStorage`, seeded on first
visit from the bundled demo fixtures
([`frontend/src/local/fixtures/demo.json`](frontend/src/local/fixtures/demo.json),
generated by [`scripts/gen_demo_fixtures.py`](scripts/gen_demo_fixtures.py)).
Download and re-load it under **Settings → Your data**. Clearing site data
resets to the demo.

**Self-hosted backend:** one SQLite file, `backend/data/assessments.db`. Back
that up and you have backed up everything. Override the location with
`ASSESSMENT_DATA_DIR` or `ASSESSMENT_DB_PATH`.

| Table | Holds |
|---|---|
| `users` | accounts, roles, per-user preferences and grading style |
| `content_items` | rubrics, every version, one active at a time |
| `assessments` | sessions and their artifacts (essay + trace JSON) |
| `score_records` | one row per criterion per channel: passes, median, spread, evidence, confidence, override |
| `layer_b_results` | reliance coding per assessment |
| `jobs` | grading job progress, for polling and SSE resume |

---

## Development

```bash
make build          # normal (backend-served) frontend build — strict typecheck
make build-static   # backend-free static build (VITE_STATIC=1) — what Pages ships
make preview-static # serve the static build locally to smoke-test it
make gen-demo       # regenerate the bundled demo fixtures (no DB, no network)
make test           # backend test suite; no network, no API keys, no server needed
make e2e            # zero-key end-to-end smoke path over HTTP
make dev            # backend API + Vite dev server together
```

Every backend test is deterministic and offline. CI runs the suite and the
strict frontend build on every push.

Layout:

```
backend/app/
  api/          HTTP routes (auth, sessions, grading, content, chat, admin, export)
  core/         llm.py (provider dispatch, parsing, retries), security.py (auth, CSRF, rate limits)
  db/           database.py — schema, migrations, every query
  services/     grading/ (engine, prompts, aggregate, divergence, layerb, molding, calibration)
frontend/src/
  pages/        one file per screen
  components/   Dashboard, EvidenceTrail, RubricEditor, Drawer, Tour
  api/client.ts routes to the backend, or to the in-browser backend in static mode
  local/        the static (backend-free) build:
                store.ts (browser state + export/import), backend.ts (request router),
                llm.ts (direct provider calls), grading/ (TS port of the engine),
                jobs.ts + eventsource.ts (client-side grading progress)
content/        seed rubric and exemplar definitions
scripts/        gen_demo_fixtures.py — bundle the demo data for the static build
```

### The governing rule

Every signal the interface renders as a claim has a row in
[`docs/evidence-model.md`](docs/evidence-model.md) stating what it supports, how
confident it is, and what it does not rule out. If you add a number to a screen,
add its row. No row, no claim.

---

## Deployment

### GitHub Pages (the live site)

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds
the static client with `VITE_STATIC=1` and publishes it on every push to `main`.
The custom domain lives in
[`frontend/public/CNAME`](frontend/public/CNAME), so it survives every deploy.

One-time repo setup: **Settings → Pages → Source = "GitHub Actions"**, and point
your DNS at GitHub Pages. Nothing else — no server, no secrets, no token.

### Self-hosted backend (Docker)

```bash
cp .env.example .env      # optional: add server keys, or leave empty for BYO-only
docker compose up --build
```

Everything on <http://localhost:8000>. The `app-data` volume persists
`backend/data/`. Before real use: replace the demo accounts, terminate TLS in
front of it, back up `backend/data/`, run one worker (login rate limiting is
per-process), and check your institution's FERPA-equivalent requirements. This
is a research instrument, not a cleared system of record.

---

## Future work

- **A key-proxying backend for the static site**, so providers that block direct
  browser (CORS) calls — OpenAI, Cloudflare-fronted gateways — work without
  self-hosting the whole platform.
- **Local model hosting.** Ollama is in the provider list, but a browser served
  from `https://` can't reach `http://localhost:11434` (mixed content + CORS). A
  small local companion, or the proxy above, would light this up.
- **Real authentication (OAuth)** to replace the username-only bypass, with
  per-user cloud storage replacing the download/upload JSON.

---

## Limitations

**The scores have never been validated against human grades.** The test suite
proves the machinery is correct — that aggregation, routing, guards, and
provenance behave as specified. It does not prove the scores are right. There is
no agreement study in this repository. If you plan to rely on this for anything
consequential, run that study first.

**It targets high-school writing.** The rubric is anchored to Maryland state
standards for grades 11–12. Using it for university work means replacing the
construct map, not just editing prompt text.

**Half the system needs a dialogue.** Without a trace, you have a product-only
rubric scorer and the divergence analysis, Layer B, and the entire premise are
inert.

**On the static site, grading runs in your browser tab** and uses your key and
your rate limits. A full run is ~70+ calls; if you close the tab mid-run it
stops. Provider CORS policy, not this app, decides which providers answer a
direct browser call.

---

## Lineage

Consolidates two prior prototypes: `wrgr/essay-grading` (TGFWA, the trace-and-product
grading engine) and `wrgr/tacitknowledge` (Performative Assessment V5,
`assessmentRework` branch, the platform shell and provider layer).
