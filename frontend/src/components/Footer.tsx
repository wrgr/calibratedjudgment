import { Link } from 'react-router-dom';
import { ARTIFACTS } from '../artifacts';
import { useAuth } from '../auth';
import { isStatic } from '../local/mode';

// Site-wide footer. Reproduces the project artifacts (paper, poster, repo) that
// otherwise only appear on the landing page, and gives an always-visible path
// home / back to the landing page to switch roles — the sidebar is hidden on
// mobile, so this is the only role switcher there.
export function Footer() {
  const { logout } = useAuth();

  return (
    <footer
      className="mt-12 border-t pt-6 text-xs"
      style={{ borderColor: 'var(--gridline)', color: 'var(--ink-muted)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Project documents">
          {ARTIFACTS.map((d) => (
            <a
              key={d.href}
              href={d.href}
              target="_blank"
              rel="noreferrer"
              className="font-medium transition-opacity hover:opacity-70"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {d.label}
              {!d.external && <span aria-hidden="true"> ↗</span>}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="rounded-sm px-2.5 py-1 font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Home
          </Link>
          <button
            onClick={() => void logout()}
            className="rounded-sm border px-2.5 py-1 font-medium transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }}
          >
            {isStatic() ? 'Switch role' : 'Sign out'}
          </button>
        </div>
      </div>

      <p className="mt-4 leading-relaxed">
        A JHU/APL research prototype. Partially supported by APL IRAD and NIH grant 1UM1NS132250.
        Scores are advisory; not validated against human grades.
      </p>
    </footer>
  );
}
