# Calibrated Judgment: Dual-Channel Rubric Scoring and Override-Driven Calibration for AI-Assisted Student Writing

*Working draft — system and methodology contribution. Score validity against human
grades is stated as future work, not claimed here.*

**Target venue:** LAK (Learning Analytics & Knowledge); alternatives L@S, BEA @ ACL/NAACL.

---

## Abstract

A finished essay tells you what was produced but not who produced it — an
increasingly load-bearing distinction now that every student writes beside a
capable AI assistant. We present **Calibrated Judgment**, a writing-assessment
platform built on a simple structural idea: grade the *same* argumentative-writing
rubric **twice** — once against the finished essay (the *product* channel) and once
against the transcript of the student's dialogue with an AI assistant (the *process*
or *trace* channel) — and treat the **signed gap between the two** as the primary
analytic construct. A large product-over-process gap paired with a passive
reliance profile is a hypothesis of over-reliance; a process-over-product gap is an
execution/transfer gap; convergence with constructive engagement is the strongest
case for reading the scores at face value.

Three mechanisms make the dual-channel signal trustworthy enough to act on. (1)
**Halo-controlled, criterion-referenced LLM scoring**: one rubric criterion per
model call, three passes, reported as a median with an inter-pass spread, and an
**evidence-provenance guard** that drops any justification whose quotes do not
appear verbatim in the source. (2) A **student-attribution guard** that reframes
authorship attribution as an *evidence-admissibility* rule: on the process channel,
assistant-authored text — even when the student copies it back verbatim — is
inadmissible as evidence of the student's own mastery. (3) An **override-driven,
per-criterion calibration loop**: instructor score overrides accumulate as a
labeled miscalibration ledger; a reliability dashboard surfaces criteria the model
is consistently wrong about; and the system drafts a replacement guidance text for
such a criterion from the override history, staged as an *inactive, versioned*
rubric that a human must publish. Every score is stamped with the exact rubric
version that produced it, making "I changed the guidance, re-graded, and the score
moved" a reproducible claim rather than an anecdote.

We describe the constructs, the scoring method, the guards, and the calibration
loop, and position each against recent work in LLM-based automated essay scoring,
LLM-as-judge calibration, AI-reliance taxonomies, and human-in-the-loop rubric
refinement. We argue the dual-channel divergence framing and the versioned,
override-driven calibration discipline are the contributions with no direct prior
equal, and we lay out the validation study the design is built to support.

**Keywords:** automated essay scoring; LLM-as-a-judge; process vs. product
assessment; AI reliance; human-in-the-loop calibration; evidence-centered design;
academic integrity.

---

## 1. Introduction

Automated and LLM-assisted essay scoring has become good enough to be tempting and
not yet good enough to be trusted. The problem is no longer only measurement noise;
it is a shift in *what a finished artifact can testify to*. When a student submits
an essay written with an AI assistant, the text is evidence of a **joint**
human–AI product, and the rubric score — however well-calibrated — silently
attributes the whole of it to the student.

Existing responses split along two lines. **Detection** approaches ask whether a
text was AI-written, either from the text itself or from behavioral traces such as
keystroke logs [13]; these are authenticity classifiers, not competence estimates.
**Process-oriented** approaches grade the writing process, but typically score
prompt quality or interaction features on a *separate* instrument from the one used
to grade the essay [14], so the process and product measurements are not directly
comparable.

We take a different structural stance. If the goal is to estimate a student's
*own* writing mastery in an AI-assisted setting, then the dialogue the student had
with the assistant is a second, independent source of evidence about the *same*
rubric criteria. Scoring both channels on the same atomic criteria makes their
disagreement meaningful: the **product-minus-process divergence**, read per rubric
dimension, becomes a formative signal about where the artifact may be outrunning
the student — or where the student's demonstrated understanding is not making it
into the artifact.

This paper contributes:

1. **A dual-channel divergence construct** (§4.4): the same argumentative-writing
   rubric applied to both the essay and the AI-dialogue trace, with a signed
   per-dimension gap interpreted directionally as a hypothesis, not a verdict.
