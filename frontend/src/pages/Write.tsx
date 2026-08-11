import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { TraceTurn } from '../types';

interface Turn {
  speaker: 'student' | 'assistant';
  text: string;
}

/** Live writing-session simulator — ported from TGFWA ChatSimulator.tsx.
 *  The conversation IS the trace; the transcript becomes a gradeable
 *  essay_trace assessment paired with a pasted final essay. */
export default function Write() {
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [essay, setEssay] = useState('');
  const [name, setName] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    const next: Turn[] = [...turns, { speaker: 'student', text }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const { reply } = await api.post<{ reply: string }>('/api/chat', { turns: next });
      setTurns([...next, { speaker: 'assistant', text: reply }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTurns(turns); // roll back the unanswered turn
      setInput(text);
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    const traceTurns: TraceTurn[] = turns.map((t, i) => ({
      turnId: i + 1,
      speaker: t.speaker,
      text: t.text,
      timestamp: new Date().toISOString(),
    }));
    const created = await api.post<{ id: string }>('/api/assessments', {
      mode: 'essay_trace',
      name: name || `Live session ${new Date().toLocaleDateString()}`,
      description: 'Created from the in-app writing session',
      contentId: 'mccr-w11-12-arg',
      artifacts: {
        trace: { traceId: `trace-live-${Date.now()}`, assignmentId: 'live-session', turns: traceTurns },
        essay,
      },
    });
    navigate(`/sessions/${created.id}`);
  }

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Live chat → gradeable trace</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Writing session
        </h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div data-tour="write-chat" className="card flex h-[36rem] flex-col p-4">
          <h2 className="text-sm font-semibold">Simulated writing session</h2>
          <p className="mb-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Work with the AI as a student would — every turn here becomes the dialogue trace that Channel T grades.
          </p>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded border p-3" style={{ borderColor: 'var(--gridline)' }}>
            {turns.length === 0 && (
              <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                No turns yet. Try: “I'm arguing that our district should adopt a four-day school week — is my claim precise enough?”
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="text-sm">
                <span className="mr-1 font-semibold" style={{ color: t.speaker === 'student' ? 'var(--series-trace-text)' : 'var(--ink-muted)' }}>
                  {t.speaker} · turn {i + 1}:
                </span>
                <span className="whitespace-pre-wrap">{t.text}</span>
              </div>
            ))}
            {busy && <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>assistant is writing…</div>}
          </div>
          {error && <div className="mt-2 text-xs" role="alert" style={{ color: 'var(--status-critical)' }}>{error}</div>}
          <div className="mt-2 flex gap-2">
            <textarea
              className="flex-1 rounded border p-2 text-sm"
              style={{ borderColor: 'var(--gridline)' }}
              rows={2}
              placeholder="Write as the student… (Enter to send, Shift+Enter for newline)"
              aria-label="Student message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="rounded px-4 text-sm font-medium text-white disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
              disabled={busy || !input.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
        </div>

        <div data-tour="write-essay" className="card flex h-[36rem] flex-col p-4">
          <h2 className="text-sm font-semibold">Final essay</h2>
          <p className="mb-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Paste (or write) the final essay this session produced — Channel P grades this text.
          </p>
          <textarea
            className="flex-1 rounded border p-2 text-sm"
            style={{ borderColor: 'var(--gridline)' }}
            aria-label="Final essay text"
            value={essay}
            onChange={(e) => setEssay(e.target.value)}
          />
          <input
            className="mt-2 rounded border p-2 text-sm"
            style={{ borderColor: 'var(--gridline)' }}
            placeholder="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="mt-2 rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
            disabled={turns.length < 2 || !essay.trim()}
            title={turns.length < 2 ? 'Have at least one exchange first' : !essay.trim() ? 'Add the final essay' : ''}
            onClick={() => void createSession()}
          >
            Save as gradeable session ({turns.length} turns)
          </button>
        </div>
      </div>
    </div>
  );
}
