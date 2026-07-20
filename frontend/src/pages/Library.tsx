import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { RubricEditor } from '../components/RubricEditor';
import type { ContentItem, Rubric } from '../types';

/** Content library: the versioned rubric editor. */
export default function Library() {
  const qc = useQueryClient();

  const { data: rubrics = [] } = useQuery({
    queryKey: ['content', 'rubrics'],
    queryFn: () => api.get<ContentItem<Rubric>[]>('/api/content/rubrics'),
  });

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Rubrics</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Library
        </h1>
      </header>

      {rubrics.length ? (
        <RubricEditor
          item={rubrics[0]}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['content', 'rubrics'] })}
        />
      ) : (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>No rubrics seeded.</div>
      )}
    </div>
  );
}