2. **A student-attribution guard as evidence-admissibility** (§4.2): on the
   process channel, assistant-authored text is inadmissible as evidence of student
   mastery, enforced by prompt constraint *and* a server/engine-side verbatim
   quote-in-student-turn check, and stress-tested by an adversarial "parrot"
   exemplar.
3. **An override-driven, per-criterion, versioned calibration loop** (§4.5):
   instructor overrides as a passive miscalibration ledger, a per-criterion
   reliability dashboard, human-gated LLM-drafted guidance staged as an inactive
   rubric version, and per-score rubric-version stamping for reproducibility.
4. **A deployable reference implementation** (§5) whose grading engine runs both
   server-side and, unchanged in behavior, entirely client-side in a
   bring-your-own-key static web build — lowering the barrier to instructor
   adoption and independent replication.

We are explicit about scope: this is a **design and mechanism** contribution. The
platform produces evidence and its own uncertainty, not certified grades, and we
have not yet run the human-agreement study that would license validity claims. §6
specifies that study.

## 2. Related Work

**LLM-based automated essay scoring (AES).** Recent work finds that
criterion-referenced, per-dimension prompting aligns best with human judgment,
that adding free-text justifications does *not* reliably improve concordance, and
that lower decoding temperature helps [8]; grading-scale granularity also matters,
with 0–5 scales maximizing human–LLM alignment in at least one systematic study
[9]. These results motivate our anchored 0–5, one-criterion-per-call design.
Two well-documented failure modes shape our guards: **halo/order effects and
non-independence across criteria**, whose recommended mitigation is to score each
criterion in a separate call and ensemble across samples; and **unfaithful
self-explanation**, where model rationales are coherent but not causally tied to
the decision [10]. Multi-sample variance as a hallucination signal is the principle
behind our three-pass median-plus-spread aggregation [11].

**LLM-as-a-judge calibration.** Judges are systematically overconfident relative to
their accuracy, motivating routing uncertain cases to humans [12]. Post-hoc methods
calibrate a judge's *confidence*. Our loop is different in kind: it recalibrates the
*criterion guidance text* using accumulated human overrides, and uses inter-pass
spread only as a lightweight uncertainty proxy for routing.

**Process vs. product; capability gaps.** Keystroke-log methods distinguish
authentic composition from transcription with high accuracy [13] but operate on
timing, not on the semantic content of the human–AI dialogue. Dashboards that
rubric-score the dialogue channel score prompt quality for feedback rather than
applying the essay's rubric to enable a divergence comparison [14]. Capability-gap
studies typically estimate over-reliance from *separate* assisted-vs-independent
tasks or post-hoc exams [16], and find that students' *self-reported* reliance does
not track the actual competence gap [15] — a direct motivation for a *behavioral*,
same-rubric divergence signal over self-report.

**AI-reliance taxonomies.** RelianceScope [1] operationalizes reliance as a
3×3 grid of help-seeking mode × response-use mode with engagement gradations; it is
the direct parent of our Layer B coding. RelianceScope is applied post-hoc by
researchers; we run an adapted version as a live, orthogonal-to-score coding layer
and add a per-segment verification-behavior flag. Interpretive labeling of reliance
draws on critical-thinking/reliance work [2]. Related reliance measures include an
interaction-centered human–LM reliance metric [20], a writing-specific reliance
typology [21], and intervention studies on appropriate reliance [17].

**Human-in-the-loop rubric refinement.** This is the closest neighbor to our
calibration loop. GradeHITL [3] has the LLM ask experts targeted questions and
rewrite the rubric from their answers; GradeOpt [4] and CoTAL [5] refine
guidelines/prompts from feedback; confusion-aware methods optimize rubrics where the
model is systematically confused [6]. Our differentiators (§4.5): the calibration
corpus is *passive instructor overrides* (labels teachers produce anyway, not
solicited Q&A); the trigger is a per-criterion override-frequency and
signed/absolute-delta ledger; the redraft is staged as an *inactive, versioned*
rubric that is never auto-applied; and every score is stamped with its producing
rubric version for reproducibility. The planned score-level calibration layer builds
on LLM-Rubric's human-calibrated rubric scoring [7].

