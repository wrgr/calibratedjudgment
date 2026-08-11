// Grading prompts — TypeScript port of backend/app/services/grading/prompts.py
// (itself a port of TGFWA prompts.ts). Kept byte-for-byte in step with the
// Python so a browser-graded session and a backend-graded session ask the model
// the same questions. Evidence-before-score contract; "no-evidence" is valid.

import type { Rubric, RubricCriterion, Trace } from '../../types';

export const GRADING_OUTPUT_SHAPE = `OUTPUT — a single JSON object, exactly this shape:
{
  "evidence": [
    {"turnId": <integer turn id, or null for essay>, "quote": "<VERBATIM student text bearing on the criterion, max ~40 words>", "reasoning": "<how this evidence maps onto the anchored level descriptors>"}
  ],
  "anchorMatched": "<the level descriptor text that best matches the evidence>",
  "score": <integer 0-5, or the string "no-evidence" if the source contains no evidence bearing on this criterion>,
  "selfConfidence": "low" | "med" | "high",
  "styleApplied": "<one short sentence: how the teacher's stated grading style (if any) affected this specific score, or state plainly that none was provided / it wasn't applicable to this criterion's evidence>"
}`;

export const SHARED_RULES = `Rules (non-negotiable):
1. Score ONLY the single criterion given. Ignore all other qualities of the writing (halo prevention).
2. Evidence before score: first collect verbatim quotes that bear on the criterion, then reason against the anchors, then score.
3. Every quote must appear VERBATIM in the source. Keep each quote under ~40 words.
4. If the source contains no evidence bearing on this criterion, output "no-evidence" as the score. Never guess.
5. Length is not quality: do not reward verbosity.
6. Output only the JSON object.
7. If a teacher grading style is given, state in styleApplied exactly how it affected this score; if none was given or it made no difference, say so explicitly rather than omitting the field.`;

export function anchorsBlock(criterion: RubricCriterion): string {
  return Object.entries(criterion.anchors ?? {})
    .map(([level, desc]) => `  ${level}: ${desc}`)
    .join('\n');
}

function guidanceBlock(criterion: RubricCriterion, rubric: Rubric, styleNote = ''): string {
  const parts: string[] = [];
  const ag = (rubric.assignmentGuidance ?? '').trim();
  if (ag) parts.push(`ASSIGNMENT GUIDANCE FROM THE TEACHER (apply it):\n${ag}`);
  const tg = (criterion.teacherGuidance ?? '').trim();
  if (tg) parts.push(`CRITERION GUIDANCE FROM THE TEACHER (apply it):\n${tg}`);
  const note = (styleNote ?? '').trim();
  if (note) parts.push(`TEACHER'S STYLE NOTE FOR THIS CRITERION (apply it):\n${note}`);
  return parts.length ? '\n' + parts.join('\n\n') + '\n' : '';
}

export function buildProductSystem(): string {
  return (
    'You are a careful assessment rater scoring ONE criterion of a high-school ' +
    'argumentative essay against Maryland College and Career Ready (MCCR) ELA ' +
    'standards. You produce evidence-cited, criterion-referenced preliminary ' +
    'scores for a teacher to review. The teacher is the authoritative evaluator.' +
    `\n\n${SHARED_RULES}\n\n${GRADING_OUTPUT_SHAPE}`
  );
}

export function buildProductPrompt(
  criterion: RubricCriterion,
  essay: string,
  rubric: Rubric,
  styleNote = '',
): string {
  return `CRITERION ${criterion.criterionId} (${criterion.standard}): ${criterion.statement}

ANCHORED LEVELS (0-5):
${anchorsBlock(criterion)}
${guidanceBlock(criterion, rubric, styleNote)}
STUDENT ESSAY:
<<<
${essay}
>>>

Collect evidence, reason against the anchors, then score this ONE criterion.`;
}

