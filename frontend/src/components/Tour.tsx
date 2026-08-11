/** Guided product tour: spotlights a real element on a real page and explains it.
 *
 *  Steps target `[data-tour="…"]` attributes rather than CSS classes so that
 *  restyling a page can't silently break the tour. A step whose target is
 *  missing or not rendered (an empty review queue, a staff-only control, the
 *  desktop rail on a phone) is skipped rather than dead-ending the tour.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { isStaff, useAuth } from '../auth';
import type { User } from '../auth';

interface Step {
  id: string;
  /** Route to be on for this step. Omit to stay wherever the tour already is. */
  route?: string;
  /** data-tour value to spotlight. Omit for a centred, targetless step. */
  target?: string;
  /** data-tour value to click when `target` isn't on the page yet — for content
   *  behind a drawer or a toggle rather than a plain <details>. Clicked at most
   *  once per step. */
  openVia?: string;
  title: string;
  body: string;
  staffOnly?: boolean;
  adminOnly?: boolean;
  /** Needs a real assessment to exist; `:id` in `route` is substituted. */
  needsSession?: boolean;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    route: '/',
    title: 'Welcome to the Assessment Platform',
    body:
      "This tour walks through every screen and control, about a minute end to end. " +
      "The platform scores a student's writing twice — once from the finished essay, once from the " +
      'AI dialogue that produced it — and shows you where the two disagree. ' +
      'Use Next and Back to move, Esc to leave at any point.',
  },
  {
    id: 'nav',
    target: 'nav',
    title: 'The navigation rail',
    body:
      'Every screen lives here. What you see depends on your role: students get Home, Writing Session, ' +
      'and Settings; instructors also get Needs Your Judgment, Library, and Grading Style; admins additionally ' +
      'get Admin. The small caption under each name tells you what that screen is for.',
  },
  {
    id: 'home-list',
    route: '/',
    target: 'home-sessions',
    title: 'Assessment sessions',
    body:
      'Each card is one student\'s assignment. The badge on the right reads "demo" for the bundled ' +
      'exemplars, "live" once it has been graded by an LLM, or the raw status if neither. Click a card ' +
      '(or its Open button) to see the scores. The four demo sessions already carry scores, so you can ' +
      'explore the whole system without an API key.',
  },
  {
    id: 'home-import',
    route: '/',
    target: 'home-import',
    title: 'Import trace & essay',
    body:
      'Opens a form with three fields. Session name is free text — use something you\'ll recognise, ' +
      'like "Ramirez / four-day week draft 2". Trace JSON expects the dialogue as JSON with a turns ' +
      'array, each turn having speaker ("student" or "assistant") and text. Essay is the plain final ' +
      'text. If you don\'t have a trace file, use Writing Session instead — it builds one for you.',
  },
  {
    id: 'session-grade',
    route: '/sessions/:id',
    target: 'session-grade',
    needsSession: true,
    title: 'Grade live',
    body:
      'Runs the full grading pipeline: every rubric criterion is scored separately, three times each, ' +
      'against both the essay and the dialogue. A progress bar appears while it runs. It needs a working ' +
      'LLM provider — set one up in Settings first, or this button will error. The button reads "Re-grade" ' +
      'once scores exist; re-grading replaces them.',
  },
  {
    id: 'session-tabs',
    route: '/sessions/:id',
    target: 'session-tabs',
    needsSession: true,
    title: 'Two views of the same session',
    body:
      '"Scores & Divergence" shows the rubric scores per criterion, with the essay score and the dialogue ' +
      'score side by side — the gap between them is the point of the whole system. "AI Reliance" describes ' +
      'how the student worked with the assistant, and is deliberately kept out of the writing score.',
  },
  {
    id: 'dash-tiles',
    route: '/sessions/:id',
    target: 'dash-tiles',
    needsSession: true,
    title: 'The four headline numbers',
    body:
      'Trace-inferred mastery is the score from the dialogue alone; Product score is the score from the ' +
      'finished essay alone. Mean divergence is product minus trace — positive means the essay looks ' +
      'stronger than the student\'s own reasoning did, negative means the reverse. Awaiting judgment counts ' +
      'criteria the system has routed to a human.',
  },
  {
    id: 'dash-dimensions',
    route: '/sessions/:id',
    target: 'dash-dimensions',
    needsSession: true,
    title: 'Score by dimension',
    body:
      'One row per writing dimension, each with two bars: blue is the dialogue, green is the essay. Bars of ' +
      'different lengths are the interesting rows — that gap is what the chip on the right quantifies. ' +
      'Everything here is a median on a 0–5 scale, and an instructor override replaces the model\'s number ' +
      'wherever one exists. Click any row to see the evidence behind it.',
  },
  {
    id: 'dash-criterion',
    route: '/sessions/:id',
    target: 'dash-criterion',
    openVia: 'dash-dim-row',
    needsSession: true,
    title: 'Inside a dimension: the criteria',
    body:
      'Opening a row shows the individual criteria that make it up — the tour has opened the first one. Each ' +
      'gets its id, its statement, and a "teacher-reserve" tag if it is one the model only advises on. Under ' +
      'each criterion are two rows, one per channel, carrying that channel\'s score, a confidence dot, and a ' +
      '⚑ flag if it was routed for judgment.',
  },
  {
    id: 'dash-evidence',
    route: '/sessions/:id',
    target: 'dash-evidence',
    openVia: 'dash-evidence-toggle',
    needsSession: true,
    title: 'The evidence trail',
    body:
      'This is the justification for one score. "passes" lists what each of the three independent grading runs ' +
      'returned, with their median and spread — a spread of 2 or more means the runs disagreed and the ' +
      'criterion gets routed to a human. Below that are the verbatim quotes the score rests on, each checked ' +
      'to appear in the source (dialogue quotes must come from a student turn, never the assistant), the ' +
      'anchor text matched, and the rubric version used. Instructors can replace the score here with ' +
      'Override score, which is authoritative and becomes calibration data.',
  },
  {
    id: 'write-chat',
    route: '/write',
    target: 'write-chat',
    title: 'Writing Session — the dialogue',
    body:
      'Type as the student would and press Enter to send (Shift+Enter for a newline). Every exchange ' +
      'becomes the dialogue trace that gets graded. There is no minimum length, but you need at least one ' +
      'full exchange before the session can be saved.',
  },
  {
    id: 'write-essay',
    route: '/write',
    target: 'write-essay',
    title: 'Writing Session — the essay and saving',
    body:
      'Paste or write the finished essay in the large box — this is the text the essay channel grades. ' +
      'The single-line box below it is the session name. The Save button stays disabled until you have at ' +
      'least one exchange and some essay text; hover it to see which of the two is still missing. Saving ' +
      'takes you straight to the new session.',
  },
  {
    id: 'review',
    route: '/review',
    target: 'review-queue',
    staffOnly: true,
    title: 'Needs Your Judgment',
    body:
      'The queue of criteria the system declined to score on its own — either because the criterion needs ' +
      'human judgment by design, or because its three grading passes disagreed too much. Click any row to ' +
      'open it, read the evidence, and enter your own score with a rationale. Your score wins, and it ' +
      'becomes labeled data used to calibrate the grader.',
  },
  {
    id: 'library',
    route: '/library',
    target: 'library-rubric',
    staffOnly: true,
    title: 'Library — the grading rubric',
    body:
      'This is the rubric every grading run scores against, and the next few steps walk through it. ' +
      'It is the main lever you have over how the grader behaves: what gets scored, what each score level ' +
      'means, and what the model is told before it reads a word of student work.',
  },
  {
    id: 'rubric-header',
    route: '/library',
    target: 'rubric-header',
    staffOnly: true,
    title: 'Rubric identity and version',
    body:
      'The rubric\'s id and its current version number. Rubrics are never edited in place — saving always ' +
      'publishes a new version, and every score ever recorded stores the version that produced it. That is ' +
      'what makes "I changed the guidance and the score moved" a reproducible claim rather than a guess. ' +
      'Export JSON downloads the active version for diffing or citing.',
  },
  {
    id: 'rubric-assignment-guidance',
    route: '/library',
    target: 'rubric-assignment-guidance',
    staffOnly: true,
    title: 'Assignment-level guidance',
    body:
      'Free text in your own words, injected verbatim into every grading call for every criterion. Use it for ' +
      'things specific to this assignment rather than to writing in general — for example "this assignment ' +
      'requires at least two primary sources; weight W1b-1 accordingly." Leave it empty and the rubric grades ' +
      'on its own terms.',
  },
  {
    id: 'rubric-criterion',
    route: '/library',
    target: 'rubric-criterion',
    staffOnly: true,
    title: 'One criterion at a time',
    body:
      'Each row is a single criterion — click to expand it (the tour has opened the first one for you). The ' +
      'header shows its id, the standard it traces to, and whether it is auto-gradable or teacher-reserve. ' +
      'Criteria are deliberately narrow: each names one observable behavior, and each is scored in its own ' +
      'isolated LLM call so a strong essay elsewhere can\'t inflate it.',
  },
  {
    id: 'rubric-anchors',
    route: '/library',
    target: 'rubric-anchors',
    staffOnly: true,
    title: 'Level descriptors (the anchors)',
    body:
      'The 0–5 scale, one box per level, describing what work at that level actually looks like. These are ' +
      'the highest-leverage text in the whole system: the model is told to quote evidence and match it against ' +
      'these descriptors before it picks a number. Vague anchors produce vague scores. Describe observable ' +
      'behavior, not quality adjectives.',
  },
  {
    id: 'rubric-guidance',
    route: '/library',
    target: 'rubric-guidance',
    staffOnly: true,
    title: 'Per-criterion guidance and teacher-reserve',
    body:
      'Criterion guidance is injected only into this one criterion\'s prompts — use it to settle edge cases the ' +
      'anchors leave open. Below the level boxes, the Teacher-reserve checkbox makes the model\'s score advisory ' +
      'only and sends the criterion straight to Needs Your Judgment every time. Tick it for anything you don\'t ' +
      'trust a model to judge alone.',
  },
  {
    id: 'rubric-miscalibrated',
    route: '/library',
    target: 'rubric-miscalibrated',
    staffOnly: true,
    title: 'Miscalibrated criteria',
    body:
      'When your overrides keep disagreeing with the model on a criterion, it gets flagged with the average gap ' +
      'and how many overrides it is based on. This button drafts new guidance from those overrides — your own ' +
      'corrections turned into instructions. It is staged as a proposed version, never applied silently: you ' +
      'see current vs proposed text and choose Accept & publish or Reject.',
  },
  {
    id: 'rubric-save',
    route: '/library',
    target: 'rubric-save',
    staffOnly: true,
    title: 'Saving rubric edits',
    body:
      'Stays disabled until you change something, then publishes everything you edited as one new version. ' +
      'Existing scores are not recalculated — they keep pointing at the version that produced them. To see a ' +
      'rubric change take effect, re-grade a session afterwards and compare.',
  },
  {
    id: 'grading-style',
    route: '/grading-style',
    target: 'grading-style-text',
    staffOnly: true,
    title: 'Grading Style',
    body:
      'Free text describing how you grade — for example "I weight clarity of argument over polish; I\'m ' +
      'lenient on mechanics for early drafts." It is passed to the model as an instruction alongside the ' +
      'rubric. The Intensity slider below controls how strongly it is applied, and it only ever affects ' +
      'style, tone, and mechanics — never what the student argued.',
  },
  {
    id: 'settings-server',
    route: '/settings',
    target: 'settings-server',
    title: 'Settings — server provider',
    body:
      'Lists only the providers with an API key in the server\'s .env file. Pick the provider and model you ' +
      'want grading to use, then Save preferences. If this panel says nothing is configured, either add a ' +
      'key server-side or use your own key below.',
  },
  {
    id: 'settings-byo',
    route: '/settings',
    target: 'settings-byo',
    title: 'Settings — use your own key',
    body:
      'Paste a personal API key here to grade without touching server config. Pick the provider first — the ' +
      'model list updates to match. The key box takes the raw key exactly as the provider issued it; use the ' +
      'eye icon to check you pasted it correctly. Test key makes one tiny call and reports what the provider ' +
      'said, which is the fastest way to tell a bad key from a wrong model. The key is stored only in this ' +
      'browser and is never saved on the server.',
  },
  {
    id: 'admin',
    route: '/admin',
    target: 'admin-page',
    adminOnly: true,
    title: 'Admin',
    body:
      'User management, the grading reliability dashboard (how far the LLM sits from instructor overrides), ' +
      'and the research export. The export is versioned and every column is documented in the data dictionary.',
  },
  {
    id: 'done',
    route: '/settings',
    title: "That's the tour",
    body:
      'A good first run: open a demo session from Home and look at the two score columns, then try Writing ' +
      'Session to build one of your own. You can restart this tour any time from the button on this page.',
  },
];

