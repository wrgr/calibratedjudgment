import { useState } from 'react';
import type { RubricCriterion, ScoreRecord } from '../types';
import { api } from '../api/client';
import { isStaff, useAuth } from '../auth';

const CONF_COLOR: Record<string, string> = {
  high: 'var(--status-good)',
  med: 'var(--status-warning)',
  low: 'var(--status-serious)',
};

/** The expandable "evidence trail": evidence quotes → reasoning → anchor matched →
 *  score → inter-pass agreement. Structured justification, not raw CoT.
 *  Ported from TGFWA; overrides go through the API (instructor role) instead of
 *  localStorage. */
export function EvidenceTrail({ record, criterion, assessmentId, onChanged, startOpen }: {
  record: ScoreRecord;
  criterion: RubricCriterion;
  assessmentId: string;
  onChanged: () => void;
  startOpen?: boolean;
}) {
  const { user } = useAuth();
  const canOverride = isStaff(user);
  const [open, setOpen] = useState(startOpen ?? false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const displayed = record.teacherOverride ? record.teacherOverride.score : record.median;

  async function saveOverride(score: number, rationale: string) {
    setError('');
    try {
      await api.post(`/api/assessments/${assessmentId}/override`, {
        criterionId: record.criterionId,
        channel: record.channel,
        score,
        rationale,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeOverride() {
    setError('');
    try {
      await api.post(`/api/assessments/${assessmentId}/override/clear`, {
        criterionId: record.criterionId,
        channel: record.channel,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="rounded border p-2 text-xs" style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}>
      <button
        className="flex w-full items-center justify-between gap-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${record.channel} channel score for ${criterion.criterionId}: ${record.noEvidence && !record.teacherOverride ? 'no evidence' : `${displayed} out of 5`}. Toggle evidence trail.`}
      >
        <span className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wide" style={{ color: record.channel === 'trace' ? 'var(--series-trace-text)' : 'var(--series-product-text)' }}>
            {record.channel}
          </span>
          {record.noEvidence && !record.teacherOverride ? (
            <span style={{ color: 'var(--ink-muted)' }}>no evidence in this channel</span>
          ) : (
            <span className="tabular text-sm font-semibold">{displayed}<span className="font-normal" style={{ color: 'var(--ink-muted)' }}>/5</span></span>
          )}
          {record.teacherOverride && (
            <span className="rounded px-1.5 py-0.5 font-medium text-white" style={{ background: 'var(--status-good-strong)' }}>
              ✓ instructor score (authoritative)
            </span>
          )}
          {!record.teacherOverride && !record.noEvidence && (
            <span className="flex items-center gap-1" title={`Confidence: ${record.confidence}`}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: CONF_COLOR[record.confidence] }} />
              {record.confidence} confidence
            </span>
          )}
          {record.needsReview && !record.teacherOverride && (
            <span className="rounded px-1.5 py-0.5" style={{ background: 'var(--div-mid)', color: 'var(--status-serious-text)' }}>⚑ needs judgment</span>
          )}
        </span>
        <span style={{ color: 'var(--ink-muted)' }}>{open ? '▾ hide evidence trail' : '▸ evidence trail'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: 'var(--gridline)' }}>
          <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--ink-secondary)' }}>
            <span>passes: <b className="tabular">{record.passes.map((p) => (p === 'no-evidence' ? 'ø' : p)).join(' · ')}</b></span>
            {record.median !== null && <span>median: <b className="tabular">{record.median}</b></span>}
            {record.spread !== null && <span>spread: <b className="tabular">{record.spread}</b>{(record.spread ?? 0) >= 2 ? ' (high — rubric ambiguity or borderline case)' : ''}</span>}
            <span>rubric v{record.rubricVersion}</span>
          </div>

          {record.evidence.length > 0 ? (
            record.evidence.map((e, i) => (
              <div key={i} className="rounded p-2" style={{ background: 'var(--page)' }}>
                <div className="italic">
                  “{e.quote}”{' '}
                  {e.turnId !== undefined && e.turnId !== null && <span style={{ color: 'var(--ink-muted)' }}>(student, turn {e.turnId})</span>}
                </div>
                <div className="mt-1" style={{ color: 'var(--ink-secondary)' }}>{e.reasoning}</div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--ink-muted)' }}>
              No qualifying evidence. {record.channel === 'trace' ? 'Only student-authored turns count as mastery evidence; this criterion did not surface in the student’s own contributions.' : ''}
            </div>
          )}

          {record.anchorMatched && (
            <div style={{ color: 'var(--ink-secondary)' }}>
              <span className="font-medium">Anchor matched:</span> {record.anchorMatched}
            </div>
          )}
          {record.styleApplied && (
            <div style={{ color: 'var(--ink-muted)' }}>
              <span className="font-medium">Grading style:</span> {record.styleApplied}
            </div>
          )}
          {record.reviewReasons.length > 0 && (
            <ul className="list-inside list-disc" style={{ color: 'var(--status-serious-text)' }}>
              {record.reviewReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}

          {error && <div role="alert" style={{ color: 'var(--status-critical)' }}>{error}</div>}

          {record.teacherOverride ? (
            <div className="rounded p-2" style={{ background: 'var(--page)' }}>
              <div><b>Instructor score: {record.teacherOverride.score}/5</b> <span style={{ color: 'var(--ink-muted)' }}>({new Date(record.teacherOverride.ts).toLocaleString()})</span></div>
              <div style={{ color: 'var(--ink-secondary)' }}>{record.teacherOverride.rationale}</div>
              <div className="mt-1" style={{ color: 'var(--ink-muted)' }}>LLM advisory retained above for the calibration corpus.</div>
              {canOverride && (
                <button className="mt-1 underline" onClick={() => void removeOverride()}>
                  Remove override
                </button>
              )}
            </div>
          ) : editing ? (
            <OverrideForm onCancel={() => setEditing(false)} onSave={(s, r) => void saveOverride(s, r)} />
          ) : canOverride ? (
            <button className="rounded border px-2 py-1 font-medium" style={{ borderColor: 'var(--gridline)' }} onClick={() => setEditing(true)}>
              Override score…
            </button>
          ) : null}
          <div style={{ color: 'var(--ink-muted)' }}>
            Anchors for {criterion.criterionId}: {Object.entries(criterion.anchors).map(([l, d]) => `${l}=${d}`).join(' | ')}
          </div>
        </div>
      )}
    </div>
  );
}

function OverrideForm({ onSave, onCancel }: { onSave: (score: number, rationale: string) => void; onCancel: () => void }) {
  const [score, setScore] = useState(3);
  const [rationale, setRationale] = useState('');
  return (
    <div className="space-y-1 rounded border p-2" style={{ borderColor: 'var(--gridline)' }}>
      <div className="flex items-center gap-2">
        <label>Your score:</label>
        <select className="rounded border px-1 py-0.5" style={{ borderColor: 'var(--gridline)' }} value={score} onChange={(e) => setScore(Number(e.target.value))}>
          {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <textarea
        className="w-full rounded border p-1"
        style={{ borderColor: 'var(--gridline)' }}
        placeholder="Rationale (required — becomes labeled calibration data)"
        aria-label="Override rationale"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="rounded px-2 py-1 font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          disabled={!rationale.trim()}
          onClick={() => onSave(score, rationale.trim())}
        >
          Save (authoritative)
        </button>
        <button className="rounded border px-2 py-1" style={{ borderColor: 'var(--gridline)' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
