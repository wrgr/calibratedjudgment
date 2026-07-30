import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { RubricEditor } from '../components/RubricEditor';
import type { ContentDraft, ContentItem, ReliabilityStats, Rubric } from '../types';

/** Content library: the versioned rubric editor. */
export default function Library() {
  const qc = useQueryClient();

  const { data: rubrics = [] } = useQuery({
    queryKey: ['content', 'rubrics'],
    queryFn: () => api.get<ContentItem<Rubric>[]>('/api/content/rubrics'),
  });
  const rubric = rubrics[0];

  // Bridges the Admin "Grading reliability" signal to the actual editing
  // surface — surfaces which criteria warrant a rubric revision, without
  // touching the rubric itself (see database.py::mode_a_reliability_stats).
  const { data: reliability } = useQuery({
    queryKey: ['reliability'],
    queryFn: () => api.get<ReliabilityStats>('/api/admin/reliability'),
  });
  const flagged = new Map(
    (reliability?.by_criterion ?? [])
      .filter((c) => c.needs_calibration_review)
      .map((c) => [c.criterion_id, { avgDelta: c.avg_delta ?? 0, overridden: c.overridden }]),
  );

  // Pending LLM-drafted teacherGuidance patches (idea #2) — staged, inactive
  // rubric versions awaiting explicit staff approval before they can ever
  // affect a grading call.
  const { data: drafts = [] } = useQuery({
    queryKey: ['content', 'rubrics', rubric?.contentId, 'drafts'],
    queryFn: () => api.get<ContentDraft<Rubric>[]>(`/api/content/rubrics/${rubric!.contentId}/drafts`),
    enabled: !!rubric,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['content', 'rubrics'] });
  }

  async function draftGuidance(criterionId: string) {
    await api.post(`/api/content/rubrics/${rubric!.contentId}/criteria/${criterionId}/draft-guidance`);
    invalidate();
  }

  async function publishDraft(version: string) {
    await api.post(`/api/content/rubrics/${rubric!.contentId}/versions/${version}/publish`);
    invalidate();
  }

  async function dismissDraft(version: string) {
    await api.post(`/api/content/rubrics/${rubric!.contentId}/versions/${version}/dismiss`);
    invalidate();
  }

  return (
    <div>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--gridline)' }}>
        <div className="kicker">Rubrics</div>
        <h1 className="font-display mt-0.5 text-[1.7rem] leading-tight" style={{ fontWeight: 560 }}>
          Library
        </h1>
      </header>

      {rubric ? (
        <div data-tour="library-rubric">
          <RubricEditor
            item={rubric}
            flagged={flagged}
            drafts={drafts}
            onDraftGuidance={(criterionId) => void draftGuidance(criterionId)}
            onPublishDraft={(version) => void publishDraft(version)}
            onDismissDraft={(version) => void dismissDraft(version)}
            onSaved={invalidate}
          />
        </div>
      ) : (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>No rubrics seeded.</div>
      )}
    </div>
  );
}
