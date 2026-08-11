// Trace-vs-product divergence — TypeScript port of
// backend/app/services/grading/divergence.py, operating on the camelCase
// ScoreRecord the store keeps. Interpretive frames are HYPOTHESES, not verdicts.

import type {
  DimensionDivergence,
  DivergenceInterpretation,
  LayerBResult,
  Rubric,
  ScoreRecord,
} from '../../types';
import { median } from './aggregate';

export function effectiveScore(record: ScoreRecord): number | null {
  if (record.teacherOverride) return record.teacherOverride.score;
  return record.noEvidence ? null : record.median;
}

export function computeDivergence(rubric: Rubric, scores: ScoreRecord[]): DimensionDivergence[] {
  const dims = new Map<string, { standard: string; criterionIds: string[] }>();
  for (const c of rubric.criteria ?? []) {
    const d = dims.get(c.dimension) ?? { standard: c.standard, criterionIds: [] };
    d.criterionIds.push(c.criterionId);
    dims.set(c.dimension, d);
  }

  const byKey = new Map<string, ScoreRecord>();
  for (const s of scores) byKey.set(`${s.criterionId}|${s.channel}`, s);

  const result: DimensionDivergence[] = [];
  for (const [dimension, info] of dims) {
    const chan = (channel: 'trace' | 'product'): number | null => {
      const vals = info.criterionIds
        .map((cid) => byKey.get(`${cid}|${channel}`))
        .filter((r): r is ScoreRecord => Boolean(r))
        .map(effectiveScore)
        .filter((v): v is number => v !== null);
      return vals.length ? median(vals) : null;
    };
    const traceScore = chan('trace');
    const productScore = chan('product');
    result.push({
      dimension,
      standard: info.standard,
      traceScore,
      productScore,
      divergence:
        traceScore !== null && productScore !== null ? productScore - traceScore : null,
      criterionIds: info.criterionIds,
    });
  }
  return result;
}

export function interpretDivergence(
  dims: DimensionDivergence[],
  layerB: LayerBResult | null,
): DivergenceInterpretation {
  const withBoth = dims.filter((d) => d.divergence !== null);
  if (!withBoth.length) {
    return {
      headline: 'Not enough overlapping evidence to compare channels',
      detail:
        'Most criteria surfaced in only one channel. This is expected for short ' +
        'dialogues — no divergence inference is made.',
      tone: 'neutral',
    };
  }
  const mean = withBoth.reduce((a, d) => a + (d.divergence ?? 0), 0) / withBoth.length;
  const passiveReliance =
    layerB !== null &&
    (layerB.interpretiveLabel === 'thoughtless' ||
      (layerB.dominantResponseUse === 'passive' && (layerB.verificationRate ?? 0) < 0.3));
  const constructive = layerB !== null && layerB.interpretiveLabel === 'collaborative';

  if (mean >= 1 && passiveReliance) {
    return {
      headline:
        'Hypothesis: possible over-reliance — essay quality may not reflect student capability',
      detail:
        'Product scores substantially exceed trace-inferred mastery, and the reliance ' +
        'profile is passive/thoughtless. The polish of the final essay may come from the ' +
        'AI rather than the student. Formative flag: probe the flagged dimensions in ' +
        'conference or an unassisted task.',
      tone: 'flag',
    };
  }
  if (mean >= 1) {
    return {
      headline: 'Product exceeds trace — interpret with the reliance profile in mind',
      detail:
        'The final essay scores higher than the dialogue-inferred estimates. The reliance ' +
        'profile does not look passive, so this may reflect drafting/revision work not ' +
        'visible in the dialogue — but verify before crediting.',
      tone: 'neutral',
    };
  }
  if (mean <= -1) {
    return {
      headline: 'Hypothesis: execution gap — understanding shown in dialogue, not in the artifact',
      detail:
        'Trace-inferred mastery exceeds the product scores: the student demonstrates ' +
        'understanding in conversation but fails to execute it in the essay. Instructional ' +
        'target is transfer/execution (drafting, time, integration), not concepts.',
      tone: 'target',
    };
  }
  if (constructive) {
    return {
      headline:
        'Channels converge with constructive engagement — strongest validity for these scores',
      detail:
        'Trace and product estimates agree, and the student engaged constructively with the ' +
        'AI. Divergence analysis raises no flags; the rubric scores can be read at face value ' +
        '(pending teacher review of routed items).',
      tone: 'valid',
    };
  }
  return {
    headline: 'Channels roughly converge',
    detail:
      'Trace and product estimates agree within one point on average. Review per-dimension ' +
      'rows for local exceptions.',
    tone: 'neutral',
  };
}
