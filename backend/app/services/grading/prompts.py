"""Grading prompts for Mode A (essay + trace), ported from TGFWA
src/lib/grading/prompts.ts.

Evidence-before-score output contract (TGFWA spec §5.2): the model must quote
evidence and reason against the anchors BEFORE emitting a score. "no-evidence"
is a valid outcome, never a guessed score.

The browser client enforced GRADING_SCHEMA via provider structured-output
modes; server-side we run providers through JSON mode (core.llm.llm_chat_json)
and append an explicit output-shape block to the prompt. The engine's
normalize_pass() remains the real guard — it validates and repairs every pass
regardless of what the provider claims to enforce.
"""

GRADING_OUTPUT_SHAPE = """OUTPUT — a single JSON object, exactly this shape:
{
  "evidence": [
    {"turnId": <integer turn id, or null for essay>, "quote": "<VERBATIM student text bearing on the criterion, max ~40 words>", "reasoning": "<how this evidence maps onto the anchored level descriptors>"}
  ],
  "anchorMatched": "<the level descriptor text that best matches the evidence>",
  "score": <integer 0-5, or the string "no-evidence" if the source contains no evidence bearing on this criterion>,
  "selfConfidence": "low" | "med" | "high",
  "styleApplied": "<one short sentence: how the teacher's stated grading style (if any) affected this specific score, or state plainly that none was provided / it wasn't applicable to this criterion's evidence>"
}"""

SHARED_RULES = """Rules (non-negotiable):
1. Score ONLY the single criterion given. Ignore all other qualities of the writing (halo prevention).
2. Evidence before score: first collect verbatim quotes that bear on the criterion, then reason against the anchors, then score.
3. Every quote must appear VERBATIM in the source. Keep each quote under ~40 words.
4. If the source contains no evidence bearing on this criterion, output "no-evidence" as the score. Never guess.
5. Length is not quality: do not reward verbosity.
6. Output only the JSON object.
7. If a teacher grading style is given, state in styleApplied exactly how it affected this score; if none was given or it made no difference, say so explicitly rather than omitting the field."""


def _anchors_block(criterion: dict) -> str:
    return "\n".join(f"  {level}: {desc}"
                     for level, desc in criterion.get("anchors", {}).items())


def _guidance_block(criterion: dict, rubric: dict, style_note: str = "") -> str:
    parts = []
    ag = (rubric.get("assignmentGuidance") or "").strip()
    if ag:
        parts.append(f"ASSIGNMENT GUIDANCE FROM THE TEACHER (apply it):\n{ag}")
    tg = (criterion.get("teacherGuidance") or "").strip()
    if tg:
        parts.append(f"CRITERION GUIDANCE FROM THE TEACHER (apply it):\n{tg}")
    note = (style_note or "").strip()
    if note:
        parts.append(f"TEACHER'S STYLE NOTE FOR THIS CRITERION (apply it):\n{note}")
    return "\n" + "\n\n".join(parts) + "\n" if parts else ""


def build_product_system() -> str:
    return ("You are a careful assessment rater scoring ONE criterion of a high-school "
            "argumentative essay against Maryland College and Career Ready (MCCR) ELA "
            "standards. You produce evidence-cited, criterion-referenced preliminary "
            "scores for a teacher to review. The teacher is the authoritative evaluator."
            f"\n\n{SHARED_RULES}\n\n{GRADING_OUTPUT_SHAPE}")


def build_product_prompt(criterion: dict, essay: str, rubric: dict, style_note: str = "") -> str:
    return f"""CRITERION {criterion['criterionId']} ({criterion['standard']}): {criterion['statement']}

ANCHORED LEVELS (0-5):
{_anchors_block(criterion)}
{_guidance_block(criterion, rubric, style_note)}
STUDENT ESSAY:
<<<
{essay}
>>>

Collect evidence, reason against the anchors, then score this ONE criterion."""


