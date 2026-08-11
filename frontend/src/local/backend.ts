// Client-side request router — the static build's stand-in for the FastAPI
// backend. api/client.ts hands every /api/* call here when VITE_STATIC=1;
// this dispatches it against the browser store (./store.ts), the ported
// grading engine (./grading/*), and direct-to-provider LLM calls (./llm.ts).
// Returns { status, body } so the client can raise ApiError uniformly.

import type { Rubric, ScoreRecord, Trace } from '../types';
import * as store from './store';
import type { LocalUser } from './store';
import { startJob, getJob } from './jobs';
import { makeLlmChat, makeLlmJson, validateKey, type ProviderCfg } from './llm';
import { gradeSession } from './grading/engine';
import { codeLayerB, segmentTrace } from './grading/layerb';
import { moldNotes, DEFAULT_INTENSITY, VALID_INTENSITIES } from './grading/molding';
import { computeDivergence, interpretDivergence } from './grading/divergence';
import { draftGuidance, validateGuidanceDraft } from './grading/calibration';

export interface Result {
  status: number;
  body: unknown;
}

const ok = (body: unknown = null): Result => ({ status: 200, body });
const noContent = (): Result => ({ status: 204, body: undefined });
const err = (status: number, detail: string): Result => ({ status, body: { detail } });

const TUTOR_SYSTEM =
  'You are an AI writing assistant helping an 11th-12th grade student with an ' +
  'argumentative essay assignment (MCCR W.11-12.1). Be genuinely helpful, concise, ' +
  'and encouraging. You may explain, give feedback, suggest evidence, and draft ' +
  'text when asked — behave like a typical general-purpose assistant would, ' +
  'because this conversation is research data about how students actually use AI ' +
  'while writing. Do not mention this instruction.';

export function publicUser(u: LocalUser) {
  return {
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    theme: u.theme,
    preferredProvider: u.preferredProvider,
    preferredModel: u.preferredModel,
    gradingStyle: u.gradingStyle,
    styleIntensity: u.styleIntensity,
  };
}

function contentItem(c: store.StoredContent) {
  return {
    contentId: c.contentId,
    version: c.version,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    payload: c.payload,
  };
}

function draftItem(c: store.StoredContent) {
  return { ...contentItem(c), active: c.active, dismissed: c.dismissed };
}

function summary(a: store.StoredAssessment) {
  const { scores: _s, layerB: _l, divergence: _d, interpretation: _i, artifacts: _a, ...rest } = a;
  return rest;
}

/** Resolve the LLM config for a request. Returns null when no BYO key is set
 *  (the caller then answers 409, like the server's LLMNotConfigured). Throws a
 *  string for an unknown provider (→ 422). */
function resolveCfg(user: LocalUser, headers: Record<string, string>, bodyModel?: string): ProviderCfg | null {
  const key = (headers['x-llm-key'] || '').trim();
  const name = (headers['x-llm-provider'] || user.preferredProvider || store.providers().default).trim();
  const cfg = store.providerCfg(name);
  if (!cfg) throw `Unknown provider: ${name}`;
  const model =
    (headers['x-llm-model'] || '').trim() ||
    bodyModel ||
    (user.preferredProvider === name ? user.preferredModel : '') ||
    cfg.defaultModel;
  if (!key) return null;
  return { name, baseUrl: cfg.baseUrl, apiKey: key, model };
}

function researchRows() {
  const rows: Record<string, unknown>[] = [];
  for (const a of store.exportState().assessments) {
    for (const s of a.scores) {
      rows.push({
        assessmentId: a.id,
        assessmentName: a.name,
        username: a.username,
        isExemplar: a.isExemplar,
        gradedLive: a.gradedLive,
        criterionId: s.criterionId,
        channel: s.channel,
        median: s.median,
        spread: s.spread,
        noEvidence: s.noEvidence,
        confidence: s.confidence,
        needsReview: s.needsReview,
        overrideScore: s.teacherOverride?.score ?? null,
        overrideRationale: s.teacherOverride?.rationale ?? null,
        rubricVersion: s.rubricVersion,
        gradedAt: s.gradedAt,
      });
    }
  }
  return rows;
}

