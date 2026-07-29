import { useState } from 'react';
import type { LayerBResult, RelianceMode } from '../types';
import { Drawer } from './Drawer';

const MODES: RelianceMode[] = ['passive', 'active', 'constructive'];
// Sequential blue ramp (validated reference palette) for the count heatmap.
const SEQ = ['var(--div-mid)', 'var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)'];

/** AI-reliance view (Layer B) — ported from TGFWA LayerBPanel.tsx. */
export function LayerBPanel({ layerB }: { layerB: LayerBResult | null | undefined }) {
  const b = layerB;
  const [showSegments, setShowSegments] = useState(false);
  if (!b) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        No reliance coding yet for this session — run grading first.
      </div>
    );
  }
  const maxCount = Math.max(1, ...MODES.flatMap((h) => MODES.map((r) => b.grid[h][r])));

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="panel-title">Not a writing score</h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          How the student worked with AI (RelianceScope) — context for reading the divergence, never folded into rubric scores.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatTile label="Dominant help-seeking" value={b.dominantHelpSeeking} />
          <StatTile label="Dominant response-use" value={b.dominantResponseUse} />
          <StatTile label="Verification rate" value={`${Math.round(b.verificationRate * 100)}%`} sub="segments where the student challenged / checked AI output" />
        </div>
        <div className="mt-3 rounded p-3 text-sm" style={{ background: 'var(--page)' }}>
          Interpretive label (Hou et al. 2025): <b>{b.interpretiveLabel}</b>{' '}
          {b.interpretiveLabel === 'undetermined' ? (
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>— no student-authored AI interaction could be coded for this session; this is not a reliance judgment.</span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>— a hypothesis to check against your knowledge of the student, not a verdict.</span>
          )}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="panel-title">Segment counts on the 3×3 grid</h3>
          <button className="text-xs underline" style={{ color: 'var(--ink-secondary)' }} onClick={() => setShowSegments(true)}>
            segment-by-segment coding ›
          </button>
        </div>
        <div className="inline-grid grid-cols-[7rem_repeat(3,5.5rem)] gap-0.5 text-xs">
          <div />
          {MODES.map((m) => (
            <div key={m} className="pb-1 text-center font-medium" style={{ color: 'var(--ink-secondary)' }}>{m}</div>
          ))}
          {MODES.map((h) => (
            <Row key={h} h={h} grid={b.grid} maxCount={maxCount} />
          ))}
        </div>
        <div className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Rows: help-seeking · Columns: response-use · Cell = number of dialogue segments.
        </div>
      </div>

      <Drawer open={showSegments} onClose={() => setShowSegments(false)} title="Segment-by-segment coding" kicker="Layer B · RelianceScope" wide>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-2 font-medium">Turns</th>
              <th className="py-1 pr-2 font-medium">Help-seeking</th>
              <th className="py-1 pr-2 font-medium">Response-use</th>
              <th className="py-1 pr-2 font-medium">Verified?</th>
              <th className="py-1 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {b.segments.map((s, i) => (
              <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--gridline)' }}>
                <td className="font-data py-2 pr-2">{s.segmentTurns.join('–')}</td>
                <td className="py-2 pr-2">{s.helpSeeking}</td>
                <td className="py-2 pr-2">{s.responseUse}</td>
                <td className="py-2 pr-2">{s.verification ? '✓ yes' : '—'}</td>
                <td className="py-2" style={{ color: 'var(--ink-secondary)' }}>{s.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Drawer>
    </div>
  );
}

function Row({ h, grid, maxCount }: { h: RelianceMode; grid: Record<RelianceMode, Record<RelianceMode, number>>; maxCount: number }) {
  return (
    <>
      <div className="flex items-center pr-2 font-medium" style={{ color: 'var(--ink-secondary)' }}>{h}</div>
      {MODES.map((r) => {
        const count = grid[h][r];
        const step = count === 0 ? 0 : Math.max(1, Math.round((count / maxCount) * (SEQ.length - 1)));
        const dark = step >= 4;
        return (
          <div
            key={r}
            className="flex h-12 items-center justify-center rounded-sm text-sm font-semibold tabular"
            style={{ background: SEQ[step], color: dark ? '#fff' : 'var(--ink-primary)' }}
            role="img"
            aria-label={`${h} help-seeking, ${r} response-use: ${count} segment${count === 1 ? '' : 's'}`}
            title={`${h} help-seeking × ${r} response-use: ${count} segment(s)`}
          >
            {count || ''}
          </div>
        );
      })}
    </>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--gridline)' }}>
      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</div>
      <div className="text-xl font-semibold capitalize">{value}</div>
      {sub && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>{sub}</div>}
    </div>
  );
}