def build_trace_system() -> str:
    return ("You are a careful assessment rater scoring ONE criterion of a student's "
            "writing proficiency using the student's dialogue with an AI assistant "
            "during a writing task. You produce evidence-cited, criterion-referenced "
            "preliminary scores for a teacher to review. The teacher is the "
            "authoritative evaluator.\n\n"
            "STUDENT ATTRIBUTION CONSTRAINT (the most important rule):\n"
            "Only text authored by the STUDENT counts as evidence of the student's "
            "mastery. Text authored by the ASSISTANT never counts, even if the student "
            "copies, accepts, or repeats it. If a student turn merely parrots, "
            "paraphrases, or accepts assistant-authored content (\"yes, use that\", "
            "\"ok thanks\", copy-pasting the assistant's sentence back), that turn is "
            "NOT evidence of student mastery of this criterion. Evidence of mastery is "
            "the student ORIGINATING ideas, evaluating, revising, or reasoning in "
            "their own words.\n\n"
            f"{SHARED_RULES}\n"
            "8. Each evidence quote must come from a turn labeled speaker=\"student\", "
            "and you must report that turnId.\n\n"
            f"{GRADING_OUTPUT_SHAPE}")


def build_trace_prompt(criterion: dict, trace: dict, rubric: dict, style_note: str = "") -> str:
    dialogue = "\n\n".join(
        f"[turn {t['turnId']} | {t['speaker'].upper()}]\n{t['text']}"
        for t in trace.get("turns", [])
    )
    return f"""CRITERION {criterion['criterionId']} ({criterion['standard']}): {criterion['statement']}

ANCHORED LEVELS (0-5):
{_anchors_block(criterion)}
{_guidance_block(criterion, rubric, style_note)}
DIALOGUE TRACE (student ↔ AI assistant during the writing task):
<<<
{dialogue}
>>>

Using ONLY student-authored turns as evidence, assess what this dialogue reveals about the student's OWN mastery of this criterion. Later turns supersede earlier ones (growth within the task is signal). If the dialogue never touches this criterion, score "no-evidence"."""


# ---- Layer B: RelianceScope 3×3 coding ----

SEGMENT_OUTPUT_SHAPE = """OUTPUT — a single JSON object, exactly this shape:
{
  "helpSeeking": "passive" | "active" | "constructive",
  "responseUse": "passive" | "active" | "constructive",
  "verification": true | false,
  "evidence": "<brief quote/paraphrase justifying the coding>"
}"""


def build_segment_system() -> str:
    return ("You code segments of a student-AI writing dialogue on the RelianceScope "
            "3×3 grid (Jin et al., L@S '26). This coding describes HOW the student "
            "worked with the AI. It is NOT a writing-quality score and must never be "
            "influenced by how good the writing is.\n\n"
            "HELP-SEEKING mode (what the student asks for):\n"
            "- passive: asks the AI to produce the work product itself (\"write my "
            "thesis\", \"do the paragraph\").\n"
            "- active: asks targeted questions or requests specific assistance on work "
            "the student is doing (\"is this evidence relevant?\", \"how do I cite "
            "this?\").\n"
            "- constructive: brings the student's own draft/thinking and asks for "
            "critique, verification, or alternatives to weigh (\"here's my claim — "
            "what's the strongest objection to it?\").\n\n"
            "RESPONSE-USE mode (what the student does with the answer):\n"
            "- passive: accepts/copies AI output without engagement.\n"
            "- active: applies or adapts AI output with some modification or "
            "selection.\n"
            "- constructive: evaluates, challenges, verifies, or substantially "
            "transforms AI output; integrates it with the student's own reasoning.\n\n"
            "Also flag verification behavior: the student challenging, fact-checking, "
            "or correcting the AI (Lee et al., CHI 2025).\n"
            "Output only the JSON object.\n\n"
            f"{SEGMENT_OUTPUT_SHAPE}")


def build_segment_prompt(segment_text: str) -> str:
    return f"""DIALOGUE SEGMENT (one student request and the surrounding exchange):
<<<
{segment_text}
>>>

Code this segment: helpSeeking mode, responseUse mode, verification flag, brief evidence."""