/** Open any collapsed <details> around the target — you can't be shown a control
 *  that's folded away. Returns true if anything changed, so the caller can wait a
 *  frame for the reflow before measuring. */
function expandAncestors(el: HTMLElement): boolean {
  let changed = false;
  let d = el.closest('details');
  while (d) {
    if (!d.open) {
      d.open = true;
      changed = true;
    }
    d = d.parentElement?.closest('details') ?? null;
  }
  return changed;
}

/** First visible element for a data-tour value (pages may render responsive duplicates). */
function findTarget(name: string): { el: HTMLElement; reflowed: boolean } | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of nodes) {
    // Expand first: a control inside a collapsed <details> measures 0×0 and
    // would otherwise look identical to one hidden by a responsive rule.
    const reflowed = expandAncestors(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { el, reflowed };
  }
  return null;
}

function visibleSteps(user: User | null, sessionId: string | null): Step[] {
  return STEPS.filter((s) => {
    if (s.staffOnly && !isStaff(user)) return false;
    if (s.adminOnly && user?.role !== 'admin') return false;
    if (s.needsSession && !sessionId) return false;
    return true;
  });
}

interface Rect { top: number; left: number; width: number; height: number }

const same = (a: Rect | null, b: Rect) =>
  !!a && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const CARD_W = 380;
