import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, clearByoKey, loadByoKey, saveByoKey } from '../api/client';
import { isStaff, useAuth } from '../auth';
import type { User } from '../auth';

interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: string[];
  configured: boolean;
}

export default function Settings() {
  const { user, refresh } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<{ providers: ProviderInfo[]; default: string }>('/api/providers'),
  });

  const [provider, setProvider] = useState(user?.preferredProvider ?? '');
  const [model, setModel] = useState(user?.preferredModel ?? '');
  const [saved, setSaved] = useState(false);

  const providers = data?.providers ?? [];
  const configured = providers.filter((p) => p.configured);
  const selected = configured.find((p) => p.name === (provider || data?.default)) ?? configured[0];

  async function save() {
    await api.put<User>('/api/auth/prefs', {
      preferred_provider: provider || selected?.name || '',
      preferred_model: model || selected?.defaultModel || '',
    });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Provider · model · account</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Settings
        </h1>
      </header>

      <div className="space-y-4">
        <div className="card max-w-xl p-5">
          <div className="panel-title">Server LLM preferences</div>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Server-configured API keys are the default for grading. Only providers with a key in the
            server's <span className="font-data">.env</span> appear here. With none configured (and no
            browser key below), scoring falls back to deterministic keyword matching.
          </p>

          {isLoading && (
            <div className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
              Loading providers…
            </div>
          )}

          {!isLoading && configured.length === 0 && (
            <div className="mt-4 border-l-2 p-3 text-sm" style={{ borderLeftColor: 'var(--status-warning)' }}>
              No LLM provider is configured on the server. Add a key to{' '}
              <span className="font-data">.env</span> and restart — or supply your own key below.
            </div>
          )}

          {configured.length > 0 && (
            <>
              <label className="mt-4 block text-xs font-semibold" htmlFor="pref-provider">
                Provider
              </label>
              <select
                id="pref-provider"
                className="mt-1 w-full rounded-sm border p-2 text-sm"
                style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
                value={provider || data?.default || ''}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel('');
                }}
              >
                {configured.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-xs font-semibold" htmlFor="pref-model">
                Model
              </label>
              <select
                id="pref-model"
                className="mt-1 w-full rounded-sm border p-2 text-sm"
                style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
                value={model || selected?.defaultModel || ''}
                onChange={(e) => setModel(e.target.value)}
              >
                {(selected?.models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <button
                onClick={() => void save()}
                className="mt-5 rounded-sm px-4 py-2 text-sm font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                {saved ? 'Saved ✓' : 'Save preferences'}
              </button>
            </>
          )}
        </div>

        {isStaff(user) && <GradingStyleCard />}

        <ByoKeyCard providers={providers} defaultProvider={data?.default ?? ''} />
      </div>
    </div>
  );
}

const INTENSITY_LEVELS: Array<'subtle' | 'moderate' | 'strong'> = ['subtle', 'moderate', 'strong'];
const INTENSITY_LABELS: Record<string, string> = {
  subtle: 'Subtle', moderate: 'Moderate', strong: 'Strong',
};
const INTENSITY_HELP: Record<string, string> = {
  subtle: "Only nudges borderline calls; leans toward the rubric's literal anchors otherwise.",
  moderate: 'Tips genuinely borderline calls toward the stated style (the default).',
  strong: 'Favors the stated style whenever the anchors reasonably permit it.',
};

/** Instructor-editable grading-style blurb. Folded (via a short, vetted
 *  per-criterion reconciliation note — services/grading/molding.py) into the
 *  grading prompt only for criteria the rubric marks style-eligible; there is
 *  no separate score adjustment. The intensity slider only changes how
 *  assertively that note is worded — it never widens which criteria are
 *  eligible, and never loosens the anti-rewrite safeguards on the note
 *  itself. The model's own per-criterion styleApplied explanation (shown in
 *  the evidence trail) is how you check it actually engaged with this. */