export function buildTraceSystem(): string {
  return (
    'You are a careful assessment rater scoring ONE criterion of a student\'s ' +
    'writing proficiency using the student\'s dialogue with an AI assistant ' +
    'during a writing task. You produce evidence-cited, criterion-referenced ' +
    'preliminary scores for a teacher to review. The teacher is the ' +
    'authoritative evaluator.\n\n' +
    'STUDENT ATTRIBUTION CONSTRAINT (the most important rule):\n' +
    'Only text authored by the STUDENT counts as evidence of the student\'s ' +
    'mastery. Text authored by the ASSISTANT never counts, even if the student ' +
    'copies, accepts, or repeats it. If a student turn merely parrots, ' +
    'paraphrases, or accepts assistant-authored content ("yes, use that", ' +
    '"ok thanks", copy-pasting the assistant\'s sentence back), that turn is ' +
    'NOT evidence of student mastery of this criterion. Evidence of mastery is ' +
    'the student ORIGINATING ideas, evaluating, revising, or reasoning in ' +
    'their own words.\n\n' +
    `${SHARED_RULES}\n` +
    '8. Each evidence quote must come from a turn labeled speaker="student", ' +
    'and you must report that turnId.\n\n' +
    `${GRADING_OUTPUT_SHAPE}`
  );
}

export function buildTracePrompt(
  criterion: RubricCriterion,
  trace: Trace,
  rubric: Rubric,
  styleNote = '',
): string {
  const dialogue = (trace.turns ?? [])
    .map((t) => `[turn ${t.turnId} | ${t.speaker.toUpperCase()}]\n${t.text}`)
    .join('\n\n');
  return `CRITERION ${criterion.criterionId} (${criterion.standard}): ${criterion.statement}

ANCHORED LEVELS (0-5):
${anchorsBlock(criterion)}
${guidanceBlock(criterion, rubric, styleNote)}
DIALOGUE TRACE (student ↔ AI assistant during the writing task):
<<<
${dialogue}
>>>

Using ONLY student-authored turns as evidence, assess what this dialogue reveals about the student's OWN mastery of this criterion. Later turns supersede earlier ones (growth within the task is signal). If the dialogue never touches this criterion, score "no-evidence".`;
}

// ---- Layer B: RelianceScope 3×3 coding ----

export const SEGMENT_OUTPUT_SHAPE = `OUTPUT — a single JSON object, exactly this shape:
{
  "helpSeeking": "passive" | "active" | "constructive",
  "responseUse": "passive" | "active" | "constructive",
  "verification": true | false,
  "evidence": "<brief quote/paraphrase justifying the coding>"
}`;

export function buildSegmentSystem(): string {
  return (
    'You code segments of a student-AI writing dialogue on the RelianceScope ' +
    '3×3 grid (Jin et al., L@S \'26). This coding describes HOW the student ' +
    'worked with the AI. It is NOT a writing-quality score and must never be ' +
    'influenced by how good the writing is.\n\n' +
    'HELP-SEEKING mode (what the student asks for):\n' +
    '- passive: asks the AI to produce the work product itself ("write my ' +
    'thesis", "do the paragraph").\n' +
    '- active: asks targeted questions or requests specific assistance on work ' +
    'the student is doing ("is this evidence relevant?", "how do I cite ' +
    'this?").\n' +
    '- constructive: brings the student\'s own draft/thinking and asks for ' +
    'critique, verification, or alternatives to weigh ("here\'s my claim — ' +
    'what\'s the strongest objection to it?").\n\n' +
    'RESPONSE-USE mode (what the student does with the answer):\n' +
    '- passive: accepts/copies AI output without engagement.\n' +
    '- active: applies or adapts AI output with some modification or ' +
    'selection.\n' +
    '- constructive: evaluates, challenges, verifies, or substantially ' +
    'transforms AI output; integrates it with the student\'s own reasoning.\n\n' +
    'Also flag verification behavior: the student challenging, fact-checking, ' +
    'or correcting the AI (Lee et al., CHI 2025).\n' +
    'Output only the JSON object.\n\n' +
    `${SEGMENT_OUTPUT_SHAPE}`
  );
}

export function buildSegmentPrompt(segmentText: string): string {
  return `DIALOGUE SEGMENT (one student request and the surrounding exchange):
<<<
${segmentText}
>>>

Code this segment: helpSeeking mode, responseUse mode, verification flag, brief evidence.`;
}
