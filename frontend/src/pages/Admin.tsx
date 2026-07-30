import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { downloadJSON } from '../types';
import type { ReliabilityStats } from '../types';

type Tab = 'reliability' | 'users' | 'export';

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
      {tab === 'users' && <Users />}
      {tab === 'export' && <Export />}
    </div>
  );
}

/* ── Grading reliability dashboard (LLM vs instructor overrides) ───────────── */

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
        <Tile label="Graded criteria" value={String(data.total)} sub="criterion × channel rows" />
        <Tile label="Routed for judgment" value={String(data.needs_review)} sub="weak-referenceability criteria" />
        <Tile label="Resolution rate" value={pct(data.resolution_rate)} sub="routed criteria an instructor has overridden" />
        <Tile
          label="Avg override delta"
          value={data.avg_override_delta != null ? `${data.avg_override_delta} pts` : '—'}
          sub="high = the LLM is miscalibrated"
        />
        <Tile
          label="Needs calibration review"
          value={String(data.flagged_criteria.length)}
          sub="consistent, large LLM-vs-teacher gap"
        />
      </div>

      <div className="card p-4">
        <h2 className="panel-title mb-2">By criterion — worst miscalibration first</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-2 font-medium">Criterion</th>
              <th className="py-1 pr-2 font-medium">n</th>
              <th className="py-1 pr-2 font-medium">Needs review</th>
              <th className="py-1 pr-2 font-medium">Overridden</th>
              <th className="py-1 pr-2 font-medium">Resolution</th>
              <th className="py-1 font-medium">Avg delta</th>
            </tr>
          </thead>
          <tbody>
            {data.by_criterion.map((c, i) => (
              <tr
                key={i}
                className="border-t"
                style={{
                  borderColor: 'var(--gridline)',
                  ...(c.needs_calibration_review ? { background: 'var(--div-mid)' } : {}),
                }}
              >
                <td className="font-data py-2 pr-2">
                  {c.needs_calibration_review && (
                    <span title="Needs calibration review" style={{ color: 'var(--status-serious-text)' }}>⚑ </span>
                  )}
                  {c.criterion_id}
                </td>
                <td className="font-data py-2 pr-2">{c.total}</td>
                <td className="font-data py-2 pr-2">{c.needs_review}</td>
                <td className="font-data py-2 pr-2">{c.overridden}</td>
                <td className="font-data py-2 pr-2">{pct(c.resolution_rate)}</td>
                <td className="font-data py-2">{c.avg_delta != null ? `${c.avg_delta} pts` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.recent.length > 0 && (
        <div className="card p-4">
          <h2 className="panel-title mb-2">Recent overrides</h2>
          <ul className="space-y-1 text-xs">
            {data.recent.map((r, i) => (
              <li key={i}>
                <b>{r.criterion_id}</b> ({r.channel}) — {r.assessment_name} ({r.username}):
                {' '}{r.median ?? '—'} → {r.override_score}
                <span style={{ color: 'var(--ink-muted)' }}> · {r.override_rationale} · {r.override_ts}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
        One row per graded essay+trace assessment; see <span className="font-data">docs/research_export_data_dictionary.md</span>.
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
