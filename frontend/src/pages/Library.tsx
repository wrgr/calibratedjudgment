import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { RubricEditor } from '../components/RubricEditor';
import type { ContentItem, Rubric } from '../types';
import { isModeEnabled } from '../modes';

type Tab = 'rubrics' | 'scenarios' | 'prompts';

// Scenario authoring is mode B; free-response prompt authoring is mode C. Only
// show a tab while its mode is enabled — rubrics belong to mode A and stay.
const TABS: Tab[] = [
  'rubrics',
  ...(isModeEnabled('scenario') ? (['scenarios'] as Tab[]) : []),
  ...(isModeEnabled('free_response') ? (['prompts'] as Tab[]) : []),
];

/** Content library: rubric editor (versioned) + scenario / FR-prompt inventories. */
export default function Library() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('rubrics');

  const { data: rubrics = [] } = useQuery({
    queryKey: ['content', 'rubrics'],
    queryFn: () => api.get<ContentItem<Rubric>[]>('/api/content/rubrics'),
  });
  const { data: scenarios = [] } = useQuery({
    queryKey: ['content', 'scenarios'],
    queryFn: () => api.get<ContentItem[]>('/api/content/scenarios'),
    enabled: tab === 'scenarios',
  });
  const { data: prompts = [] } = useQuery({
    queryKey: ['content', 'prompts'],
    queryFn: () => api.get<ContentItem[]>('/api/content/prompts'),
    enabled: tab === 'prompts',
  });

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Rubrics · scenarios · prompts</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Library
        </h1>
      </header>

      <nav className="mb-4 flex gap-1 text-xs" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-sm border px-2.5 py-1.5 capitalize"
            style={tab === t ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : { borderColor: 'var(--gridline)', color: 'var(--ink-secondary)' }}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'rubrics' && (
        rubrics.length ? (
          <RubricEditor
            item={rubrics[0]}
            onSaved={() => void qc.invalidateQueries({ queryKey: ['content', 'rubrics'] })}
          />
        ) : (
          <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>No rubrics seeded.</div>
        )
      )}

      {tab === 'scenarios' && (
        <>
          <DraftAuthor kind="scenario" onSaved={() => void qc.invalidateQueries({ queryKey: ['content', 'scenarios'] })} />
          <ContentList items={scenarios} kindLabel="scenario" />
        </>
      )}
      {tab === 'prompts' && (
        <>
          <DraftAuthor kind="prompt" onSaved={() => void qc.invalidateQueries({ queryKey: ['content', 'prompts'] })} />
          <ContentList items={prompts} kindLabel="free-response prompt" />
        </>
      )}
    </div>
  );
}

/** AI-assisted authoring (staff): describe the task, review the generated draft,
 *  save it as a new versioned content item. */
function DraftAuthor({ kind, onSaved }: { kind: 'scenario' | 'prompt'; onSaved: () => void }) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ draft: Record<string, unknown> }>(
        `/api/admin/authoring/${kind}-draft`, { description });
      setDraft(res.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const path = kind === 'scenario' ? 'scenarios' : 'prompts';
      await api.put(`/api/content/${path}/${draft.id as string}`, { payload: draft });
      setDraft(null);
      setDescription('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4 p-4">
      <div className="panel-title">Draft a new {kind} with AI</div>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        Generates a first draft (CTA probe bank / construct-exemplar key points) for you to review
        and edit before it reaches any learner. Requires a configured LLM provider.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded-sm border p-2 text-sm"
          style={{ borderColor: 'var(--gridline)' }}
          placeholder={kind === 'scenario' ? 'e.g. "diagnosing why a circuit breaker keeps tripping"' : 'e.g. "explain how photosynthesis works"'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="rounded-sm px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
          disabled={busy || !description.trim()}
          onClick={() => void generate()}
        >
          {busy ? 'Generating…' : 'Generate draft'}
        </button>
      </div>
      {error && <div role="alert" className="mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>{error}</div>}
      {draft && (
        <div className="mt-3">
          <pre className="max-h-80 overflow-auto rounded p-2 text-[10px]" style={{ background: 'var(--page)' }}>
            {JSON.stringify(draft, null, 2)}
          </pre>
          <div className="mt-2 flex gap-2">
            <button className="rounded-sm px-3 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--status-good-strong)' }} disabled={busy} onClick={() => void save()}>
              Save to library
            </button>
            <button className="rounded-sm border px-3 py-1.5 text-sm" style={{ borderColor: 'var(--gridline)' }} onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentList({ items, kindLabel }: { items: ContentItem[]; kindLabel: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((it) => {
        const p = it.payload as { title?: string; description?: string };
        return (
          <details key={it.contentId} className="card p-4">
            <summary className="cursor-pointer">
              <span className="font-display text-base" style={{ fontWeight: 560 }}>{p.title ?? it.contentId}</span>
              <span className="font-data ml-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>v{it.version}</span>
            </summary>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>{p.description}</p>
            <pre className="mt-3 max-h-80 overflow-auto rounded p-2 text-[10px]" style={{ background: 'var(--page)' }}>
              {JSON.stringify(it.payload, null, 2)}
            </pre>
            <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              This {kindLabel} is versioned; AI-assisted authoring and editing arrive with the research surface.
            </div>
          </details>
        );
      })}
    </div>
  );
}
