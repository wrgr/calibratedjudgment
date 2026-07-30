import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { Drawer } from '../components/Drawer';
import { EvidenceTrail } from '../components/EvidenceTrail';
import type { ContentItem, Rubric, ScoreRecord } from '../types';

/** "Needs your judgment" queue — ported from TGFWA ReviewQueue.tsx, now
 *  CROSS-SESSION: every routed record from every assessment, resolved split out. */
export default function Review() {
  const { data: queue = [], refetch } = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => api.get<ScoreRecord[]>('/api/review-queue'),
  });
  const { data: rubricItem } = useQuery({
    queryKey: ['rubric', 'mccr-w11-12-arg'],
    queryFn: () => api.get<ContentItem<Rubric>>('/api/content/rubrics/mccr-w11-12-arg'),
  });
  const rubric = rubricItem?.payload;
  const [openKey, setOpenKey] = useState<string | null>(null);

  const keyOf = (r: ScoreRecord) => `${r.assessmentId}|${r.criterionId}|${r.channel}`;
  const pending = queue.filter((r) => !r.teacherOverride);
  const resolved = queue.filter((r) => r.teacherOverride);
  const open = queue.find((r) => keyOf(r) === openKey) ?? null;
  const openCriterion = open && rubric ? rubric.criteria.find((c) => c.criterionId === open.criterionId) : null;

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Routed for instructor scoring · all sessions</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Needs your judgment
        </h1>
      </header>

      <p className="mb-4 max-w-2xl text-sm" style={{ color: 'var(--ink-secondary)' }}>
        Routed here by design: teacher-reserve criteria and high inter-pass spread. The LLM read is advisory — your
        score is authoritative and becomes labeled calibration data.
      </p>

      {pending.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
          Nothing waiting — all routed items have been resolved.
        </div>
      ) : (
        <div data-tour="review-queue" className="card divide-y" style={{ borderColor: 'var(--gridline)' }}>
          {pending.map((r) => (
            <button key={keyOf(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]" onClick={() => setOpenKey(keyOf(r))}>
              <span className="font-data shrink-0 text-xs font-semibold">{r.criterionId}</span>
              <span className="kicker shrink-0" style={{ color: r.channel === 'trace' ? 'var(--series-trace-text)' : 'var(--series-product-text)' }}>
                {r.channel}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {r.assessmentName} · {r.username}
              </span>
              <span className="hidden shrink-0 gap-1 md:flex">
                {r.reviewReasons.map((reason, i) => (
                  <span key={i} className="rounded-sm px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--div-mid)', color: 'var(--status-serious-text)' }} title={reason}>
                    {reason.startsWith('Teacher-reserve') ? 'reserve' : 'high spread'}
                  </span>
                ))}
              </span>
              <span className="font-data shrink-0 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {r.noEvidence ? 'ø' : `${r.median}/5`}
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>›</span>
            </button>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="card mt-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Resolved ({resolved.length})</summary>
          <div className="mt-2 divide-y" style={{ borderColor: 'var(--gridline)' }}>
            {resolved.map((r) => (
              <button key={keyOf(r)} className="flex w-full items-center gap-3 py-2 text-left text-xs hover:bg-black/[0.02]" onClick={() => setOpenKey(keyOf(r))}>
                <span className="font-data font-semibold">{r.criterionId}</span>
                <span className="kicker">{r.channel}</span>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  instructor {r.teacherOverride!.score}/5{r.median !== null && ` · advisory ${r.median}`} · {r.username}
                </span>
                <span className="ml-auto" style={{ color: 'var(--ink-muted)' }}>›</span>
              </button>
            ))}
          </div>
        </details>
      )}

      <Drawer
        open={open !== null}
        onClose={() => setOpenKey(null)}
        title={openCriterion ? openCriterion.statement : ''}
        kicker={open ? `${open.criterionId} · ${open.channel} channel · ${open.assessmentName}` : ''}
        wide
      >
        {open && openCriterion && (
          <EvidenceTrail
            record={open}
            criterion={openCriterion}
            assessmentId={open.assessmentId!}
            onChanged={() => void refetch()}
            startOpen
          />
        )}
      </Drawer>
    </div>
  );
}
