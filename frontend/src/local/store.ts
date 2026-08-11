// Browser-resident state for the static build. Seeds from the bundled demo blob
// (scripts/gen_demo_fixtures.py) on first load, persists to localStorage, and is
// downloadable/loadable as a single JSON file so a user can carry their work
// between machines. The BYO API key is deliberately NOT part of this blob — it
// lives under its own localStorage key (api/client.ts) and never lands in an
// exported, shareable file.

import demoRaw from './fixtures/demo.json';
import type {
  DimensionDivergence,
  DivergenceInterpretation,
  LayerBResult,
  Rubric,
  ScoreRecord,
  Trace,
} from '../types';

export type Role = 'admin' | 'instructor' | 'student';
export type Intensity = 'subtle' | 'moderate' | 'strong';

export interface LocalUser {
  username: string;
  role: Role;
  displayName: string;
  theme: string;
  preferredProvider: string;
  preferredModel: string;
  gradingStyle: string;
  styleIntensity: Intensity;
  createdAt: string;
}

export interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: string[];
  configured: boolean;
  baseUrl: string;
}

export interface StoredAssessment {
  id: string;
  username: string;
  mode: 'essay_trace';
  status: string;
  name: string;
  description: string;
  contentId: string;
  contentVersion: string;
  isExemplar: boolean;
  gradedLive: boolean;
  createdAt: string;
  completedAt: string;
  artifacts: { essay?: string; trace?: Trace; [k: string]: unknown };
  scores: ScoreRecord[];
  layerB: LayerBResult | null;
  divergence?: DimensionDivergence[];
  interpretation?: DivergenceInterpretation;
}

export interface StoredContent {
  contentId: string;
  version: string;
  createdBy: string;
  createdAt: string;
  active: boolean;
  dismissed: boolean;
  payload: Rubric;
}

interface DemoBlob {
  rubricVersion: string;
  users: { username: string; role: Role; displayName: string; createdAt: string }[];
  rubric: { contentId: string; version: string; createdBy: string; createdAt: string; payload: Rubric };
  providers: { providers: ProviderInfo[]; default: string };
  assessments: StoredAssessment[];
}

interface LocalState {
  v: number;
  currentUser: LocalUser | null;
  users: LocalUser[];
  assessments: StoredAssessment[];
  content: StoredContent[];
}

const DEMO = demoRaw as unknown as DemoBlob;
const STORAGE_KEY = 'ap.state.v1';
const STATE_VERSION = 1;

export const CALIBRATION_MIN_OVERRIDES = 3;
export const CALIBRATION_AVG_DELTA_THRESHOLD = 1.5;

export function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function newId(): string {
  return (crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '');
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function seedUser(u: { username: string; role: Role; displayName: string; createdAt: string }): LocalUser {
  return {
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    theme: 'light',
    preferredProvider: '',
    preferredModel: '',
    gradingStyle: '',
    styleIntensity: 'moderate',
    createdAt: u.createdAt,
  };
}

function freshState(): LocalState {
  return {
    v: STATE_VERSION,
    currentUser: null,
    users: DEMO.users.map(seedUser),
    assessments: clone(DEMO.assessments),
    content: [
      {
        contentId: DEMO.rubric.contentId,
        version: DEMO.rubric.version,
        createdBy: DEMO.rubric.createdBy,
        createdAt: DEMO.rubric.createdAt,
        active: true,
        dismissed: false,
        payload: DEMO.rubric.payload,
      },
    ],
  };
}

let state: LocalState = load();

function load(): LocalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalState;
      if (parsed && parsed.v === STATE_VERSION) return parsed;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const s = freshState();
  persist(s);
  return s;
}

function persist(s: LocalState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode — state stays in memory for this tab */
  }
}

function save(): void {
  persist(state);
}

// ── Providers (static config, not persisted) ──────────────────────────────────

export function providers(): { providers: ProviderInfo[]; default: string } {
  return DEMO.providers;
}

