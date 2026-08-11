// Layer B: RelianceScope 3×3 AI-reliance coding — TypeScript port of
// backend/app/services/grading/layerb.py. Describes HOW the student worked with
// the AI; never blended with the Layer A writing score.

import type { LayerBResult, RelianceLabel, RelianceMode, SegmentCoding, Trace, TraceTurn } from '../../types';
import type { LlmJson } from './engine';
import { buildSegmentPrompt, buildSegmentSystem } from './prompts';

const MODES: RelianceMode[] = ['passive', 'active', 'constructive'];

export function segmentTrace(trace: Trace): TraceTurn[][] {
  const segments: TraceTurn[][] = [];
  const turns = trace.turns ?? [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== 'student') continue;
    const seg: TraceTurn[] = [];
    if (i > 0 && turns[i - 1].speaker === 'assistant') seg.push(turns[i - 1]);
    seg.push(turns[i]);
    if (i + 1 < turns.length && turns[i + 1].speaker === 'assistant') seg.push(turns[i + 1]);
    segments.push(seg);
  }
  return segments;
}

function emptyGrid(): Record<RelianceMode, Record<RelianceMode, number>> {
  const grid = {} as Record<RelianceMode, Record<RelianceMode, number>>;
  for (const h of MODES) {
    grid[h] = { passive: 0, active: 0, constructive: 0 };
  }
  return grid;
}

export function summarizeSegments(segments: SegmentCoding[]): LayerBResult {
  if (!segments.length) {
    return {
      segments: [],
      grid: emptyGrid(),
      dominantHelpSeeking: 'passive',
      dominantResponseUse: 'passive',
      interpretiveLabel: 'undetermined',
      verificationRate: 0,
    };
  }

  const grid = emptyGrid();
  for (const s of segments) grid[s.helpSeeking][s.responseUse] += 1;

  const count = (dim: 'helpSeeking' | 'responseUse', mode: RelianceMode) =>
    segments.filter((s) => s[dim] === mode).length;
  const dominant = (dim: 'helpSeeking' | 'responseUse'): RelianceMode => {
    let best: RelianceMode = 'passive';
    for (const m of MODES) if (count(dim, m) > count(dim, best)) best = m;
    return best;
  };

  const dominantHelpSeeking = dominant('helpSeeking');
  const dominantResponseUse = dominant('responseUse');
  const verificationRate = segments.filter((s) => s.verification).length / segments.length;

  let label: RelianceLabel;
  if (dominantResponseUse === 'passive' && verificationRate < 0.2) label = 'thoughtless';
  else if (dominantResponseUse === 'constructive' && dominantHelpSeeking === 'constructive')
    label = 'collaborative';
  else if (verificationRate >= 0.5) label = 'reflective';
  else label = 'cautious';

  return {
    segments,
    grid,
    dominantHelpSeeking,
    dominantResponseUse,
    interpretiveLabel: label,
    verificationRate,
  };
}

export async function codeLayerB(
  llmJson: LlmJson,
  trace: Trace,
  onProgress?: (done: number, total: number) => void,
): Promise<LayerBResult> {
  const rawSegments = segmentTrace(trace);
  const codings: SegmentCoding[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const text = seg
      .map((t) => `[turn ${t.turnId} | ${t.speaker.toUpperCase()}]\n${t.text}`)
      .join('\n\n');
    let raw: Record<string, unknown>;
    try {
      raw = await llmJson(buildSegmentSystem(), buildSegmentPrompt(text));
    } catch {
      raw = await llmJson(buildSegmentSystem(), buildSegmentPrompt(text));
    }
    const obj = raw && typeof raw === 'object' ? raw : {};
    const helpSeeking = obj.helpSeeking as RelianceMode;
    const responseUse = obj.responseUse as RelianceMode;
    if (!MODES.includes(helpSeeking) || !MODES.includes(responseUse)) {
      onProgress?.(i + 1, rawSegments.length);
      continue;
    }
    codings.push({
      segmentTurns: seg.map((t) => t.turnId),
      helpSeeking,
      responseUse,
      verification: Boolean(obj.verification),
      evidence: typeof obj.evidence === 'string' ? obj.evidence : '',
    });
    onProgress?.(i + 1, rawSegments.length);
  }
  return summarizeSegments(codings);
}