const GAP = 12;
const EDGE = 12;

/** Place the card beside the spotlight: below, above, right, left — first that
 *  fits. Tall targets (the full-height nav rail) leave room on neither vertical
 *  side, so the horizontal fallbacks matter. Nothing fits → centre it. */
function place(spot: Rect | null, cardH: number): React.CSSProperties {
  const centred: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (!spot) return centred;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, Math.max(EDGE, max)));

  const below = spot.top + spot.height + GAP;
  if (below + cardH <= vh - EDGE) {
    return { top: below, left: clamp(spot.left, vw - CARD_W - EDGE) };
  }
  const above = spot.top - GAP - cardH;
  if (above >= EDGE) {
    return { top: above, left: clamp(spot.left, vw - CARD_W - EDGE) };
  }
  const top = clamp(spot.top, vh - cardH - EDGE);
  const right = spot.left + spot.width + GAP;
  if (right + CARD_W <= vw - EDGE) return { top, left: right };

  const left = spot.left - GAP - CARD_W;
  if (left >= EDGE) return { top, left };

  // Target too big to sit beside (a full-width, full-height block like the
  // anchors grid). Overlapping it is fine — the ring still marks it — but the
  // card must stay fully on screen, so pin it to a corner away from the target's
  // centre of mass rather than falling back to a transform-centred box.
  const pinTop = spot.top + spot.height / 2 > vh / 2 ? EDGE : Math.max(EDGE, vh - cardH - EDGE);
  return { top: pinTop, left: Math.max(EDGE, vw - CARD_W - EDGE) };
}