export function providerCfg(name: string): ProviderInfo | undefined {
  return DEMO.providers.providers.find((p) => p.name === name);
}

// ── Auth (username-only; password is bypassed in the static build) ────────────

export function currentUser(): LocalUser | null {
  return state.currentUser;
}

export function login(username: string, role: Role, displayName?: string): LocalUser {
  const existing = state.users.find((u) => u.username === username);
  const user =
    existing ??
    (() => {
      const u = seedUser({ username, role, displayName: displayName || username, createdAt: utcnow() });
      state.users.push(u);
      return u;
    })();
  user.role = role;
  state.currentUser = user;
  save();
  return user;
}

export function logout(): void {
  state.currentUser = null;
  save();
}

export function setRole(role: Role): LocalUser | null {
  if (!state.currentUser) return null;
  state.currentUser.role = role;
  const u = state.users.find((x) => x.username === state.currentUser!.username);
  if (u) u.role = role;
  save();
  return state.currentUser;
}

export function updatePrefs(patch: Partial<LocalUser>): LocalUser | null {
  if (!state.currentUser) return null;
  Object.assign(state.currentUser, patch);
  const u = state.users.find((x) => x.username === state.currentUser!.username);
  if (u) Object.assign(u, patch);
  save();
  return state.currentUser;
}

// ── Users (admin) ─────────────────────────────────────────────────────────────

export function allUsers(): LocalUser[] {
  return [...state.users].sort((a, b) => a.role.localeCompare(b.role) || a.displayName.localeCompare(b.displayName));
}

export function createUser(username: string, role: Role, displayName: string): { ok: boolean; error?: string } {
  if (state.users.some((u) => u.username === username)) return { ok: false, error: 'Username already exists.' };
  state.users.push(seedUser({ username, role, displayName: displayName || username, createdAt: utcnow() }));
  save();
  return { ok: true };
}

export function updateUserRole(username: string, role: Role): boolean {
  const u = state.users.find((x) => x.username === username);
  if (!u) return false;
  u.role = role;
  if (state.currentUser?.username === username) state.currentUser.role = role;
  save();
  return true;
}

// ── Assessments ───────────────────────────────────────────────────────────────

