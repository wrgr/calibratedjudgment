import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { downloadJSON } from '../types';
import { isModeEnabled } from '../modes';

type Tab = 'reliability' | 'annotate' | 'novel' | 'users' | 'export';

// "Annotate LLM grading" only surfaces scenario/free-response rows; "Novel
// equivalents" is free-response only. Hide each tab while its mode(s) are off.
const SHOW_ANNOTATE = isModeEnabled('scenario') || isModeEnabled('free_response');
const SHOW_NOVEL = isModeEnabled('free_response');

export default function Admin() {
  const [tab, setTab] = useState<Tab>('reliability');

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Users · reliability · research export</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Admin
        </h1>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1 text-xs" aria-label="Admin sections">
        {([
          ['reliability', 'Grading reliability'],
          ...(SHOW_ANNOTATE ? [['annotate', 'Annotate LLM grading']] : []),
          ...(SHOW_NOVEL ? [['novel', 'Novel equivalents']] : []),
          ['users', 'Users'],
          ['export', 'Research export'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-sm border px-2.5 py-1.5"
            style={tab === t ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : { borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }}
            aria-current={tab === t ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'reliability' && <Reliability />}
      {tab === 'annotate' && <Annotate />}
      {tab === 'novel' && <NovelEquivalents />}
      {tab === 'users' && <Users />}
      {tab === 'export' && <Export />}
    </div>
  );
}

/* ── Grading reliability dashboard (LLM vs instructor calibration) ─────────── */

interface ReliabilityStats {
  total: number;
  annotated: number;
  labels: Record<string, number>;
  avg_score_by_label: Record<string, number | null>;
  agreement_rate: number | null;
  by_task: {
    task_title: string;
    report_type: string;
    total: number;
    annotated: number;
    correct: number;
    partial: number;
    missing: number;
    needs_expert_review: number;
    avg_score: number | null;
    agreement_rate: number | null;
  }[];
  recent: {
    username: string;
    task_title: string;
    annotation_label: string;
    product_score_percent: string;
    annotation_reviewer: string;
    annotation_updated_at: string;
  }[];
}

function Reliability() {
  const { data } = useQuery({
    queryKey: ['reliability'],
    queryFn: () => api.get<ReliabilityStats>('/api/admin/reliability'),
  });
  if (!data) return <Loading />;
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Assessed tasks" value={String(data.total)} sub="rows in the research table" />
        <Tile label="Instructor-annotated" value={String(data.annotated)} sub="LLM grading verdicts recorded" />
        <Tile label="Agreement rate" value={pct(data.agreement_rate)} sub="share labelled 'correct'" />
        <Tile
          label="Avg score on 'missing'"
          value={data.avg_score_by_label.missing != null ? `${data.avg_score_by_label.missing}%` : '—'}
          sub="high = the LLM over-credits"
        />
      </div>

      <div className="card p-4">
        <h2 className="panel-title mb-2">By task — most disagreement first</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-2 font-medium">Task</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">n</th>
              <th className="py-1 pr-2 font-medium">Annotated</th>
              <th className="py-1 pr-2 font-medium">Agreement</th>
              <th className="py-1 pr-2 font-medium">Avg LLM score</th>
              <th className="py-1 font-medium">correct / partial / missing / expert</th>
            </tr>
          </thead>
          <tbody>
            {data.by_task.map((t, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--gridline)' }}>
                <td className="py-2 pr-2">{t.task_title}</td>
                <td className="py-2 pr-2">{t.report_type}</td>
                <td className="font-data py-2 pr-2">{t.total}</td>
                <td className="font-data py-2 pr-2">{t.annotated}</td>
                <td className="font-data py-2 pr-2">{pct(t.agreement_rate)}</td>
                <td className="font-data py-2 pr-2">{t.avg_score != null ? `${t.avg_score}%` : '—'}</td>
                <td className="font-data py-2">{t.correct} / {t.partial} / {t.missing} / {t.needs_expert_review}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.recent.length > 0 && (
        <div className="card p-4">
          <h2 className="panel-title mb-2">Recent annotations</h2>
          <ul className="space-y-1 text-xs">
            {data.recent.map((r, i) => (
              <li key={i}>
                <b>{r.annotation_label}</b> — {r.task_title} ({r.username}, LLM {r.product_score_percent}%)
                <span style={{ color: 'var(--ink-muted)' }}> by {r.annotation_reviewer} · {r.annotation_updated_at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Annotate LLM grading ──────────────────────────────────────────────────── */

interface ExportRow {
  assessment_id: string;
  mode: string;
  username: string;
  task_title: string;
  product_score_percent: string;
  annotation_label: string;
  timestamp: string;
}

const LABELS = ['correct', 'partial', 'missing', 'needs_expert_review'] as const;

function Annotate() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['export-rows'],
    queryFn: () => api.get<{ rows: ExportRow[] }>('/api/export/research.json'),
  });
  const [busyRow, setBusyRow] = useState('');

  if (!data) return <Loading />;
  const rows = data.rows.filter((r) => r.mode !== 'essay_trace');

  async function setLabel(row: ExportRow, label: string) {
    setBusyRow(row.assessment_id + row.task_title);
    try {
      await api.post(`/api/admin/assessments/${row.assessment_id}/annotate`, {
        taskTitle: row.task_title,
        label,
      });
      await qc.invalidateQueries({ queryKey: ['export-rows'] });
      await qc.invalidateQueries({ queryKey: ['reliability'] });
    } finally {
      setBusyRow('');
    }
  }

  return (
    <div className="card p-4">
      <h2 className="panel-title mb-1">Your verdict on the LLM's grading</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        Labels feed the reliability dashboard: <b>correct</b> = the grading matches your judgment,
        <b> partial</b> = roughly right, <b>missing</b> = credited/missed wrongly, <b>needs_expert_review</b> = defer.
      </p>
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            <th className="py-1 pr-2 font-medium">Task</th>
            <th className="py-1 pr-2 font-medium">Student</th>
            <th className="py-1 pr-2 font-medium">LLM score</th>
            <th className="py-1 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assessment_id + r.task_title} className="border-t" style={{ borderColor: 'var(--gridline)' }}>
              <td className="py-2 pr-2">{r.task_title}</td>
              <td className="py-2 pr-2">{r.username}</td>
              <td className="font-data py-2 pr-2">{r.product_score_percent}%</td>
              <td className="py-2">
                <div className="flex flex-wrap gap-1">
                  {LABELS.map((l) => (
                    <button
                      key={l}
                      disabled={busyRow === r.assessment_id + r.task_title}
                      className="rounded-sm border px-1.5 py-0.5"
                      style={r.annotation_label === l
                        ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 }
                        : { borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }}
                      onClick={() => void setLabel(r, l)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <Empty label="No scenario or free-response assessments yet." />}
    </div>
  );
}

/* ── Novel-equivalent review queue ─────────────────────────────────────────── */

interface NovelReview {
  id: number;
  prompt_id: string;
  key_point_id: string;
  construct: string;
  submission_excerpt: string;
  evidence_spans: string[];
  justification: string;
  pool_id: string | null;
  status: string;
}

function NovelEquivalents() {
  const qc = useQueryClient();
  const { data: pending = [] } = useQuery({
    queryKey: ['novel-equivalents'],
    queryFn: () => api.get<NovelReview[]>('/api/admin/novel-equivalents'),
  });
  const { data: matchStats = [] } = useQuery({
    queryKey: ['fr-match-stats'],
    queryFn: () => api.get<{ prompt_id: string; key_point_id: string; total_matches: number; novel_count: number; novel_rate: number; pending_review: number }[]>('/api/admin/fr-match-stats'),
  });

  async function setStatus(id: number, status: 'promoted' | 'dismissed') {
    await api.post(`/api/admin/novel-equivalents/${id}/status`, { status });
    await qc.invalidateQueries({ queryKey: ['novel-equivalents'] });
    await qc.invalidateQueries({ queryKey: ['fr-match-stats'] });
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="panel-title mb-1">Pending novel-equivalent matches</h2>
        <p className="mb-3 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          The grader credited these as valid-but-unlisted ways of satisfying a construct. Promoting one
          is a cue to add it to the prompt's exemplars; the learner's score was final either way.
        </p>
        {pending.length === 0 && <Empty label="Nothing pending." />}
        <div className="space-y-3 text-xs">
          {pending.map((r) => (
            <div key={r.id} className="rounded border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <div><b>{r.construct}</b> <span style={{ color: 'var(--ink-muted)' }}>({r.prompt_id} · {r.key_point_id}{r.pool_id ? ` · pool ${r.pool_id}` : ''})</span></div>
              <div className="mt-1 italic">“{r.evidence_spans.join('” · “')}”</div>
              <div className="mt-1" style={{ color: 'var(--ink-secondary)' }}>{r.justification}</div>
              <div className="mt-2 flex gap-2">
                <button className="rounded-sm px-2 py-1 font-medium text-white" style={{ background: 'var(--status-good-strong)' }} onClick={() => void setStatus(r.id, 'promoted')}>
                  Promote (add to exemplars)
                </button>
                <button className="rounded-sm border px-2 py-1" style={{ borderColor: 'var(--gridline)' }} onClick={() => void setStatus(r.id, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="panel-title mb-2">Novel-equivalent rate per key point</h2>
        <p className="mb-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          A high rate signals that the key point's exemplars should be expanded — not that the grader is unreliable.
        </p>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-2 font-medium">Prompt · key point</th>
              <th className="py-1 pr-2 font-medium">Matches</th>
              <th className="py-1 pr-2 font-medium">Novel</th>
              <th className="py-1 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {matchStats.map((s, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--gridline)' }}>
                <td className="py-1.5 pr-2">{s.prompt_id} · {s.key_point_id}</td>
                <td className="font-data py-1.5 pr-2">{s.total_matches}</td>
                <td className="font-data py-1.5 pr-2">{s.novel_count}</td>
                <td className="font-data py-1.5">{Math.round(s.novel_rate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {matchStats.length === 0 && <Empty label="No FR matches logged yet." />}
      </div>
    </div>
  );
}

/* ── Users ─────────────────────────────────────────────────────────────────── */

interface AdminUser {
  username: string;
  role: string;
  displayName: string;
}

function Users() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<AdminUser[]>('/api/admin/users'),
  });
  const [form, setForm] = useState({ username: '', password: '', role: 'student', displayName: '' });
  const [error, setError] = useState('');

  async function create() {
    setError('');
    try {
      await api.post('/api/admin/users', form);
      setForm({ username: '', password: '', role: 'student', displayName: '' });
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setRole(u: AdminUser, role: string) {
    setError('');
    try {
      await api.put(`/api/admin/users/${u.username}`, { role });
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="card border-l-2 p-3 text-sm" style={{ borderLeftColor: 'var(--status-critical)' }}>{error}</div>}
      <div className="card p-4">
        <h2 className="panel-title mb-2">Accounts</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-2 font-medium">Username</th>
              <th className="py-1 pr-2 font-medium">Name</th>
              <th className="py-1 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className="border-t" style={{ borderColor: 'var(--gridline)' }}>
                <td className="font-data py-2 pr-2">{u.username}</td>
                <td className="py-2 pr-2">{u.displayName}</td>
                <td className="py-2">
                  <select
                    className="rounded-sm border p-1"
                    style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
                    value={u.role}
                    onChange={(e) => void setRole(u, e.target.value)}
                    aria-label={`Role for ${u.username}`}
                  >
                    {['admin', 'instructor', 'student'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card max-w-md p-4">
        <h2 className="panel-title mb-2">Create account</h2>
        {(['username', 'displayName', 'password'] as const).map((f) => (
          <input
            key={f}
            className="mt-2 w-full rounded-sm border p-2 text-sm"
            style={{ borderColor: 'var(--gridline)' }}
            type={f === 'password' ? 'password' : 'text'}
            placeholder={f === 'displayName' ? 'Display name' : f[0].toUpperCase() + f.slice(1)}
            value={form[f]}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
          />
        ))}
        <select
          className="mt-2 w-full rounded-sm border p-2 text-sm"
          style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          aria-label="Role for new account"
        >
          {['student', 'instructor', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          className="mt-3 rounded-sm px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          disabled={!form.username || !form.password}
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
    </div>
  );
}

/* ── Research export ───────────────────────────────────────────────────────── */

function Export() {
  return (
    <div className="card max-w-xl p-5 text-sm">
      <h2 className="panel-title">Research export (schema v3)</h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        One row per assessed task across all three modes; see <span className="font-data">docs/research_export_data_dictionary.md</span>.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="rounded-sm px-3 py-2 font-medium text-white" style={{ background: 'var(--accent)' }} href="/api/export/research.csv">
          Download CSV
        </a>
        <a className="rounded-sm border px-3 py-2" style={{ borderColor: 'var(--gridline)' }} href="/api/export/research.json" target="_blank" rel="noreferrer">
          View JSON
        </a>
        <button
          className="rounded-sm border px-3 py-2"
          style={{ borderColor: 'var(--gridline)' }}
          onClick={() => void api.get('/api/export/override-corpus').then((d) => downloadJSON('override-corpus.json', d))}
        >
          Export override corpus
        </button>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
        The override corpus is the labeled human-annotation dataset for calibration analysis: every
        instructor override with the LLM's advisory read alongside it.
      </p>
    </div>
  );
}

/* ── shared ────────────────────────────────────────────────────────────────── */

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-3.5">
      <div className="kicker">{label}</div>
      <div className="font-data mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>{sub}</div>
    </div>
  );
}

function Loading() {
  return <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>Loading…</div>;
}

function Empty({ label }: { label: string }) {
  return <div className="py-4 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</div>;
}