/** The tour drives navigation, so it must outlive any single page. It is mounted
 *  once by AppShell (above the router outlet); pages only ask it to start. */
const TourContext = createContext<{ start: () => void } | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => setOpen(true), []);
  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {open && <TourRunner onClose={() => setOpen(false)} />}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}

function TourRunner({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Body length varies a lot per step, so placement needs the real height, not
  // a guess — measured after paint and fed back in.
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);

  // Resolve a real session so the session-detail steps can point at a live page.
  useEffect(() => {
    let alive = true;
    api
      .get<{ id: string }[]>('/api/assessments')
      .then((list) => alive && setSessionId(list?.[0]?.id ?? null))
      .catch(() => alive && setSessionId(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const steps = visibleSteps(user, sessionId);
  const step = steps[i];
  const routeFor = useCallback(
    (s: Step) => (s.route && sessionId ? s.route.replace(':id', sessionId) : s.route),
    [sessionId],
  );

  const close = useCallback(() => onClose(), [onClose]);
  const next = useCallback(() => setI((n) => n + 1), []);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Finish when we run off the end.
  useEffect(() => {
    if (ready && i >= steps.length) close();
  }, [ready, i, steps.length, close]);

  // Navigate to the step's page.
  useEffect(() => {
    if (!step) return;
    const want = routeFor(step);
    if (want && want !== location.pathname) navigate(want);
  }, [step, routeFor, location.pathname, navigate]);

  // Locate the target once the page has rendered; skip the step if it never appears.
  useEffect(() => {
    if (!step) return;
    if (!step.target) {
      setRect(null);
      return;
    }
    // Polled with timers, not requestAnimationFrame: rAF is paused in a
    // backgrounded tab, which would freeze the tour mid-step for anyone who
    // switches away. Budget is counted in attempts rather than wall-clock so a
    // tab that was hidden doesn't come back to find its deadline already blown.
    let timer = 0;
    let attempts = 0;
    let opened = false; // per-step: never click the opener twice
    const MAX_ATTEMPTS = 40; // ~2s at 50ms
    const look = () => {
      const found = findTarget(step.target!);
      if (!found && step.openVia && !opened) {
        const opener = findTarget(step.openVia);
        if (opener) {
          opened = true;
          opener.el.click();
          timer = window.setTimeout(look, 50);
          return;
        }
      }
      if (found) {
        // Expanding a <details> reflows the page; re-measure on the next tick so
        // the spotlight lands on the settled position.
        if (found.reflowed) {
          timer = window.setTimeout(look, 50);
          return;
        }
        // Centring a target taller than the viewport pushes its top off-screen;
        // align those to the top instead.
        const tall = found.el.getBoundingClientRect().height > window.innerHeight * 0.6;
        found.el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
        const r = rectOf(found.el);
        setRect((prev) => (same(prev, r) ? prev : r));
        return;
      }
      if (++attempts >= MAX_ATTEMPTS) {
        // Not on this page for this user — move along rather than stalling.
        setI((n) => n + 1);
        return;
      }
      timer = window.setTimeout(look, 50);
    };
    look();
    return () => clearTimeout(timer);
  }, [step, location.pathname]);

  // Keep the spotlight glued to the element.
  useEffect(() => {
    if (!step?.target) return;
    // Coalesce to one measurement per frame: scrollIntoView emits a burst of
    // scroll events, and re-measuring synchronously on each is what turns a
    // smooth scroll into a stutter.
    let queued = 0;
    const sync = () => {
      if (queued) return;
      queued = window.setTimeout(() => {
        queued = 0;
        const found = findTarget(step.target!);
        if (!found) return;
        const r = rectOf(found.el);
        setRect((prev) => (same(prev, r) ? prev : r));
      }, 16);
    };
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      if (queued) clearTimeout(queued);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, next, back]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [i]);

  // Measure exactly once per step. This MUST stay keyed to `i`: cardH feeds
  // place(), placement can change the card's height, and an unkeyed layout
  // effect that setStates on every render turns that into an unbounded
  // measure → move → measure loop that locks the tab up.
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h) setCardH(h);
  }, [i]);

  if (!ready || !step) return null;

  const PAD = 6;
  const spot = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const cardStyle: React.CSSProperties = {
    position: 'fixed',
    width: CARD_W,
    maxWidth: 'calc(100vw - 2rem)',
    ...place(spot, cardH),
  };

  return (
    <>
      {/* Blocks interaction with the app while the tour is driving. Clicking it
          exits: without that, a full-screen invisible blocker just reads as a
          frozen page to anyone who doesn't know Esc works. */}
      <div
        className="fixed inset-0 z-[80]"
        style={{ background: spot ? 'transparent' : 'rgba(15,14,10,0.55)', cursor: 'pointer' }}
        onClick={close}
        aria-hidden="true"
      />
      {spot && (
        <div
          className="pointer-events-none fixed z-[81] rounded-sm"
          style={{
            ...spot,
            border: '2px solid var(--accent)',
            boxShadow: '0 0 0 9999px rgba(15,14,10,0.55)',
            transition: 'top 120ms, left 120ms, width 120ms, height 120ms',
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="card z-[82] p-4 shadow-lg outline-none"
        style={{ ...cardStyle, background: 'var(--surface-1)' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div id="tour-title" className="font-display text-base" style={{ fontWeight: 560 }}>
            {step.title}
          </div>
          <button
            onClick={close}
            className="shrink-0 text-xs underline"
            style={{ color: 'var(--ink-muted)' }}
            aria-label="End tour"
          >
            skip
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="font-data text-[10px]" style={{ color: 'var(--ink-muted)' }} aria-live="polite">
            {i + 1} of {steps.length} · Esc to exit
          </span>
          <div className="flex gap-2">
            <button
              onClick={back}
              disabled={i === 0}
              className="rounded-sm border px-3 py-1.5 text-xs disabled:opacity-40"
              style={{ borderColor: 'var(--gridline)' }}
            >
              Back
            </button>
            <button
              onClick={next}
              className="rounded-sm px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              {i === steps.length - 1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
