// Pass aggregation — TypeScript port of backend/app/services/grading/aggregate.py.
// Same rules: majority no-evidence (or no numeric passes) → no-evidence; else
// median score + inter-pass spread; confidence from evidence count, agreement,
// and referenceability; teacher-reserve or spread≥2 routes to the instructor.
// Emits the camelCase ScoreRecord the store and UI consume directly.

import type { EvidenceItem, ScoreRecord } from '../../types';

export type PassScore = number | 'no-evidence';

export interface GradingPass {
  score: PassScore;
  selfConfidence: 'low' | 'med' | 'high';
  evidence: EvidenceItem[];
  anchorMatched?: string | null;
  styleApplied?: string | null;
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function utcStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function aggregatePasses(opts: {
  criterionId: string;
  channel: 'trace' | 'product';
  referenceability: string;
  passes: GradingPass[];
  rubricVersion: string;
  styleNote?: string;
  styleIntensity?: string;
}): ScoreRecord {
  const { criterionId, channel, referenceability, passes, rubricVersion } = opts;
  const styleNote = opts.styleNote ?? '';
  const styleIntensity = opts.styleIntensity ?? '';

  const numeric = passes
    .map((p) => p.score)
    .filter((s): s is number => typeof s === 'number');
  const noEvidenceCount = passes.length - numeric.length;
  const noEvidence = noEvidenceCount > passes.length / 2 || numeric.length === 0;

  const med = noEvidence ? null : median(numeric);
  const spread = noEvidence || numeric.length < 2 ? null : Math.max(...numeric) - Math.min(...numeric);

  let evidence: EvidenceItem[] = [];
  let anchorMatched: string | null = null;
  let styleApplied: string | null = null;
  if (!noEvidence && med !== null) {
    const scored = passes.filter((p) => typeof p.score === 'number');
    let rep: GradingPass | null = null;
    let best = Infinity;
    for (const p of scored) {
      const d = Math.abs((p.score as number) - med);
      if (d < best) {
        best = d;
        rep = p;
      }
    }
    if (rep) {
      evidence = rep.evidence ?? [];
      anchorMatched = rep.anchorMatched ?? null;
      styleApplied = rep.styleApplied ?? null;
    }
  } else if (passes.length) {
    styleApplied = passes[0].styleApplied ?? null;
  }

  const distinctEvidence = new Set(evidence.map((e) => e.quote.trim().toLowerCase())).size;

  let confidence: ScoreRecord['confidence'];
  if (noEvidence) confidence = 'low';
  else if (referenceability === 'weak') confidence = 'low';
  else if ((spread ?? 0) >= 2) confidence = 'low';
  else if (distinctEvidence >= 2 && (spread ?? 0) <= 1) confidence = 'high';
  else confidence = 'med';

  const reviewReasons: string[] = [];
  if (referenceability === 'weak') {
    reviewReasons.push(
      'Teacher-reserve criterion (weak referenceability) — LLM read is advisory only',
    );
  }
  if ((spread ?? 0) >= 2) {
    reviewReasons.push(
      `High inter-pass spread (${spread}) — possible rubric ambiguity or borderline case`,
    );
  }

  return {
    criterionId,
    channel,
    passes: passes.map((p) => p.score),
    median: med,
    spread,
    noEvidence,
    confidence,
    evidence,
    anchorMatched,
    styleApplied,
    styleNote: styleNote || null,
    styleIntensity: styleIntensity || null,
    rubricVersion,
    gradedAt: utcStamp(),
    teacherOverride: null,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}