## 3. System overview

Calibrated Judgment is grounded in Evidence-Centered Design [18]: every scored
signal traces to a named writing standard and a named theoretical source, and the
platform enforces a "no row, no claim" rule — a signal may render as a claim only if
an evidence table states what it supports, how much confidence it can bear, and the
alternatives it does not rule out.

The system assesses **two constructs that are never blended into one score**:

- **Layer A — writing-standard mastery.** Twelve atomic criteria mapped to Maryland
  College and Career Ready (MCCR) standards for grades 11–12 argumentative writing,
  each with six behaviorally anchored levels (0–5) following trait-level AES
  practice [19]. Two holistic criteria (audience awareness; sophistication of
  reasoning) are marked *teacher-reserve*: still scored, but advisory and always
  routed to a human, because such holistic judgments have poor LLM discriminative
  validity. Layer A is scored on **both** channels.
- **Layer B — AI-interaction quality.** RelianceScope-style coding of the dialogue,
  reported as a 3×3 grid plus an interpretive label. Layer B **contextualizes**
  interpretation and is *never* folded into a Layer A score, because stakeholders
  read rubric scores as writing proficiency and contaminating them with reliance
  behavior would corrupt the construct.

## 4. Method

### 4.1 Halo-controlled, criterion-referenced scoring

A grading run builds one unit of work per criterion per channel (12 × 2 = 24) and
runs each **three times**. Each call sees exactly one criterion, its anchors, and
one source document — never the model's other scores — so a grader that has just
awarded a 5 cannot let that halo bleed into the next criterion. The output contract
puts **evidence before score**: the model quotes verbatim support, reasons against
the anchors, then commits to an integer 0–5, and `no-evidence` is an explicitly
legitimate answer (a criterion that never surfaces in a short dialogue should read
as *absent*, not as zero).

Three passes are aggregated into one record: if a majority are `no-evidence` (or
none is numeric) the record is `no-evidence` and is displayed as absent, never
imputed; otherwise the score is the **median** and the disagreement is the
**spread** (max − min). Confidence is derived from evidence, not self-report: low
for `no-evidence`, teacher-reserve, or spread ≥ 2; high for ≥ 2 distinct verbatim
quotes with spread ≤ 1; medium otherwise. Teacher-reserve criteria and spread-≥-2
records route to the instructor queue; thin-but-consistent records do not, so the
queue surfaces genuine disagreement rather than every marginal case.

### 4.2 The evidence-provenance and student-attribution guards

Two guards make a score defensible.

**Provenance.** Every quote is checked to appear verbatim in the source after
normalizing whitespace and quote characters. Fabricated quotes are dropped, and a
pass whose quotes are *all* fabricated is demoted to `no-evidence`. A score without
surviving evidence does not exist — a concrete countermeasure to the unfaithful-
rationale problem [10].