export function listAssessments(user: LocalUser): StoredAssessment[] {
  const staff = user.role === 'admin' || user.role === 'instructor';
  return state.assessments
    .filter((a) => staff || a.username === user.username)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getAssessment(id: string): StoredAssessment | undefined {
  return state.assessments.find((a) => a.id === id);
}

export function canView(user: LocalUser, a: StoredAssessment): boolean {
  return user.role === 'admin' || user.role === 'instructor' || a.username === user.username;
}

export function createAssessment(a: StoredAssessment): StoredAssessment {
  state.assessments.unshift(a);
  save();
  return a;
}

export function updateAssessment(id: string, patch: Partial<StoredAssessment>): void {
  const a = getAssessment(id);
  if (!a) return;
  Object.assign(a, patch);
  save();
}

export function deleteAssessment(id: string): void {
  state.assessments = state.assessments.filter((a) => a.id !== id);
  save();
}

export function setScores(id: string, scores: ScoreRecord[]): void {
  const a = getAssessment(id);
  if (!a) return;
  a.scores = scores;
  save();
}

export function upsertScore(id: string, record: ScoreRecord): void {
  const a = getAssessment(id);
  if (!a) return;
  const idx = a.scores.findIndex((s) => s.criterionId === record.criterionId && s.channel === record.channel);
  if (idx >= 0) a.scores[idx] = record;
  else a.scores.push(record);
  save();
}

export function setOverride(
  id: string,
  criterionId: string,
  channel: string,
  score: number,
  rationale: string,
): boolean {
  const a = getAssessment(id);
  if (!a) return false;
  const rec = a.scores.find((s) => s.criterionId === criterionId && s.channel === channel);
  if (!rec) return false;
  rec.teacherOverride = { score, rationale, ts: utcnow() };
  save();
  return true;
}

export function clearOverride(id: string, criterionId: string, channel: string): boolean {
  const a = getAssessment(id);
  if (!a) return false;
  const rec = a.scores.find((s) => s.criterionId === criterionId && s.channel === channel);
  if (!rec) return false;
  rec.teacherOverride = null;
  save();
  return true;
}

export function reviewQueue(): ScoreRecord[] {
  const rows: ScoreRecord[] = [];
  for (const a of state.assessments) {
    for (const s of a.scores) {
      if (!s.needsReview) continue;
      rows.push({ ...s, assessmentId: a.id, assessmentName: a.name, username: a.username });
    }
  }
  return rows.sort((x, y) => {
    const xr = x.teacherOverride ? 1 : 0;
    const yr = y.teacherOverride ? 1 : 0;
    if (xr !== yr) return xr - yr; // unresolved first
    return x.gradedAt < y.gradedAt ? 1 : -1;
  });
}

function overridesForCriterion(criterionId: string): Array<ScoreRecord & { username: string }> {
  const rows: Array<ScoreRecord & { username: string }> = [];
  for (const a of state.assessments) {
    for (const s of a.scores) {
      if (s.criterionId === criterionId && s.teacherOverride) rows.push({ ...s, username: a.username });
    }
  }
  return rows.sort((x, y) => (x.teacherOverride!.ts < y.teacherOverride!.ts ? -1 : 1));
}

export function overrideCorpus(): Array<ScoreRecord & { username: string }> {
  const rows: Array<ScoreRecord & { username: string }> = [];
  for (const a of state.assessments) {
    for (const s of a.scores) {
      if (s.teacherOverride) rows.push({ ...s, assessmentId: a.id, assessmentName: a.name, username: a.username });
    }
  }
  return rows.sort((x, y) => (x.teacherOverride!.ts < y.teacherOverride!.ts ? -1 : 1));
}

export { overridesForCriterion };

// ── Content / rubric versions ─────────────────────────────────────────────────

export function bumpVersion(version: string): string {
  const m = /^(.*)-t(\d+)$/.exec(version);
  return m ? `${m[1]}-t${Number(m[2]) + 1}` : `${version}-t1`;
}

export function listContent(): StoredContent[] {
  return state.content.filter((c) => c.active);
}

export function getActiveContent(contentId: string): StoredContent | undefined {
  return state.content.find((c) => c.contentId === contentId && c.active);
}

export function getContentVersion(contentId: string, version: string): StoredContent | undefined {
  return state.content.find((c) => c.contentId === contentId && c.version === version);
}

export function saveContent(contentId: string, payload: Rubric, createdBy: string): StoredContent {
  const current = getActiveContent(contentId);
  const newVersion = current ? bumpVersion(current.version) : payload.version || '1.0';
  if (current) current.active = false;
  const next: StoredContent = {
    contentId,
    version: newVersion,
    createdBy,
    createdAt: utcnow(),
    active: true,
    dismissed: false,
    payload: { ...payload, version: newVersion },
  };
  state.content.push(next);
  save();
  return next;
}

/** Stage an inactive draft version (calibration guidance) without activating it. */
export function stageDraft(contentId: string, payload: Rubric, createdBy: string): StoredContent {
  const current = getActiveContent(contentId);
  const newVersion = current ? bumpVersion(current.version) : payload.version || '1.0';
  const draft: StoredContent = {
    contentId,
    version: newVersion,
    createdBy,
    createdAt: utcnow(),
    active: false,
    dismissed: false,
    payload: { ...payload, version: newVersion },
  };
  state.content.push(draft);
  save();
  return draft;
}

export function listDrafts(contentId: string): StoredContent[] {
  return state.content.filter((c) => c.contentId === contentId && !c.active && !c.dismissed);
}

export function publishVersion(contentId: string, version: string): boolean {
  const target = getContentVersion(contentId, version);
  if (!target) return false;
  for (const c of state.content) if (c.contentId === contentId) c.active = false;
  target.active = true;
  target.dismissed = false;
  save();
  return true;
}

export function dismissVersion(contentId: string, version: string): boolean {
  const target = getContentVersion(contentId, version);
  if (!target) return false;
  target.dismissed = true;
  save();
  return true;
}

// ── Reliability (port of database.mode_a_reliability_stats) ───────────────────

export function reliabilityStats() {
  const records: Array<ScoreRecord & { username: string; assessmentName: string }> = [];
  for (const a of state.assessments) {
    for (const s of a.scores) records.push({ ...s, username: a.username, assessmentName: a.name });
  }
  const overridden = records.filter((r) => r.teacherOverride);
  const needsReview = records.filter((r) => r.needsReview);
  const deltas = overridden
    .filter((r) => r.median !== null)
    .map((r) => Math.abs(r.teacherOverride!.score - (r.median as number)));
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

  const criteria = new Map<string, ScoreRecord[]>();
  for (const r of records) {
    const arr = criteria.get(r.criterionId) ?? [];
    arr.push(r);
    criteria.set(r.criterionId, arr);
  }
  const byCriterion = [...criteria.entries()].map(([criterion_id, arr]) => {
    const nr = arr.filter((r) => r.needsReview).length;
    const ov = arr.filter((r) => r.teacherOverride).length;
    const ds = arr
      .filter((r) => r.teacherOverride && r.median !== null)
      .map((r) => Math.abs(r.teacherOverride!.score - (r.median as number)));
    const avg = ds.length ? Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 100) / 100 : null;
    return {
      criterion_id,
      total: arr.length,
      needs_review: nr,
      overridden: ov,
      resolution_rate: nr ? ov / nr : null,
      avg_delta: avg,
      needs_calibration_review:
        avg !== null && avg >= CALIBRATION_AVG_DELTA_THRESHOLD && ov >= CALIBRATION_MIN_OVERRIDES,
    };
  });
  byCriterion.sort((a, b) => {
    const an = a.avg_delta === null ? 1 : 0;
    const bn = b.avg_delta === null ? 1 : 0;
    if (an !== bn) return an - bn;
    return (b.avg_delta ?? 0) - (a.avg_delta ?? 0);
  });

  const recent = overridden
    .slice()
    .sort((a, b) => (a.teacherOverride!.ts < b.teacherOverride!.ts ? 1 : -1))
    .slice(0, 20)
    .map((r) => ({
      criterion_id: r.criterionId,
      channel: r.channel,
      median: r.median,
      override_score: r.teacherOverride!.score,
      override_rationale: r.teacherOverride!.rationale,
      override_ts: r.teacherOverride!.ts,
      username: r.username,
      assessment_name: r.assessmentName,
    }));

  return {
    total: records.filter((r) => r.gradedAt).length,
    needs_review: needsReview.length,
    overridden: overridden.length,
    resolution_rate: needsReview.length ? overridden.length / needsReview.length : null,
    avg_override_delta: avgDelta === null ? null : Math.round(avgDelta * 100) / 100,
    by_criterion: byCriterion,
    flagged_criteria: byCriterion.filter((d) => d.needs_calibration_review).map((d) => d.criterion_id),
    recent,
  };
}

// ── Export / import / reset (the downloadable-JSON feature) ────────────────────

export function exportState(): LocalState {
  return clone(state);
}

export function importState(json: unknown): { ok: boolean; error?: string } {
  try {
    const parsed = json as LocalState;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.assessments) || !Array.isArray(parsed.users)) {
      return { ok: false, error: 'Not a recognisable Calibrated Judgment state file.' };
    }
    state = { ...freshState(), ...parsed, v: STATE_VERSION };
    save();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function resetToDemo(): void {
  state = freshState();
  save();
}
