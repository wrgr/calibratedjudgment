import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { isStaff, useAuth } from '../auth';
import { Drawer } from '../components/Drawer';
import type { AssessmentSummary, Trace } from '../types';
import { downloadJSON } from '../types';

const MODE_LABEL: Record<string, string> = {
  essay_trace: 'Essay + AI trace',
};

export default function Home() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);

  const { data: assessments = [], isLoading } = useQuery({
    queryKey: ['assessments'],
    queryFn: () => api.get<AssessmentSummary[]>('/api/assessments'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/assessments/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['assessments'] }),
  });

  const byMode = (mode: string) => assessments.filter((a) => a.mode === mode);

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">{isStaff(user) ? 'All sessions' : `Welcome, ${user?.displayName}`}</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Assessment sessions
        </h1>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <button
          className="rounded-sm px-3 py-1.5 font-medium text-white"
          style={{ background: 'var(--accent)' }}
          onClick={() => setShowImport(true)}
        >
          + Import trace &amp; essay
        </button>
        <span style={{ color: 'var(--ink-muted)' }}>Exemplars carry demo scores — no API key needed to explore.</span>
      </div>

      {isLoading && <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</div>}

      {(['essay_trace'] as const).map((mode) => {
        const items = byMode(mode);
        if (!items.length) return null;
        return (
          <section key={mode} className="mb-6">
            <h2 className="kicker mb-2">{MODE_LABEL[mode]}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((a) => (
                <div key={a.id} className="card cursor-pointer p-4 transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/sessions/${a.id}`)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-base" style={{ fontWeight: 560 }}>{a.name || a.id}</div>
                    <span className="font-data shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide" style={{ background: 'var(--div-mid)', color: 'var(--ink-secondary)' }}>
                      {a.gradedLive ? 'live' : a.isExemplar ? 'demo' : a.status}
                    </span>
                  </div>
                  <p className="mt-1 overflow-hidden text-xs leading-snug"
                    style={{ color: 'var(--ink-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                    title={a.description}>
                    {a.description}
                  </p>
                  {isStaff(user) && (
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>owner: {a.username}</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                    <Link to={`/sessions/${a.id}`} className="rounded-sm px-2.5 py-1 font-medium text-white" style={{ background: 'var(--accent)' }}>
                      Open ›
                    </Link>
                    <button
                      className="rounded-sm border px-2.5 py-1"
                      style={{ borderColor: 'var(--gridline)' }}
                      onClick={() => void api.get(`/api/assessments/${a.id}`).then((full) => downloadJSON(`${a.id}.json`, full))}
                    >
                      Export
                    </button>
                    {!a.isExemplar && (
                      <button
                        className="rounded-sm border px-2.5 py-1"
                        style={{ borderColor: 'var(--gridline)', color: 'var(--status-critical)' }}
                        onClick={() => { if (confirm(`Delete session "${a.name}"?`)) del.mutate(a.id); }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <Drawer open={showImport} onClose={() => setShowImport(false)} title="Import a session" kicker="trace JSON + final essay" wide>
        <ImportForm onDone={(id) => { setShowImport(false); void qc.invalidateQueries({ queryKey: ['assessments'] }); navigate(`/sessions/${id}`); }} />
      </Drawer>
    </div>
  );
}

function ImportForm({ onDone }: { onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [traceText, setTraceText] = useState('');
  const [essay, setEssay] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    try {
      const parsed = JSON.parse(traceText) as Trace;
      if (!Array.isArray(parsed.turns)) throw new Error('trace JSON must have a "turns" array');
      for (const t of parsed.turns) {
        if (t.speaker !== 'student' && t.speaker !== 'assistant') throw new Error(`turn ${t.turnId}: speaker must be "student" or "assistant"`);
      }
      const created = await api.post<{ id: string }>('/api/assessments', {
        mode: 'essay_trace',
        name: name || parsed.traceId || 'Imported session',
        description: 'Imported trace + essay',
        contentId: 'mccr-w11-12-arg',
        artifacts: { trace: parsed, essay },
      });
      onDone(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      <input
        className="w-full rounded-sm border p-2 text-sm"
        style={{ borderColor: 'var(--gridline)' }}
        placeholder="Session name (student / assignment)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div>
        <div className="mb-1 text-xs font-data" style={{ color: 'var(--ink-secondary)' }}>
          {'{ traceId, assignmentId, turns: [{turnId, speaker, text}] }'}
        </div>
        <textarea
          className="font-data h-44 w-full rounded-sm border p-2 text-xs"
          style={{ borderColor: 'var(--gridline)' }}
          placeholder="Paste trace JSON…"
          value={traceText}
          onChange={(e) => setTraceText(e.target.value)}
        />
      </div>
      <div>
        <div className="mb-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>Final essay (plain text)</div>
        <textarea
          className="h-44 w-full rounded-sm border p-2 text-xs"
          style={{ borderColor: 'var(--gridline)' }}
          value={essay}
          onChange={(e) => setEssay(e.target.value)}
        />
      </div>
      {err && <div className="text-xs" style={{ color: 'var(--status-critical)' }}>{err}</div>}
      <button className="rounded-sm px-3 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--accent)' }} onClick={() => void submit()}>
        Add session
      </button>
    </div>
  );
}
