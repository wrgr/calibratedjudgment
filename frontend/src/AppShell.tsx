import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { isStaff, useAuth } from './auth';

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
  { to: '/settings', label: 'Settings', caption: 'provider · model · account' },
];

export default function AppShell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

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
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 flex h-screen w-60 shrink-0 flex-col px-4 py-5 max-md:hidden"
        style={{ background: 'var(--rail-bg)', color: 'var(--rail-ink)' }}
      >
        <div className="font-display text-[1.35rem] leading-tight" style={{ fontWeight: 590 }}>
          Assessment
          <br />
          Platform
        </div>
        <div className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--rail-muted)' }}>
          Competence from process and product — essay traces with AI reliance.
        </div>

        <nav className="mt-6 flex flex-col gap-0.5" aria-label="Primary">
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
          <button
            onClick={() => void logout()}
            className="mt-2 rounded-sm border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--rail-line)', color: 'var(--rail-muted)' }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-5 pb-16 pt-5 md:px-8">
        {/* mobile nav (the rail is hidden below md) */}
        <nav className="mb-4 flex flex-wrap gap-1 md:hidden" aria-label="Primary">
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
        <Outlet />
      </main>
    </div>
  );
}