function GradingStyleCard() {
  const { user, refresh } = useAuth();
  const [style, setStyle] = useState(user?.gradingStyle ?? '');
  const [intensity, setIntensity] = useState<'subtle' | 'moderate' | 'strong'>(
    user?.styleIntensity ?? 'moderate',
  );
  const [saved, setSaved] = useState(false);

  async function save() {
    await api.put<User>('/api/auth/prefs', { grading_style: style, style_intensity: intensity });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card max-w-xl p-5">
      <div className="panel-title">Grading style</div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        This text is sent directly to the LLM as an instruction alongside the rubric — it is not a
        separate score adjustment. Check a criterion's evidence trail after grading to see how the
        model says it applied (or didn't apply) this to a specific score.
      </p>
      <textarea
        className="mt-3 w-full rounded-sm border p-2 text-sm"
        style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)', minHeight: '6rem' }}
        placeholder="e.g. I weight clarity of argument over polish; I'm lenient on mechanics for early drafts."
        value={style}
        onChange={(e) => setStyle(e.target.value)}
        aria-label="Grading style"
      />

      <label className="mt-4 block text-xs font-semibold" htmlFor="style-intensity">
        Intensity
      </label>
      <input
        id="style-intensity"
        type="range"
        min={0}
        max={2}
        step={1}
        className="mt-2 w-full"
        value={INTENSITY_LEVELS.indexOf(intensity)}
        onChange={(e) => setIntensity(INTENSITY_LEVELS[Number(e.target.value)])}
        aria-label="Grading style intensity"
      />
      <div className="mt-1 flex justify-between text-xs" style={{ color: 'var(--ink-muted)' }}>
        {INTENSITY_LEVELS.map((lvl) => (
          <span key={lvl} style={lvl === intensity ? { fontWeight: 600, color: 'var(--ink-primary)' } : undefined}>
            {INTENSITY_LABELS[lvl]}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {INTENSITY_HELP[intensity]} Applies only to the criteria eligible for style adjustment
        (formal style, tone, and grammar/mechanics) — never to what's argued.
      </p>

      <button
        onClick={() => void save()}
        className="mt-3 rounded-sm px-4 py-2 text-sm font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        {saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}

/** Eye / eye-with-slash. `off` renders the struck-through variant, shown while the
 *  key is visible so the icon depicts the action the click performs (hide it). */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

/** Bring-your-own key: stored in THIS browser's localStorage only, sent with each
 *  of your grading requests as headers, used transiently by the server, never
 *  persisted or logged there. Takes precedence over the server key while set. */
function ByoKeyCard({ providers, defaultProvider }: {
  providers: ProviderInfo[];
  defaultProvider: string;
}) {
  const existing = loadByoKey();
  const [provider, setProvider] = useState(existing?.provider || defaultProvider || providers[0]?.name || '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  // Masked by default; revealing is opt-in per visit and never persisted, so a
  // reload always returns to masked.
  const [keyVisible, setKeyVisible] = useState(false);
  const [active, setActive] = useState(existing !== null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  const selected = providers.find((p) => p.name === provider) ?? providers[0];

  function save() {
    if (!apiKey.trim()) return;
    saveByoKey({ provider: selected?.name ?? provider, model, apiKey: apiKey.trim() });
    setActive(true);
    setStatus({ tone: 'ok', text: 'Saved in this browser. Your key now rides on your grading requests.' });
  }

  function clear() {
    clearByoKey();
    setApiKey('');
    setKeyVisible(false);
    setActive(false);
    setStatus({ tone: 'info', text: 'Cleared — back to the server-configured provider (or keyword fallback).' });
  }

  async function test() {
    if (!apiKey.trim() || !selected) return;
    setStatus({ tone: 'info', text: 'Testing key…' });
    try {
      const res = await api.post<{ ok: boolean; error: string | null }>(
        `/api/providers/${encodeURIComponent(selected.name)}/validate-key`,
        { apiKey: apiKey.trim(), model: model || selected.defaultModel },
      );
      setStatus(res.ok
        ? { tone: 'ok', text: 'Key works ✓' }
        : { tone: 'bad', text: `Key rejected: ${res.error ?? 'unknown error'}` });
    } catch (e) {
      setStatus({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    }
  }

  const toneColor = { ok: 'var(--status-good-strong)', bad: 'var(--status-critical)', info: 'var(--ink-muted)' };

  return (
    <div className="card max-w-xl p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="panel-title">Use your own API key (optional)</div>
        {active && (
          <span className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: 'var(--status-good-strong)' }}>
            active in this browser
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Your key is stored only in this browser and sent along with each of <i>your</i> grading
        requests; the server uses it for that call and never stores or logs it. While set, it takes
        precedence over the server key. Any provider below works — including ones without a server key.
      </p>

      <label className="mt-4 block text-xs font-semibold" htmlFor="byo-provider">
        Provider
      </label>
      <select
        id="byo-provider"
        className="mt-1 w-full rounded-sm border p-2 text-sm"
        style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
        value={selected?.name ?? provider}
        onChange={(e) => {
          setProvider(e.target.value);
          setModel('');
        }}
      >
        {providers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.configured ? ' (server key configured)' : ''}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs font-semibold" htmlFor="byo-model">
        Model
      </label>
      <select
        id="byo-model"
        className="mt-1 w-full rounded-sm border p-2 text-sm"
        style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
        value={model || selected?.defaultModel || ''}
        onChange={(e) => setModel(e.target.value)}
      >
        {(selected?.models ?? []).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-xs font-semibold" htmlFor="byo-key">
        API key
      </label>
      <div className="relative mt-1">
        <input
          id="byo-key"
          type={keyVisible ? 'text' : 'password'}
          autoComplete="off"
          // pr-9 keeps the key text clear of the reveal button.
          className="w-full rounded-sm border p-2 pr-9 text-sm font-data"
          style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
          placeholder="sk-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center"
          style={{ color: 'var(--ink-muted)' }}
          onClick={() => setKeyVisible((v) => !v)}
          aria-controls="byo-key"
          aria-pressed={keyVisible}
          aria-label={keyVisible ? 'Hide API key' : 'Show API key'}
          title={keyVisible ? 'Hide API key' : 'Show API key'}
        >
          <EyeIcon off={keyVisible} />
        </button>
      </div>

      {status && (
        <div className="mt-2 text-xs" role="status" style={{ color: toneColor[status.tone] }}>
          {status.text}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          disabled={!apiKey.trim()}
          onClick={save}
        >
          Save in this browser
        </button>
        <button
          className="rounded-sm border px-3 py-2 text-sm disabled:opacity-40"
          style={{ borderColor: 'var(--gridline)' }}
          disabled={!apiKey.trim()}
          onClick={() => void test()}
        >
          Test key
        </button>
        {active && (
          <button
            className="rounded-sm border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--gridline)', color: 'var(--status-critical)' }}
            onClick={clear}
          >
            Clear key
          </button>
        )}
      </div>
    </div>
  );
}
