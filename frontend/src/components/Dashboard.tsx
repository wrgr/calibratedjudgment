import { useState } from 'react';
import type { AssessmentDetail, DimensionDivergence, Rubric } from '../types';
import { effectiveScore, median } from '../types';
import { EvidenceTrail } from './EvidenceTrail';
import { Drawer } from './Drawer';

const TONE_COLOR: Record<string, string> = {
  flag: 'var(--status-serious)',
  target: 'var(--series-trace)',
  valid: 'var(--status-good)',
  neutral: 'var(--baseline)',
};

/** Scores & divergence view — ported from TGFWA Dashboard.tsx. Divergence and its
 *  interpretation now come precomputed from the API. */
export function Dashboard({ assessment, rubric, onChanged }: {
  assessment: AssessmentDetail;
  rubric: Rubric;
  onChanged: () => void;
}) {
  const scores = assessment.scores ?? [];
  const dims = assessment.divergence ?? [];
  const interp = assessment.interpretation;
  const [openDim, setOpenDim] = useState<DimensionDivergence | null>(null);
  const [source, setSource] = useState<'essay' | 'trace' | null>(null);
  const [why, setWhy] = useState(false);

  if (!scores.length) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        This session has no scores yet. Run grading (requires an LLM provider configured on the server).
      </div>
    );
  }

  const overall = (channel: 'trace' | 'product'): number | null => {
    const vals = scores
      .filter((r) => r.channel === channel)
      .map((r) => effectiveScore(r))
      .filter((v): v is number => v !== null);
    return vals.length ? median(vals) : null;
  };
  const traceOverall = overall('trace');
  const productOverall = overall('product');
  const withDiv = dims.filter((d) => d.divergence !== null);
  const meanDiv = withDiv.length ? withDiv.reduce((a, d) => a + (d.divergence as number), 0) / withDiv.length : null;
  const flags = scores.filter((r) => r.needsReview && !r.teacherOverride).length;

  return (
    <div className="space-y-4">
      <div data-tour="dash-tiles" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Trace-inferred mastery" value={traceOverall} accent="var(--series-trace)" sub="from the dialogue" />
        <Tile label="Product score" value={productOverall} accent="var(--series-product)" sub="from the final essay" />
        <Tile
          label="Mean divergence"
          value={meanDiv}
          signed
          accent={meanDiv !== null && Math.abs(meanDiv) >= 1 ? (meanDiv > 0 ? 'var(--div-pos)' : 'var(--div-neg)') : 'var(--baseline)'}
          sub="product − trace"
        />
        <Tile label="Awaiting judgment" value={flags} count accent={flags ? 'var(--status-serious)' : 'var(--baseline)'} sub="routed items" />
      </div>

      {interp && (
        <div className="card flex items-start gap-3 border-l-2 p-4" style={{ borderLeftColor: TONE_COLOR[interp.tone] }}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{interp.headline}</div>
            {why && (
              <p className="mt-1.5 text-sm" style={{ color: 'var(--ink-secondary)' }}>
                {interp.detail}{' '}
                <span style={{ color: 'var(--ink-muted)' }}>Interpretive frame, not a verdict — scores are preliminary until an instructor confirms or overrides them.</span>
              </p>
            )}
          </div>
          <button
            className="shrink-0 text-xs underline"
            style={{ color: 'var(--ink-secondary)' }}
            onClick={() => setWhy((v) => !v)}
            aria-expanded={why}
            aria-label={why ? 'Hide interpretation rationale' : 'Show interpretation rationale'}
          >
            {why ? 'hide' : 'why?'}
          </button>
        </div>
      )}

      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="panel-title">By dimension</h2>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            <span className="flex items-center gap-1.5"><Swatch color="var(--series-trace)" /> Trace</span>
            <span className="flex items-center gap-1.5"><Swatch color="var(--series-product)" /> Product</span>
            <span className="flex gap-2">
              <button className="underline" onClick={() => setSource('essay')}>essay</button>
              <button className="underline" onClick={() => setSource('trace')}>dialogue</button>
            </span>
          </div>
        </div>
        <div data-tour="dash-dimensions">
          {dims.map((d, di) => (
            <button
              key={d.dimension}
              {...(di === 0 ? { 'data-tour': 'dash-dim-row' } : {})}
              className="grid w-full grid-cols-[9rem_1fr_4.5rem_1rem] items-center gap-3 rounded-sm px-2 py-2.5 text-left hover:bg-black/[0.03]"
              onClick={() => setOpenDim(d)}
              title="Open evidence for this dimension"
            >
              <div className="truncate text-xs font-medium">{d.dimension}</div>
              <div className="space-y-1">
                <Bar value={d.traceScore} color="var(--series-trace)" />
                <Bar value={d.productScore} color="var(--series-product)" />
              </div>
              <DivergenceChip value={d.divergence} />
              <span style={{ color: 'var(--ink-muted)' }}>›</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Median of criterion medians, 0–5 · click a row for evidence · instructor overrides take precedence.
        </p>
      </div>

      <Drawer
        open={openDim !== null}
        onClose={() => setOpenDim(null)}
        title={openDim?.dimension ?? ''}
        kicker={`${openDim?.standard ?? ''} · evidence trails`}
        wide
      >
        {openDim && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="Trace" value={openDim.traceScore} color="var(--series-trace-text)" />
              <MiniStat label="Product" value={openDim.productScore} color="var(--series-product-text)" />
              <div className="rounded-sm border p-2 text-center" style={{ borderColor: 'var(--gridline)' }}>
                <div className="kicker">Divergence</div>
                <div className="mt-1"><DivergenceChip value={openDim.divergence} /></div>
              </div>
            </div>
            {rubric.criteria
              .filter((c) => openDim.criterionIds.includes(c.criterionId))
              .map((c, ci) => {
                const trace = scores.find((r) => r.criterionId === c.criterionId && r.channel === 'trace');
                const product = scores.find((r) => r.criterionId === c.criterionId && r.channel === 'product');
                return (
                  <div key={c.criterionId} {...(ci === 0 ? { 'data-tour': 'dash-criterion' } : {})}>
                    <div className="mb-1.5 text-sm">
                      <span className="font-data text-xs font-semibold">{c.criterionId}</span>{' '}
                      {c.referenceability === 'weak' && (
                        <span className="rounded-sm px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--div-mid)', color: 'var(--status-serious-text)' }}>teacher-reserve</span>
                      )}
                      <div className="text-xs" style={{ color: 'var(--ink-secondary)' }}>{c.statement}</div>
                    </div>
                    <div className="space-y-2">
                      {trace && <EvidenceTrail record={trace} criterion={c} assessmentId={assessment.id} onChanged={onChanged} />}
                      {product && <EvidenceTrail record={product} criterion={c} assessmentId={assessment.id} onChanged={onChanged} />}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Drawer>

      <Drawer open={source === 'essay'} onClose={() => setSource(null)} title="Final essay" kicker="channel P source" wide>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{assessment.artifacts.essay}</div>
      </Drawer>
      <Drawer open={source === 'trace'} onClose={() => setSource(null)} title="Dialogue trace" kicker="channel T source" wide>
        <div className="space-y-3 text-sm">
          {(assessment.artifacts.trace?.turns ?? []).map((t) => (
            <div key={t.turnId} className="rounded-sm p-2.5" style={{ background: t.speaker === 'student' ? 'rgba(42,120,214,0.06)' : 'var(--page)' }}>
              <div className="kicker mb-1" style={{ color: t.speaker === 'student' ? 'var(--series-trace-text)' : 'var(--ink-muted)' }}>
                turn {t.turnId} · {t.speaker}
              </div>
              {t.text}
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

function Tile({ label, value, sub, accent, signed, count }: {
  label: string;
  value: number | null;
  sub: string;
  accent: string;
  signed?: boolean;
  count?: boolean;
}) {
  const text = value === null ? '—' : count ? String(value) : `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}`;
  return (
    <div className="card p-3.5">
      <div className="kicker">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-data text-2xl font-semibold" style={{ color: value === null ? 'var(--ink-muted)' : 'var(--ink-primary)' }}>{text}</span>
        {!count && value !== null && <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>/5</span>}
        <span className="ml-1 inline-block h-2 w-2 rounded-full" style={{ background: accent }} />
      </div>
      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="rounded-sm border p-2 text-center" style={{ borderColor: 'var(--gridline)' }}>
      <div className="kicker">{label}</div>
      <div className="font-data mt-1 text-lg font-semibold" style={{ color: value === null ? 'var(--ink-muted)' : color }}>
        {value === null ? 'ø' : value.toFixed(1)}
      </div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />;
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-[2px]" style={{ background: 'var(--div-mid)' }}>
        {value !== null && (
          <div className="absolute inset-y-0 left-0 rounded-r-[3px] transition-all" style={{ width: `${(value / 5) * 100}%`, background: color }} />
        )}
      </div>
      <span className="font-data w-7 text-right text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
        {value === null ? '—' : value.toFixed(1)}
      </span>
    </div>
  );
}

function DivergenceChip({ value }: { value: number | null }) {
  if (value === null)
    return <span className="rounded-sm px-2 py-0.5 text-center text-[11px]" style={{ background: 'var(--div-mid)', color: 'var(--ink-secondary)' }}>n/a</span>;
  const mag = Math.abs(value);
  const bg = mag < 1 ? 'var(--div-mid)' : value > 0 ? 'var(--div-pos-strong)' : 'var(--div-neg-strong)';
  const fg = mag < 1 ? 'var(--ink-secondary)' : '#ffffff';
  const arrow = mag < 1 ? '≈' : value > 0 ? '▲' : '▼';
  return (
    <span className="font-data rounded-sm px-1.5 py-0.5 text-center text-[11px] font-semibold" style={{ background: bg, color: fg }}
      title={value > 0 ? 'Product exceeds trace' : value < 0 ? 'Trace exceeds product' : 'Converged'}>
      {arrow} {value > 0 ? '+' : ''}{value.toFixed(1)}
    </span>
  );
}
