// Mode A grading engine — TypeScript port of
// backend/app/services/grading/engine.py. One criterion per LLM call (halo
// prevention), both channels, 3 passes each with one retry, evidence-provenance
// + student-attribution guards in normalizePass, median+spread aggregation.
// Async (browser) with a concurrency pool instead of a thread pool.

import type { EvidenceItem, Rubric, RubricCriterion, Trace } from '../../types';
import { aggregatePasses, type GradingPass, type PassScore } from './aggregate';
import {
  buildProductPrompt,
  buildProductSystem,
  buildTracePrompt,
  buildTraceSystem,
} from './prompts';

export type LlmJson = (system: string, prompt: string) => Promise<Record<string, unknown>>;

export const PASSES_PER_CRITERION = 3;
export const CONCURRENCY = 6;

export interface Source {
  essay: string;
  trace: Trace;
}

function styleStatus(criterion: RubricCriterion, gradingStyle: string, styleNote: string): string {
  if (!(gradingStyle || '').trim()) return 'none';
  if (styleNote) return 'applied';
  return (criterion as { styleEligible?: boolean }).styleEligible ? 'unavailable' : 'ineligible';
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/["'‘’“”]/g, "'").toLowerCase();
}

export function normalizePass(
  raw: Record<string, unknown>,
  channel: 'trace' | 'product',
  source: Source,
  status = 'none',
): GradingPass {
  const obj = raw && typeof raw === 'object' ? raw : {};

  let score: PassScore;
  const rawScore = obj.score;
  if (rawScore === 'no-evidence' || rawScore === null || rawScore === undefined) {
    score = 'no-evidence';
  } else {
    const n = Math.round(Number(rawScore));
    score = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 'no-evidence';
  }

  const studentTurns = (source.trace?.turns ?? []).filter((t) => t.speaker === 'student');
  const locateInStudentTurns = (quote: string): number | null => {
    const q = normalizeText(quote);
    for (const t of studentTurns) {
      if (normalizeText(t.text ?? '').includes(q)) return t.turnId;
    }
    return null;
  };

  const rawEvidence = Array.isArray(obj.evidence) ? (obj.evidence as unknown[]) : [];
  const evidence: EvidenceItem[] = [];
  for (const e of rawEvidence) {
    if (!e || typeof e !== 'object') continue;
    const quote = (e as { quote?: unknown }).quote;
    const reasoning = (e as { reasoning?: unknown }).reasoning;
    if (typeof quote !== 'string' || !quote) continue;
    const reason = typeof reasoning === 'string' ? reasoning : '';
    if (channel === 'product') {
      if (normalizeText(source.essay ?? '').includes(normalizeText(quote))) {
        evidence.push({ quote, reasoning: reason });
      }
    } else {
      const actualTurnId = locateInStudentTurns(quote);
      if (actualTurnId !== null) {
        evidence.push({ turnId: actualTurnId, quote, reasoning: reason });
      }
    }
  }

  if (score !== 'no-evidence' && evidence.length === 0) score = 'no-evidence';

  let selfConfidence = obj.selfConfidence;
  if (selfConfidence !== 'high' && selfConfidence !== 'low') selfConfidence = 'med';

  let styleApplied: string;
  if (status === 'none') {
    styleApplied = 'No instructor grading style was provided.';
  } else if (status === 'ineligible') {
    styleApplied =
      'This criterion concerns what is argued, not how it is expressed, so the ' +
      "instructor's grading style does not apply to it.";
  } else if (status === 'unavailable') {
    styleApplied =
      'A grading-style adjustment could not be safely generated for this run; no ' +
      'style effect was applied.';
  } else {
    const claimed = obj.styleApplied;
    styleApplied =
      typeof claimed === 'string' && claimed.trim()
        ? claimed.trim()
        : 'Model did not report how the grading style was applied.';
  }

  return {
    score,
    selfConfidence: selfConfidence as GradingPass['selfConfidence'],
    evidence,
    anchorMatched: (obj.anchorMatched as string | undefined) ?? null,
    styleApplied,
  };
}

export async function gradeCriterion(
  llmJson: LlmJson,
  criterion: RubricCriterion,
  channel: 'trace' | 'product',
  rubric: Rubric,
  source: Source,
  gradingStyle = '',
  styleNote = '',
  styleIntensity = '',
) {
  const status = styleStatus(criterion, gradingStyle, styleNote);
  const system = channel === 'product' ? buildProductSystem() : buildTraceSystem();
  const prompt =
    channel === 'product'
      ? buildProductPrompt(criterion, source.essay ?? '', rubric, styleNote)
      : buildTracePrompt(criterion, source.trace ?? { turns: [] } as unknown as Trace, rubric, styleNote);

  const passes: GradingPass[] = [];
  for (let i = 0; i < PASSES_PER_CRITERION; i++) {
    let raw: Record<string, unknown>;
    try {
      raw = await llmJson(system, prompt);
    } catch {
      raw = await llmJson(system, prompt); // one retry per pass; second failure propagates
    }
    passes.push(normalizePass(raw, channel, source, status));
  }

  return aggregatePasses({
    criterionId: criterion.criterionId,
    channel,
    referenceability: criterion.referenceability ?? 'strong',
    passes,
    rubricVersion: rubric.version ?? '',
    styleNote,
    styleIntensity: (gradingStyle || '').trim() ? styleIntensity : '',
  });
}

/** Bounded-concurrency map (replaces the server's ThreadPoolExecutor). */
async function poolMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

export async function gradeSession(opts: {
  llmJson: LlmJson;
  rubric: Rubric;
  essay: string;
  trace: Trace;
  gradingStyle?: string;
  styleNotes?: Record<string, string>;
  styleIntensity?: string;
  onProgress?: (done: number, total: number, label: string) => void;
  onResult?: (record: Awaited<ReturnType<typeof gradeCriterion>>) => void;
}) {
  const styleNotes = opts.styleNotes ?? {};
  const jobs: Array<{ criterion: RubricCriterion; channel: 'trace' | 'product' }> = [];
  for (const c of opts.rubric.criteria ?? []) {
    jobs.push({ criterion: c, channel: 'product' });
    jobs.push({ criterion: c, channel: 'trace' });
  }
  const source: Source = { essay: opts.essay, trace: opts.trace };
  const results: Array<Awaited<ReturnType<typeof gradeCriterion>>> = [];
  let done = 0;

  await poolMap(jobs, CONCURRENCY, async ({ criterion, channel }) => {
    const note = styleNotes[criterion.criterionId] ?? '';
    const record = await gradeCriterion(
      opts.llmJson,
      criterion,
      channel,
      opts.rubric,
      source,
      opts.gradingStyle ?? '',
      note,
      opts.styleIntensity ?? '',
    );
    results.push(record);
    done += 1;
    opts.onProgress?.(done, jobs.length, `${criterion.criterionId} · ${channel}`);
    opts.onResult?.(record);
  });

  return results;
}
