// Per-criterion grading-style "reconciliation notes" — TypeScript port of
// backend/app/services/grading/molding.py. A short scoped note per styleEligible
// criterion, never an anchor rewrite. (The browser build molds fresh per grade
// rather than caching in a DB table; the anti-rewrite/length guards are identical.)

import type { Rubric, RubricCriterion } from '../../types';
import type { LlmJson } from './engine';
import { anchorsBlock } from './prompts';

export const MAX_NOTE_CHARS = 240;
export const DEFAULT_INTENSITY = 'moderate';

const INTENSITY_CLAUSE: Record<string, string> = {
  subtle:
    'Mention the style only where it is clearly and directly relevant; when a call is ' +
    "close, lean toward the anchors' literal language.",
  moderate:
    'Where the essay is a genuine borderline case between two anchor levels, let the ' +
    'stated style tip the balance.',
  strong:
    'Actively favor the interpretation that aligns with the stated style whenever the ' +
    'anchors reasonably permit it; treat borderline calls generously toward the style, ' +
    'not just as a light tiebreaker.',
};

export const VALID_INTENSITIES = new Set(Object.keys(INTENSITY_CLAUSE));

export function eligibleCriteria(rubric: Rubric): RubricCriterion[] {
  return (rubric.criteria ?? []).filter(
    (c) => (c as { styleEligible?: boolean }).styleEligible,
  );
}

function buildMoldSystem(intensity: string): string {
  const clause = INTENSITY_CLAUSE[intensity] ?? INTENSITY_CLAUSE[DEFAULT_INTENSITY];
  return (
    "You help an instructor's stated grading-style preference apply consistently to a " +
    'fixed assessment rubric. For EACH criterion given, write ONE short reconciliation ' +
    "note (max ~40 words) explaining how a rater should read that criterion's anchors in " +
    "light of the instructor's style.\n\n" +
    'Rules (non-negotiable):\n' +
    '1. Do NOT rewrite, replace, or restate the anchor level descriptions. Write a short ' +
    'interpretive note only.\n' +
    '2. Do NOT change what floor behavior (level 0/1) means — a genuinely absent or ' +
    'incoherent effort must still score at the floor regardless of style.\n' +
    '3. Only address the criteria given to you. Never invent a note for a criterion not ' +
    'listed.\n' +
    '4. Output only the JSON object.\n' +
    `5. ${clause}\n\n` +
    'OUTPUT — a single JSON object, exactly this shape:\n' +
    '{"notes": [{"criterionId": "<id from the list given>", "note": "<short note>"}]}'
  );
}

function buildMoldPrompt(eligible: RubricCriterion[], gradingStyle: string): string {
  const block = eligible
    .map(
      (c) =>
        `CRITERION ${c.criterionId} (${c.dimension ?? ''}): ${c.statement}\n` +
        `ANCHORED LEVELS (0-5):\n${anchorsBlock(c)}`,
    )
    .join('\n\n');
  return `TEACHER'S STATED GRADING STYLE:
<<<
${gradingStyle.trim()}
>>>

CRITERIA ELIGIBLE FOR A STYLE RECONCILIATION NOTE (these are the ONLY criteria you may address):
${block}

For each criterion above, write one short reconciliation note.`;
}

export function validateMold(notes: Record<string, string>, eligible: RubricCriterion[]): boolean {
  const eligibleIds = new Set(eligible.map((c) => c.criterionId));
  for (const [cid, note] of Object.entries(notes)) {
    if (!eligibleIds.has(cid)) return false;
    if (typeof note !== 'string' || note.length > MAX_NOTE_CHARS) return false;
    if (note.includes('ANCHORED LEVELS')) return false;
    const anchorLines = note
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t.length > 2 && /\d/.test(t[0]) && t[1] === ':';
      }).length;
    if (anchorLines >= 2) return false;
  }
  return true;
}

export async function moldNotes(
  llmJson: LlmJson,
  rubric: Rubric,
  gradingStyle: string,
  intensity: string = DEFAULT_INTENSITY,
): Promise<Record<string, string>> {
  const eligible = eligibleCriteria(rubric);
  const style = (gradingStyle || '').trim();
  if (!style || !eligible.length) return {};
  if (!VALID_INTENSITIES.has(intensity)) intensity = DEFAULT_INTENSITY;

  const eligibleIds = new Set(eligible.map((c) => c.criterionId));
  const system = buildMoldSystem(intensity);
  const prompt = buildMoldPrompt(eligible, style);
  let raw: Record<string, unknown>;
  try {
    raw = await llmJson(system, prompt);
  } catch {
    raw = await llmJson(system, prompt);
  }

  const rawNotes = (raw && typeof raw === 'object' ? raw.notes : undefined) as unknown;
  if (!Array.isArray(rawNotes)) return {};

  const notes: Record<string, string> = {};
  for (const entry of rawNotes) {
    if (!entry || typeof entry !== 'object') continue;
    const cid = (entry as { criterionId?: unknown }).criterionId;
    const note = (entry as { note?: unknown }).note;
    if (typeof cid !== 'string' || !eligibleIds.has(cid)) continue;
    if (typeof note !== 'string' || !note.trim()) continue;
    notes[cid] = note.trim().slice(0, MAX_NOTE_CHARS);
  }
  if (!validateMold(notes, eligible)) return {};
  return notes;
}
