import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { isStaff, useAuth } from './auth';
import type { User } from './auth';
import { Footer } from './components/Footer';
import { TourProvider } from './components/Tour';
import { isStatic } from './local/mode';

interface NavItem {
  to: string;
  label: string;
  caption: string;
  staffOnly?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', caption: 'sessions · tasks · reports' },
  { to: '/review', label: 'Needs Your Judgment', caption: 'routed for instructor scoring', staffOnly: true },
  { to: '/write', label: 'Writing Session', caption: 'live chat → gradeable trace' },
  { to: '/library', label: 'Library', caption: 'rubrics · authoring', staffOnly: true },
  { to: '/admin', label: 'Admin', caption: 'users · reliability · export', adminOnly: true },
  { to: '/grading-style', label: 'Grading Style', caption: 'style · intensity', staffOnly: true },
  { to: '/settings', label: 'Settings', caption: 'provider · model · account' },
];

export default function AppShell() {
  const { user, loading, logout, refresh } = useAuth();
  const location = useLocation();

  async function switchRole(role: User['role']) {
    const store = await import('./local/store');
    store.setRole(role);
    await refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm" style={{ color: 'var(--ink-muted)' }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const nav = NAV.filter(
    (t) => (!t.staffOnly || isStaff(user)) && (!t.adminOnly || user.role === 'admin'),
  );

  return (
    <TourProvider>
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 flex h-screen w-60 shrink-0 flex-col px-4 py-5 max-md:hidden"
        style={{ background: 'var(--rail-bg)', color: 'var(--rail-ink)' }}
      >
        <Link
          to="/"
          className="font-display block text-[1.35rem] leading-tight transition-opacity hover:opacity-80"
          style={{ fontWeight: 590, color: 'var(--rail-ink)' }}
          aria-label="Home"
        >
          Calibrated
          <br />
          Judgment
        </Link>
        <div className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--rail-muted)' }}>
          Competence from process and product — essay traces with AI reliance.
        </div>

        <nav data-tour="nav" className="mt-6 flex flex-col gap-0.5" aria-label="Primary">
          {nav.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className="group relative rounded-sm px-3 py-2 text-left"
              style={({ isActive }) => (isActive ? { background: '#26251e' } : {})}
            >
              {({ isActive }) => (
                <>
                  <span
                    className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full"
                    style={{ background: isActive ? 'var(--accent)' : 'transparent' }}
                  />
                  <span
                    className="flex items-center justify-between text-[13px]"
                    style={{ color: isActive ? 'var(--rail-ink)' : 'var(--rail-muted)', fontWeight: isActive ? 600 : 400 }}
                  >
                    {t.label}
                  </span>
                  <span className="block text-[10px]" style={{ color: 'var(--rail-muted)' }}>
                    {t.caption}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t pt-4" style={{ borderColor: 'var(--rail-line)' }}>
          <div className="text-[11px]" style={{ color: 'var(--rail-muted)' }}>
            Signed in as
          </div>
          <div className="text-[13px] font-semibold">{user.displayName}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--rail-muted)' }}>
            {user.role}
          </div>
          {isStatic() && (
            <label className="mt-2 block">
              <span className="text-[10px]" style={{ color: 'var(--rail-muted)' }}>Explore as</span>
              <select
                aria-label="Switch role"
                value={user.role}
                onChange={(e) => void switchRole(e.target.value as User['role'])}
                className="mt-0.5 w-full rounded-sm border bg-transparent px-1.5 py-1 text-[11px]"
                style={{ borderColor: 'var(--rail-line)', color: 'var(--rail-ink)' }}
              >
                <option value="student">Student</option>
                <option value="instructor">Instructor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          )}
          <button
            onClick={() => void logout()}
            className="mt-2 rounded-sm border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--rail-line)', color: 'var(--rail-muted)' }}
          >
            {isStatic() ? 'Switch user' : 'Sign out'}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col px-5 pb-8 pt-5 md:px-8">
        {/* mobile nav (the rail is hidden below md) */}
        <nav data-tour="nav" className="mb-4 flex flex-wrap gap-1 md:hidden" aria-label="Primary">
          {nav.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className="rounded-sm border px-2.5 py-1.5 text-xs"
              style={({ isActive }) =>
                isActive
                  ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 }
                  : { borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1">
          <Outlet />
        </div>
        <Footer />
      </main>
    </div>
    </TourProvider>
  );
}
