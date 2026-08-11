import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import type { User } from '../auth';
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6" aria-label="Sign in">
        <div className="font-display text-[1.5rem] leading-tight" style={{ fontWeight: 590 }}>
          Calibrated Judgment
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Competence from process and product.
        </p>

        {staticMode && (
          <div className="mt-4 border-l-2 p-2 text-xs leading-relaxed" style={{ borderLeftColor: 'var(--accent)', color: 'var(--ink-secondary)' }}>
            Demo build — no account needed. Enter any name and pick a role to explore. Your work
            stays in this browser; live grading uses a key you bring in Settings. (Sign-in is a
            placeholder for OAuth.)
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 border-l-2 p-2 text-sm" style={{ borderLeftColor: 'var(--status-critical)' }}>
            {error}
          </div>
        )}

        <label className="mt-5 block text-xs font-semibold" htmlFor="login-username">
          Username
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
          {busy ? 'Entering…' : staticMode ? 'Enter' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
