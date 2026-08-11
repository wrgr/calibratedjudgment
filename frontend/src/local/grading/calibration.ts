// Override-driven teacherGuidance drafting — TypeScript port of
// backend/app/services/grading/calibration.py. Drafts only; never writes the
// live rubric (the router stages an inactive version the staff must publish).

import type { RubricCriterion, ScoreRecord } from '../../types';
import type { LlmJson } from './engine';
import { anchorsBlock } from './prompts';

export const MAX_GUIDANCE_CHARS = 600;

function buildSystem(): string {
  return (
    'You help an instructor spot and correct a pattern in how an LLM has been misgrading ' +
    "ONE rubric criterion, using a set of the instructor's own prior corrections as " +
    "evidence. Propose replacement guidance text for that criterion's `teacherGuidance` " +
    'field.\n\n' +
    'Rules (non-negotiable):\n' +
    '1. Output the COMPLETE replacement text for teacherGuidance — not a diff, not an ' +
    'addition to append, a full replacement a rater would read on its own.\n' +
    '2. Do NOT rewrite, quote at length, or restate the anchor level descriptions. You may ' +
    'refer to them only in your own words, briefly.\n' +
    '3. Do NOT change what floor behavior (level 0/1) means — a genuinely absent or ' +
    'incoherent effort must still score at the floor.\n' +
    '4. Base the guidance only on the pattern actually visible across the corrections ' +
    'given — do not invent a rationale beyond what the evidence supports, and do not ' +
    'address any criterion other than the one given.\n' +
    '5. Keep it concise: a rater-facing instruction, not an essay.\n' +
    '6. Output only the JSON object.\n\n' +
    'OUTPUT — a single JSON object, exactly this shape:\n' +
    '{"teacherGuidance": "<complete replacement guidance text>"}'
  );
}

function buildPrompt(
  criterion: RubricCriterion,
  currentGuidance: string,
  overrideRows: ScoreRecord[],
): string {
  const corrections = overrideRows
    .map(
      (r) =>
        `- LLM scored ${r.median}, instructor corrected to ${r.teacherOverride?.score}. ` +
        `Instructor's rationale: ${r.teacherOverride?.rationale}`,
    )
    .join('\n\n');
  return `CRITERION ${criterion.criterionId} (${criterion.dimension ?? ''}): ${criterion.statement}

ANCHORED LEVELS (0-5) — for context only, do not restate these:
${anchorsBlock(criterion)}

CURRENT teacherGuidance (may be empty):
<<<
${currentGuidance.trim()}
>>>

INSTRUCTOR CORRECTIONS TO LEARN FROM:
${corrections}

Propose complete replacement guidance for this criterion's teacherGuidance field
that would help a future LLM rater avoid the pattern shown in these corrections.`;
}

export function validateGuidanceDraft(draft: string): boolean {
  if (typeof draft !== 'string' || !draft.trim()) return false;
  if (draft.length > MAX_GUIDANCE_CHARS) return false;
  if (draft.includes('ANCHORED LEVELS')) return false;
  const anchorLines = draft
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 2 && /\d/.test(t[0]) && t[1] === ':';
    }).length;
  return anchorLines < 2;
}

export async function draftGuidance(
  llmJson: LlmJson,
  criterion: RubricCriterion,
  currentGuidance: string,
  overrideRows: ScoreRecord[],
): Promise<string | null> {
  if (!overrideRows.length) return null;
  let raw: Record<string, unknown>;
  try {
    raw = await llmJson(buildSystem(), buildPrompt(criterion, currentGuidance, overrideRows));
  } catch {
    raw = await llmJson(buildSystem(), buildPrompt(criterion, currentGuidance, overrideRows));
  }
  const draft = (raw && typeof raw === 'object' ? raw.teacherGuidance : undefined) as unknown;
  if (typeof draft !== 'string' || !draft.trim()) return null;
  return draft.trim();
}