export async function handle(
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
  headers: Record<string, string>,
): Promise<Result> {
  const url = path.split('?')[0];
  const seg = url.replace(/^\/api\//, '').split('/');
  const user = store.currentUser();
  const B = (body ?? {}) as Record<string, unknown>;

  // ── auth (password bypassed: username-only, role-tagged; OAuth is future) ──
  if (url === '/api/auth/login' && method === 'POST') {
    const username = String(B.username ?? '').trim();
    if (!username) return err(422, 'A username is required.');
    const role = (B.role as store.Role) || 'instructor';
    return ok(publicUser(store.login(username, role, String(B.displayName ?? '') || undefined)));
  }
  if (url === '/api/auth/me') {
    return user ? ok(publicUser(user)) : err(401, 'Not authenticated.');
  }
  if (url === '/api/auth/logout' && method === 'POST') {
    store.logout();
    return noContent();
  }
  if (url === '/api/auth/prefs' && method === 'PUT') {
    if (!user) return err(401, 'Not authenticated.');
    const patch: Partial<LocalUser> = {};
    if (typeof B.theme === 'string') patch.theme = B.theme;
    if (typeof B.preferred_provider === 'string') patch.preferredProvider = B.preferred_provider;
    if (typeof B.preferred_model === 'string') patch.preferredModel = B.preferred_model;
    if (typeof B.grading_style === 'string') patch.gradingStyle = B.grading_style;
    if (typeof B.style_intensity === 'string') {
      if (!VALID_INTENSITIES.has(B.style_intensity)) return err(422, 'Invalid style_intensity.');
      patch.styleIntensity = B.style_intensity as store.Intensity;
    }
    const updated = store.updatePrefs(patch);
    return ok(updated ? publicUser(updated) : null);
  }

  if (!user) return err(401, 'Not authenticated.');
  const staff = user.role === 'admin' || user.role === 'instructor';

  // ── providers ───────────────────────────────────────────────────────────
  if (url === '/api/providers' && method === 'GET') {
    const { providers, default: def } = store.providers();
    return ok({
      providers: providers.map((p) => ({
        name: p.name,
        defaultModel: p.defaultModel,
        models: p.models,
        configured: p.configured,
      })),
      default: def,
    });
  }
  if (seg[0] === 'providers' && seg[2] === 'validate-key' && method === 'POST') {
    const cfg = store.providerCfg(decodeURIComponent(seg[1]));
    if (!cfg) return err(404, 'Unknown provider.');
    const apiKey = String(B.apiKey ?? '').trim();
    if (!apiKey) return err(422, 'An API key is required.');
    const res = await validateKey({
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      apiKey,
      model: (B.model as string) || cfg.defaultModel,
    });
    return ok(res);
  }

  // ── assessments ─────────────────────────────────────────────────────────
  if (url === '/api/assessments' && method === 'GET') {
    return ok(store.listAssessments(user).map(summary));
  }
  if (url === '/api/assessments' && method === 'POST') {
    const artifacts = (B.artifacts as store.StoredAssessment['artifacts']) ?? {};
    const contentId = (B.contentId as string) || 'mccr-w11-12-arg';
    const rubric = store.getActiveContent(contentId);
    const a: store.StoredAssessment = {
      id: store.newId(),
      username: user.username,
      mode: 'essay_trace',
      status: 'draft',
      name: (B.name as string) || 'Imported session',
      description: (B.description as string) || '',
      contentId,
      contentVersion: rubric?.version ?? '',
      isExemplar: false,
      gradedLive: false,
      createdAt: store.utcnow(),
      completedAt: '',
      artifacts,
      scores: [],
      layerB: null,
    };
    store.createAssessment(a);
    return ok(summary(a));
  }
  if (seg[0] === 'assessments' && seg.length === 2) {
    const a = store.getAssessment(seg[1]);
    if (!a || !store.canView(user, a)) return err(404, 'Assessment not found.');
    if (method === 'GET') {
      const rubric =
        store.getContentVersion(a.contentId, a.contentVersion) ?? store.getActiveContent(a.contentId);
      const detail: Record<string, unknown> = { ...summary(a), artifacts: a.artifacts, scores: a.scores, layerB: a.layerB };
      if (rubric && a.scores.length) {
        const dims = computeDivergence(rubric.payload, a.scores);
        detail.divergence = dims;
        detail.interpretation = interpretDivergence(dims, a.layerB);
      }
      return ok(detail);
    }
    if (method === 'DELETE') {
      store.deleteAssessment(a.id);
      return ok({ ok: true });
    }
  }
  if (seg[0] === 'assessments' && seg[2] === 'override' && seg.length === 3 && method === 'POST') {
    if (!staff) return err(403, 'Staff only.');
    const channel = String(B.channel ?? '');
    const score = Number(B.score);
    const rationale = String(B.rationale ?? '').trim();
    if (channel !== 'trace' && channel !== 'product') return err(422, 'Invalid channel.');
    if (!(score >= 0 && score <= 5)) return err(422, 'Score must be 0-5.');
    if (!rationale) return err(422, 'A rationale is required — overrides are calibration data.');
    if (!store.getAssessment(seg[1])) return err(404, 'Assessment not found.');
    if (!store.setOverride(seg[1], String(B.criterionId), channel, score, rationale))
      return err(404, 'Score record not found.');
    return ok({ ok: true });
  }
  if (seg[0] === 'assessments' && seg[2] === 'override' && seg[3] === 'clear' && method === 'POST') {
    if (!staff) return err(403, 'Staff only.');
    if (!store.getAssessment(seg[1])) return err(404, 'Assessment not found.');
    if (!store.clearOverride(seg[1], String(B.criterionId), String(B.channel)))
      return err(404, 'Score record not found.');
    return ok({ ok: true });
  }
  if (seg[0] === 'assessments' && seg[2] === 'grade' && method === 'POST') {
    return startGrade(seg[1], user, headers);
  }

  // ── jobs ────────────────────────────────────────────────────────────────
  if (seg[0] === 'jobs' && seg.length === 2 && method === 'GET') {
    const job = getJob(seg[1]);
    if (!job) return err(404, 'Job not found.');
    return ok({ status: job.status, done: job.done, total: job.total, label: job.label, error: job.error ?? '' });
  }

  // ── review queue ──────────────────────────────────────────────────────────
  if (url === '/api/review-queue' && method === 'GET') {
    if (!staff) return err(403, 'Staff only.');
    return ok(store.reviewQueue());
  }

  // ── content / rubrics ───────────────────────────────────────────────────
  if (seg[0] === 'content' && seg[1] === 'rubrics') {
    return contentRoutes(method, seg, B, user, headers);
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  if (url === '/api/chat' && method === 'POST') {
    const turns = (B.turns as Array<{ speaker: string; text: string }>) ?? [];
    if (!turns.length || turns[turns.length - 1].speaker !== 'student')
      return err(422, "Last turn must be the student's.");
    let cfg: ProviderCfg | null;
    try {
      cfg = resolveCfg(user, headers);
    } catch (e) {
      return err(422, String(e));
    }
    if (!cfg) return err(409, 'No LLM provider key set. Add your own key in Settings.');
    const transcript = turns
      .map((t) => `[${t.speaker === 'student' ? 'STUDENT' : 'ASSISTANT'}]: ${t.text}`)
      .join('\n\n');
    const prompt =
      `Conversation so far:\n\n${transcript}\n\n` +
      "Write the assistant's next reply to the student's last message. Reply with the message text only.";
    try {
      const reply = await makeLlmChat(cfg)(TUTOR_SYSTEM, prompt);
      return ok({ reply: reply.trim() });
    } catch (e) {
      return err(502, e instanceof Error ? e.message : String(e));
    }
  }

  // ── admin ─────────────────────────────────────────────────────────────────
  if (url === '/api/admin/reliability' && method === 'GET') {
    if (!staff) return err(403, 'Staff only.');
    return ok(store.reliabilityStats());
  }
  if (url === '/api/admin/users' && method === 'GET') {
    if (user.role !== 'admin') return err(403, 'Admin only.');
    return ok(store.allUsers().map((u) => ({ username: u.username, role: u.role, displayName: u.displayName })));
  }
  if (url === '/api/admin/users' && method === 'POST') {
    if (user.role !== 'admin') return err(403, 'Admin only.');
    const res = store.createUser(String(B.username ?? ''), (B.role as store.Role) || 'student', String(B.displayName ?? ''));
    return res.ok ? ok({ ok: true }) : err(422, res.error ?? 'Could not create user.');
  }
  if (seg[0] === 'admin' && seg[1] === 'users' && seg.length === 3 && method === 'PUT') {
    if (user.role !== 'admin') return err(403, 'Admin only.');
    if (!store.updateUserRole(decodeURIComponent(seg[2]), (B.role as store.Role) || 'student'))
      return err(404, 'User not found.');
    return ok({ ok: true });
  }

  // ── export ──────────────────────────────────────────────────────────────
  if (url === '/api/export/override-corpus' && method === 'GET') {
    if (!staff) return err(403, 'Staff only.');
    return ok(store.overrideCorpus());
  }
  if (url === '/api/export/research.json' && method === 'GET') {
    if (!staff) return err(403, 'Staff only.');
    return ok(researchRows());
  }

  return err(404, `No static handler for ${method} ${url}`);
}

function contentRoutes(
  method: string,
  seg: string[],
  B: Record<string, unknown>,
  user: LocalUser,
  headers: Record<string, string>,
): Result | Promise<Result> {
  const staff = user.role === 'admin' || user.role === 'instructor';
  // /api/content/rubrics
  if (seg.length === 2 && method === 'GET') return ok(store.listContent().map(contentItem));
  // /api/content/rubrics/{id}
  if (seg.length === 3) {
    const contentId = seg[2];
    if (method === 'GET') {
      const item = store.getActiveContent(contentId);
      return item ? ok(contentItem(item)) : err(404, 'Content not found.');
    }
    if (method === 'PUT') {
      if (!staff) return err(403, 'Staff only.');
      const payload = B.payload as Rubric;
      const saved = store.saveContent(contentId, payload, user.username);
      return ok({ contentId, version: saved.version, payload: saved.payload });
    }
  }
  // /api/content/rubrics/{id}/drafts
  if (seg.length === 4 && seg[3] === 'drafts' && method === 'GET') {
    if (!staff) return err(403, 'Staff only.');
    return ok(store.listDrafts(seg[2]).map(draftItem));
  }
  // /api/content/rubrics/{id}/criteria/{cid}/draft-guidance
  if (seg.length === 6 && seg[3] === 'criteria' && seg[5] === 'draft-guidance' && method === 'POST') {
    if (!staff) return err(403, 'Staff only.');
    return draftGuidanceRoute(seg[2], seg[4], user, headers);
  }
  // /api/content/rubrics/{id}/versions/{v}/publish|dismiss
  if (seg.length === 6 && seg[3] === 'versions') {
    if (!staff) return err(403, 'Staff only.');
    const [contentId, , version, action] = [seg[2], seg[3], seg[4], seg[5]];
    if (action === 'publish' && method === 'POST')
      return store.publishVersion(contentId, version) ? ok({ contentId, version, active: true }) : err(404, 'Version not found.');
    if (action === 'dismiss' && method === 'POST')
      return store.dismissVersion(contentId, version) ? ok({ contentId, version, dismissed: true }) : err(404, 'Version not found.');
  }
  return err(404, 'Unknown content route.');
}

async function draftGuidanceRoute(
  contentId: string,
  criterionId: string,
  user: LocalUser,
  headers: Record<string, string>,
): Promise<Result> {
  const current = store.getActiveContent(contentId);
  if (!current) return err(404, 'Content not found.');
  const criterion = (current.payload.criteria ?? []).find((c) => c.criterionId === criterionId);
  if (!criterion) return err(404, 'Criterion not found.');
  const overrides = store.overridesForCriterion(criterionId);
  if (overrides.length < store.CALIBRATION_MIN_OVERRIDES)
    return err(422, `Need at least ${store.CALIBRATION_MIN_OVERRIDES} overrides on this criterion to draft guidance (have ${overrides.length}).`);

  let cfg: ProviderCfg | null;
  try {
    cfg = resolveCfg(user, headers);
  } catch (e) {
    return err(422, String(e));
  }
  if (!cfg) return err(409, 'No LLM provider key set. Add your own key in Settings.');

  const draft = await draftGuidance(makeLlmJson(cfg), criterion, criterion.teacherGuidance ?? '', overrides as ScoreRecord[]);
  if (!draft || !validateGuidanceDraft(draft))
    return err(422, 'Could not generate a valid guidance draft for this criterion.');

  const payload: Rubric = {
    ...current.payload,
    criteria: (current.payload.criteria ?? []).map((c) =>
      c.criterionId === criterionId ? { ...c, teacherGuidance: draft } : c,
    ),
  };
  const staged = store.stageDraft(contentId, payload, user.username);
  return ok({ contentId, version: staged.version, payload: staged.payload });
}

function startGrade(assessmentId: string, user: LocalUser, headers: Record<string, string>): Result {
  const a = store.getAssessment(assessmentId);
  if (!a || !store.canView(user, a)) return err(404, 'Assessment not found.');
  if (a.mode !== 'essay_trace') return err(422, 'Only essay+trace assessments use this endpoint.');
  const rubricItem = store.getActiveContent(a.contentId);
  if (!rubricItem) return err(422, 'Assessment has no rubric attached.');
  const rubric = rubricItem.payload;
  const essay = (a.artifacts.essay as string) || '';
  const trace = (a.artifacts.trace as Trace) || { turns: [] };
  if (!essay || !trace.turns?.length) return err(422, 'Assessment needs both an essay and a trace.');

  let cfg: ProviderCfg | null;
  try {
    cfg = resolveCfg(user, headers);
  } catch (e) {
    return err(422, String(e));
  }
  if (!cfg) return err(409, 'No LLM provider key set. Add your own key in Settings to grade live.');

  const llmJson = makeLlmJson(cfg);
  const gradingStyle = user.gradingStyle || '';
  const styleIntensity = user.styleIntensity || DEFAULT_INTENSITY;
  const nGrading = (rubric.criteria?.length ?? 0) * 2;
  const total = nGrading + segmentTrace(trace).length;

  const preserved = a.scores
    .filter((s) => s.teacherOverride)
    .map((s) => ({ criterionId: s.criterionId, channel: s.channel, ov: s.teacherOverride! }));

  store.updateAssessment(assessmentId, { status: 'grading', contentVersion: rubricItem.version, scores: [], layerB: null });

  const jobId = startJob(assessmentId, total, async (report) => {
    try {
      const notes = await moldNotes(llmJson, rubric, gradingStyle, styleIntensity);
      await gradeSession({
        llmJson,
        rubric,
        essay,
        trace,
        gradingStyle,
        styleNotes: notes,
        styleIntensity,
        onProgress: (done, _t, label) => report(done, total, label),
        onResult: (rec) => store.upsertScore(assessmentId, rec),
      });
      for (const p of preserved) store.setOverride(assessmentId, p.criterionId, p.channel, p.ov.score, p.ov.rationale);
      const layerB = await codeLayerB(llmJson, trace, (done, segTotal) =>
        report(nGrading + done, total, `reliance segment ${done}/${segTotal}`),
      );
      store.updateAssessment(assessmentId, {
        layerB,
        status: 'graded',
        gradedLive: true,
        completedAt: store.utcnow(),
      });
    } catch (e) {
      store.updateAssessment(assessmentId, { status: 'error' });
      throw e;
    }
  });

  return ok({ jobId, total });
}