**Attribution as admissibility.** On the process channel, a quote is admissible
evidence of the student's mastery only if it appears in a turn the *student* wrote.
Assistant-authored text is inadmissible **even when the student copies it back
verbatim**. This is enforced twice: the prompt states it as its most important
rule, and the engine independently re-locates each quote in a student-authored turn
(correcting a mis-cited turn id rather than trusting the model's citation). A
bundled adversarial exemplar — a "parrot" trace whose student turns are entirely
copied from the assistant — exists as a standing regression test that the guard
demotes copied content to non-evidence. We frame this not as AI-text *detection*
but as an **evidence-eligibility rule inside scoring**: the question is not "was
this span AI-written?" but "does this span count as evidence of the student's own
mastery of this criterion?"

### 4.3 Layer B: reliance coding, kept orthogonal

Separately, the dialogue is segmented (each student turn with its surrounding
assistant turns) and each segment is coded on the RelianceScope grid [1]:
help-seeking mode and response-use mode (each passive/active/constructive) plus a
verification-behavior flag (did the student challenge, fact-check, or correct the
assistant?) — the marker recent work associates with appropriate rather than
over-reliance [22]. Segments roll up to an interpretive label — reflective, cautious,
thoughtless, or collaborative. None of this touches the Layer A writing score.

### 4.4 The trace–product divergence construct

Because both channels score the same atomic criteria, per-dimension divergence is
apples-to-apples: `divergence = product − trace`, computed on effective (override-
aware) scores. The platform surfaces a headline framed as a **hypothesis**:

- **Product ≫ trace, with a passive/thoughtless reliance profile** → *possible
  over-reliance*: the polish of the essay may come from the assistant; probe the
  flagged dimensions in conference or an unassisted task.
- **Product ≫ trace, without that profile** → possibly legitimate drafting/revision
  work the dialogue never showed; verify before crediting.
- **Trace ≫ product** → an *execution/transfer gap*: the student understands the
  material in conversation but does not execute it in the essay; the instructional
  target is drafting and transfer, not concepts.
- **Convergence with constructive engagement** → the strongest case that the scores
  can be read at face value.

The design encodes a testable hypothesis (H1): *divergence magnitude is predicted by
the Layer B reliance pattern*. Crucially, divergence is estimated **within a single
assignment from one rubric**, in contrast to capability-gap work that requires
separate assisted-vs-independent tasks [16] or that relies on self-report shown not
to track the real gap [15].

### 4.5 Override-driven, versioned calibration

Instructor judgment is the authoritative layer, and the system is built to *learn
from being corrected* without ever silently changing what it does.

- **Overrides as a labeled ledger.** Each override (per criterion × channel, with a
  required rationale) retains the LLM's advisory score alongside the teacher's. A
  reliability dashboard computes, per criterion, override frequency and the mean
  signed and absolute delta between teacher and model. A criterion whose average
  absolute delta exceeds a threshold over enough overrides is flagged as
  consistently miscalibrated.
- **Human-gated guidance redraft.** For a flagged criterion, the system asks the
  model to turn the *instructor's own corrections* into a replacement
  `teacherGuidance` text — never rewriting the anchor descriptors (guarded by an
  allowlist and anti-rewrite length checks), only the explicitly instructional
  guidance field. The result is **staged as an inactive rubric version** showing
  current vs. proposed; it changes nothing until a human publishes it.
- **Versioned reproducibility.** Rubrics are never edited in place: any save
  publishes a new version, and **every score record stores the exact version that
  produced it**. This turns "I changed the guidance, re-graded, and the score moved"
  from an anecdote into a reproducible, auditable claim — and makes the override
  corpus an exportable dataset for a downstream, human-calibrated score model [7].

This packaging — overrides-as-corpus, a per-criterion miscalibration ledger, a
human-gated *inactive* redraft, and per-score version stamping — is what
distinguishes the loop from feedback-driven rubric optimizers that solicit input or
auto-apply revisions [3, 4, 5, 6].

## 5. Implementation

The reference implementation is a React client with a FastAPI/SQLite backend, but
its defining property for adoption and replication is that **the grading engine runs
in two places with identical behavior**. The Python engine
(prompts, guards, three-pass aggregation, molding, divergence, reliance coding) has
a line-for-line TypeScript port that runs **entirely in the browser**. This yields a
backend-free static build in which the browser is its own backend: bundled exemplar
sessions are explorable with no setup, and live grading calls the provider
**directly from the browser with a user-supplied (bring-your-own) key** that is
never persisted or transmitted to any server. All state lives in the browser and is
exportable as a portable JSON file. The same client, pointed at the backend,
provides durable multi-user storage, streaming progress, and a research export.

Two consequences matter for this paper. First, **replication is cheap**: a reviewer
or instructor can run the full method from a static URL with their own key, no
server, no institutional data leaving their control — a meaningful property when the
inputs are student essays. Second, the dual deployment is a natural **ablation
harness**: the guards, the pass count, and the calibration trigger are all
parameters, and the engine is small enough to instrument for the study below.

## 6. Validation plan (why the claims here are design claims)

The test suite proves the machinery is *correct* — aggregation, routing, guards, and
provenance behave as specified — but not that the scores are *right*. We therefore
frame every score as advisory and specify the study the design is built to support:

1. **Human agreement (Layer A).** Quadratic-weighted κ and exact/adjacent agreement
   against instructor grades on held-out essays, per criterion and per channel,
   including **discriminative-validity** checks across genuinely different-quality
   work — not merely distributional agreement.
2. **Guard ablations.** Effect of the provenance guard and the student-attribution
   guard on agreement and on adversarial (parrot) inputs; false-admission rate of
   copied content with the attribution guard on vs. off.
3. **Divergence hypothesis (H1).** Whether per-dimension divergence magnitude is
   predicted by the Layer B reliance profile, and whether the over-reliance flag
   agrees with independent (e.g., unassisted-task) capability estimates.
4. **Calibration-loop effect.** Longitudinal: does per-criterion override delta
   decrease after a published, override-drafted guidance revision, relative to
   unchanged criteria (a within-subject, version-stamped comparison the data model
   already supports)?
5. **Reliance-coding validity.** Re-validation of RelianceScope-style coding
   against human coding on our dialogue data [1].

## 7. Limitations and ethics

The rubric is anchored to specific state standards for grades 11–12; other levels
require replacing the construct map, not just prompt text. Half the system requires
a dialogue trace; without one, only the product scorer remains. On the static
build, grading runs in the user's browser under their key and rate limits, and
provider CORS policy — not the app — decides which providers answer a direct browser
call. The platform is a research instrument, not a cleared system of record: real
use requires attention to FERPA-equivalent requirements, and no readiness-gate or
certification claim is made. Finally, the over-reliance framing is deliberately
hypothesis-level: a divergence is a prompt for a conversation, never an accusation.

## 8. Conclusion

Grading the same rubric against both the essay and the dialogue that produced it,
and treating their signed gap as the object of interest, reframes AI-assisted
writing assessment from *detecting* AI use to *measuring where the artifact and the
student diverge*. Made trustworthy by halo control, provenance and attribution
guards, and a human-gated, versioned calibration loop that learns from instructor
overrides, the dual-channel signal becomes something an instructor can act on. The
combination — a divergence-based dual-channel scorer whose disagreements with
teachers feed a reproducible recalibration loop — has no direct prior equal, and the
design is built, end to end, to make its own validation study possible.

---

## References

[1] H. Jin, M. Yoo, J. Han, Z. Chen, S.-Y. Ahn, X. Wang. *RelianceScope: An
Analytical Framework for Examining Students' Reliance on Generative AI Chatbots in
Problem Solving.* Proc. 13th ACM Conf. on Learning @ Scale (L@S '26), 2026,
pp. 136–147. arXiv:2602.16251; doi:10.1145/3774398.3811612. (Best Paper.)

[2] C. Hou, G. Zhu, V. Sudarshan. *The role of critical thinking on undergraduates'
reliance behaviours on generative AI in problem-solving.* British Journal of
Educational Technology, 56(5):1919–1941, 2025. doi:10.1111/bjet.13613.

[3] Y. Chu, H. Li, K. Yang, Y. Copur-Gencturk, J. Tang. *LLM-based Automated Grading
with Human-in-the-Loop* (the GradeHITL framework). arXiv:2504.05239, 2025.

[4] H. Li, Y. Chu, K. Yang, Y. Copur-Gencturk, J. Tang. *A LLM-Powered Automatic
Grading Framework with Human-Level Guidelines Optimization* (GradeOpt). Proc. 18th
Int. Conf. on Educational Data Mining (EDM 2025), long paper 80. arXiv:2410.02165.

[5] C. Cohn, Ashwin T. S., N. Mohammed, G. Biswas. *CoTAL: Human-in-the-Loop Prompt
Engineering for Generalizable Formative Assessment Scoring and Feedback.*
arXiv:2504.02323, 2025.

[6] Y. Chu, H. Li, K. Yang, Y. Copur-Gencturk, J. Krajcik, N. Shin, J. Tang.
*Confusion-Aware Rubric Optimization for LLM-based Automated Grading* (CARO).
arXiv:2603.00451, 2026.

[7] H. Hashemi, J. Eisner, C. Rosset, B. Van Durme, C. Kedzie. *LLM-Rubric: A
Multidimensional, Calibrated Approach to Automated Evaluation of Natural Language
Texts.* Proc. 62nd Annual Meeting of the ACL (Vol. 1: Long Papers), 2024,
pp. 13806–13834. ACL Anthology 2024.acl-long.745.

[8] X. Tang, H. Chen, D. Lin, K. Li. *Harnessing LLMs for multi-dimensional writing
assessment: Reliability and alignment with human judgments.* Heliyon,
10(14):e34262, 2024. doi:10.1016/j.heliyon.2024.e34262.

[9] W. Li, M. Zhao, W. Dong, et al. (15 authors). *Grading Scale Impact on
LLM-as-a-Judge: Human-LLM Alignment Is Highest on 0-5 Grading Scale.*
arXiv:2601.03444, 2026.

[10] A. Madsen, S. Chandar, S. Reddy. *Are self-explanations from Large Language
Models faithful?* Findings of the ACL 2024, pp. 295–337. ACL Anthology
2024.findings-acl.19; arXiv:2401.07927.

[11] P. Manakul, A. Liusie, M. J. F. Gales. *SelfCheckGPT: Zero-Resource Black-Box
Hallucination Detection for Generative Large Language Models.* Proc. EMNLP 2023,
pp. 9004–9017. ACL Anthology 2023.emnlp-main.557.

[12] Z. Tian, Z. Han, Y. Chen, H. Xu, X. Yang, R. Xuan, H. Wang, L. Liao.
*Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution.*
arXiv:2508.06225, 2025.

[13] S. Crossley, Y. Tian, J. S. Choi, L. Holmes, W. Morris. *Plagiarism Detection
Using Keystroke Logs.* Proc. 17th Int. Conf. on Educational Data Mining (EDM 2024),
short paper 47.

[14] A. Chen, J. Lian, X. Kuang, J. Jia. *Can theory-driven learning analytics
dashboard enhance human-AI collaboration in writing learning? Insights from an
empirical experiment.* arXiv:2506.19364, 2025.

[15] I. Crk, E. Gultepe. *A Metacognitive Blind Spot: Student Comprehension, AI
Reliance, and the Conceptual Difficulty Gap.* Education Sciences, 16(7):1102, 2026.
doi:10.3390/educsci16071102.

[16] G. Liu, B. Christian, T. Dumbalska, M. A. Bakker, R. Dubey. *AI Assistance
Reduces Persistence and Hurts Independent Performance.* arXiv:2604.04721, 2026.

[17] J. Y. Bo, S. Wan, A. Anderson. *To Rely or Not to Rely? Evaluating Interventions
for Appropriate Reliance on Large Language Models.* Proc. 2025 CHI Conf. on Human
Factors in Computing Systems (CHI '25). arXiv:2412.15584; doi:10.1145/3706598.3714097.

[18] R. J. Mislevy, L. S. Steinberg, R. G. Almond. *On the structure of educational
assessments.* Measurement: Interdisciplinary Research and Perspectives, 1(1):3–62,
2003. doi:10.1207/S15366359MEA0101_02.

[19] Y. Attali, J. Burstein. *Automated Essay Scoring With e-rater V.2.* Journal of
Technology, Learning, and Assessment, 4(3), 2006.

[20] K. Zhou, J. D. Hwang, X. Ren, N. Dziri, D. Jurafsky, M. Sap. *REL-A.I.: An
Interaction-Centered Approach To Measuring Human-LM Reliance.* Proc. NAACL 2025
(Long Papers), pp. 11148–11167. ACL Anthology 2025.naacl-long.556.

[21] S. Hossain. *Four Types of LLM Reliance and Their Predictors Among Undergraduate
Writers: A Mixed-Methods Study at a Minority-Serving R1 University.* arXiv:2606.28749,
2026.

[22] H.-P. Lee, A. Sarkar, L. Tankelevitch, I. Drosos, S. Rintel, R. Banks,
N. Wilson. *The Impact of Generative AI on Critical Thinking: Self-Reported
Reductions in Cognitive Effort and Confidence Effects From a Survey of Knowledge
Workers.* Proc. 2025 CHI Conf. on Human Factors in Computing Systems (CHI '25).
doi:10.1145/3706598.3713778.
