// Thin fetch wrapper for the platform API. Cookies carry the session; the
// custom X-Requested-With header is the CSRF guard the backend requires on
// every mutating request (see backend/app/core/security.py).
//
// BYO key: when the user saved their own provider key in Settings, it lives in
// localStorage only and rides along on each request as X-LLM-* headers — the
// server uses it for that call and never stores it.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BYO_KEY_STORAGE = 'ap.byoKey';

export interface ByoKey {
  provider: string;
  model: string;
  apiKey: string;
}

export function loadByoKey(): ByoKey | null {
  try {
    const raw = localStorage.getItem(BYO_KEY_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByoKey>;
    if (typeof parsed.apiKey !== 'string' || !parsed.apiKey) return null;
    return {
      provider: typeof parsed.provider === 'string' ? parsed.provider : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: parsed.apiKey,
    };
  } catch {
    return null;
  }
}

export function saveByoKey(key: ByoKey): void {
  localStorage.setItem(BYO_KEY_STORAGE, JSON.stringify(key));
}

export function clearByoKey(): void {
  localStorage.removeItem(BYO_KEY_STORAGE);
}

function byoKeyHeaders(): Record<string, string> {
  const byo = loadByoKey();
  if (!byo) return {};
  return {
    'X-LLM-Key': byo.apiKey,
    ...(byo.provider ? { 'X-LLM-Provider': byo.provider } : {}),
    ...(byo.model ? { 'X-LLM-Model': byo.model } : {}),
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'fetch',
      ...byoKeyHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
