import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { User } from '../auth';

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
export default function GradingStyle() {
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
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Style · intensity</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Grading Style
        </h1>
      </header>

      <div className="space-y-4">
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
      </div>
    </div>
  );
}
