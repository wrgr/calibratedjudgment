import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Right-hand slide-over used for all drill-in detail: criterion evidence, source
 *  texts, imports. Accessible dialog: focus moves in on open, is trapped while open,
 *  and returns to the invoking element on close; Escape closes. */
export function Drawer({ open, onClose, title, kicker, children, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  kicker?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Trap focus within the panel
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      restoreRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(22, 21, 15, 0.4)', animation: 'drawer-fade 160ms ease' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full flex-col overflow-hidden outline-none"
        style={{
          width: wide ? 'min(760px, 96vw)' : 'min(540px, 96vw)',
          background: 'var(--surface-1)',
          boxShadow: '-12px 0 40px rgba(22,21,15,0.18)',
          animation: 'drawer-slide 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--gridline)' }}>
          <div className="min-w-0">
            {kicker && <div className="kicker">{kicker}</div>}
            <div className="font-display mt-0.5 text-lg leading-snug" style={{ fontWeight: 560 }}>{title}</div>
          </div>
          <button
            className="shrink-0 rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }}
            onClick={onClose}
            aria-label="Close dialog"
          >
            Close ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
      <style>{`
        @keyframes drawer-slide { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes drawer-fade { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
