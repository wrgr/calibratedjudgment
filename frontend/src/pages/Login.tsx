import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import type { User } from '../auth';
import { ARTIFACTS } from '../artifacts';
import { isStatic } from '../local/mode';

export default function Login() {
  const { user, login } = useAuth();
  const location = useLocation();
  const staticMode = isStatic();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('instructor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full px-4 py-8 md:py-12" style={{ background: 'var(--surface-1)' }}>
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-5">
        {/* Hero banner */}
        <section
          className="lg:col-span-3 flex flex-col justify-between rounded-lg p-7 md:p-9"
          style={{ background: 'var(--rail-bg)', color: 'var(--rail-ink)' }}
        >
          <div>
            <div
              className="font-data text-[11px] uppercase tracking-[0.18em]"
              style={{ color: 'var(--accent)' }}
            >
              JHU/APL · Calibrating Agentic Judges
            </div>
            <h1 className="font-display mt-3 text-[2.1rem] leading-[1.05] md:text-[2.6rem]" style={{ fontWeight: 600 }}>
              Calibrated Judgment
            </h1>
            <p className="mt-2 text-sm italic md:text-base" style={{ color: 'var(--rail-muted)' }}>
              Expert taste, made auditable — judgment at scale, without ceding judgment.
            </p>
            <p className="mt-5 max-w-xl text-[13.5px] leading-relaxed" style={{ color: 'var(--rail-ink)' }}>
              Grades a student's argumentative essay <strong>twice</strong> — once from the finished
              text, once from the transcript of the dialogue they had with an AI assistant while
              writing it — and surfaces the gap between them. Every score is anchored to a verbatim
              quote, routed to a human when it's uncertain, and calibrated to one instructor's stated
              standards. Advisory by design.
            </p>
          </div>

          <nav className="mt-7 flex flex-wrap gap-2.5" aria-label="Project documents">
            {ARTIFACTS.map((d) => (
              <a
                key={d.href}
                href={d.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
                style={
                  d.primary
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { border: '1px solid var(--rail-line)', color: 'var(--rail-ink)' }
                }
              >
                {d.label}
                {!d.external && <span aria-hidden="true"> ↗</span>}
              </a>
            ))}
          </nav>
        </section>

        {/* Entry card */}
        <section className="lg:col-span-2 flex flex-col justify-center">
          <form onSubmit={submit} className="card p-6" aria-label="Enter">
            <div className="panel-title">{staticMode ? 'Explore the demo' : 'Sign in'}</div>

            {staticMode && (
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                No account needed. Enter any name and pick a role. Your work stays in this browser;
                live grading uses a key you bring in Settings. (Sign-in is a placeholder for OAuth.)
              </p>
            )}

            {error && (
              <div role="alert" className="mt-4 border-l-2 p-2 text-sm" style={{ borderLeftColor: 'var(--status-critical)' }}>
                {error}
              </div>
            )}

            <label className="mt-4 block text-xs font-semibold" htmlFor="login-username">
              {staticMode ? 'Your name' : 'Username'}
            </label>
            <input
              id="login-username"
              className="mt-1 w-full rounded-sm border p-2 text-sm"
              style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />

            {staticMode ? (
              <>
                <label className="mt-3 block text-xs font-semibold" htmlFor="login-role">
                  Explore as
                </label>
                <select
                  id="login-role"
                  className="mt-1 w-full rounded-sm border p-2 text-sm"
                  style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
                  value={role}
                  onChange={(e) => setRole(e.target.value as User['role'])}
                >
                  <option value="instructor">Instructor — review queue, rubrics, all sessions</option>
                  <option value="admin">Admin — everything, plus users &amp; research export</option>
                  <option value="student">Student — just their own sessions</option>
                </select>
              </>
            ) : (
              <>
                <label className="mt-3 block text-xs font-semibold" htmlFor="login-password">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  className="mt-1 w-full rounded-sm border p-2 text-sm"
                  style={{ borderColor: 'var(--gridline)', background: 'var(--surface-1)' }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </>
            )}

            <button
              type="submit"
              disabled={busy || !username || (!staticMode && !password)}
              className="mt-5 w-full rounded-sm px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Entering…' : staticMode ? 'Enter the demo' : 'Sign in'}
            </button>

            <p className="mt-4 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              A JHU/APL research prototype. Partially supported by APL IRAD and NIH grant
              1UM1NS132250. Scores are advisory; not validated against human grades.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}
