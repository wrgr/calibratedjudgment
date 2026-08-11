import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      await login(username, password);
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
          Assessment Platform
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Competence from process and product.
        </p>

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

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="mt-5 w-full rounded-sm px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
