// Client-side LLM dispatch for the BYO-key static build. The browser calls the
// provider's HTTP API directly with the user's own key — there is no server to
// proxy through. OpenAI-compatible providers use /chat/completions; Anthropic
// uses /v1/messages with the direct-browser-access opt-in header. JSON parsing
// mirrors backend/app/core/llm.py::_extract_json so a browser-graded pass and a
// server-graded pass survive the same messy model output.
//
// CORS reality: some providers (notably OpenAI) do not send CORS headers, so a
// direct browser call is blocked by the browser regardless of key validity.
// Those failures surface as a clear message; a proxy/backend is future work.

export interface ProviderCfg {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ClientLLMError extends Error {}

const EVALUATIVE_TEMPERATURE = 0;
const EVALUATIVE_SEED = 42;
const SEED_SUPPORTED = ['api.openai.com', 'api.groq.com', 'localhost', '127.0.0.1'];
const MAX_OUTPUT_TOKENS_BY_HOST: Record<string, number> = {
  'models.github.ai': 4000,
};

function isOllama(cfg: ProviderCfg): boolean {
  return !cfg.apiKey || cfg.apiKey.toLowerCase() === 'ollama';
}

function isAnthropic(cfg: ProviderCfg): boolean {
  return cfg.baseUrl.includes('api.anthropic.com');
}

function capTokens(baseUrl: string, tokens: number): number {
  for (const [host, cap] of Object.entries(MAX_OUTPUT_TOKENS_BY_HOST)) {
    if (baseUrl.includes(host)) return Math.min(tokens, cap);
  }
  return tokens;
}

function redact(text: string, secret: string): string {
  if (!text || !secret || secret.length < 8) return text;
  return text.split(secret).join('[redacted]');
}

async function errorDetail(res: Response, apiKey: string): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  let detail = body.slice(0, 300).trim();
  try {
    let data: unknown = JSON.parse(body);
    if (Array.isArray(data)) data = data.find((d) => d && typeof d === 'object') ?? {};
    if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      const err = o.error;
      if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        detail = (err as { message: string }).message;
      } else if (typeof err === 'string') detail = err;
      else if (typeof o.message === 'string') detail = o.message;
      else if (typeof o.detail === 'string') detail = o.detail;
    }
  } catch {
    /* non-JSON body: keep the raw slice */
  }
  const headline =
    res.status === 401 || res.status === 403
      ? 'Authentication failed — the API key was rejected or is not authorised for this model'
      : res.status === 429
        ? 'Rate limit exceeded — wait for the quota window or use a higher-tier key'
        : res.status === 404
          ? 'Not found — check the model name and provider'
          : `Provider returned HTTP ${res.status}`;
  return redact(detail ? `${headline}. Provider said: ${detail}` : headline, apiKey);
}

async function fetchJson(url: string, init: RequestInit, apiKey: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // A thrown fetch in the browser is almost always CORS or a network failure —
    // the response is opaque, so we can't read a status.
    throw new ClientLLMError(
      `Could not reach ${new URL(url).host}. This is usually the provider blocking ` +
        `direct browser (CORS) requests, or a network error. (${e instanceof Error ? e.message : e})`,
    );
  }
  if (!res.ok) throw new ClientLLMError(await errorDetail(res, apiKey));
  return res;
}

/** One raw completion → assistant text. jsonMode requests structured output on
 *  providers that support it; the prompt-level contract is the real guarantee. */
async function rawChat(
  cfg: ProviderCfg,
  system: string,
  user: string,
  opts: { jsonMode?: boolean; temperature?: number; seed?: number } = {},
): Promise<string> {
  const maxTokens = capTokens(cfg.baseUrl, 8192);

  if (isAnthropic(cfg)) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: user }],
    };
    if (system) body.system = system;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    const res = await fetchJson(
      cfg.baseUrl.replace(/\/$/, '') + '/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      },
      cfg.apiKey,
    );
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }

  // OpenAI-compatible
  const msgs: Array<{ role: string; content: string }> = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push({ role: 'user', content: user });
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: maxTokens, messages: msgs };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.seed !== undefined && SEED_SUPPORTED.some((h) => cfg.baseUrl.includes(h))) {
    body.seed = opts.seed;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!isOllama(cfg)) headers.Authorization = 'Bearer ' + cfg.apiKey;

  const res = await fetchJson(
    cfg.baseUrl.replace(/\/$/, '') + '/chat/completions',
    { method: 'POST', headers, body: JSON.stringify(body) },
    cfg.apiKey,
  );
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

// ── JSON extraction (port of core.llm._extract_json / _fix_unescaped_quotes) ──

function fixUnescapedQuotes(s: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inString) {
      if (c === '\\') {
        out.push(c);
        i += 1;
        if (i < s.length) {
          out.push(s[i]);
          i += 1;
        }
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < s.length && ' \t\r\n'.includes(s[j])) j += 1;
        const next = j < s.length ? s[j] : '';
        if ([':', ',', '}', ']'].includes(next)) {
          inString = false;
          out.push(c);
        } else {
          out.push('\\', c);
        }
      } else {
        out.push(c);
      }
    } else {
      if (c === '"') inString = true;
      out.push(c);
    }
    i += 1;
  }
  return out.join('');
}

/** Parse the first complete JSON object starting at or after each '{'. */
function scanFirstObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as Record<string, unknown>;
          } catch {
            break; // try the next '{'
          }
        }
      }
    }
  }
  return null;
}

export function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return scanFirstObject(cleaned) ?? scanFirstObject(fixUnescapedQuotes(cleaned)) ?? {};
}

// ── Public callers, mirroring services/llm_bridge.py ──────────────────────────

export function makeLlmJson(cfg: ProviderCfg) {
  return async (system: string, prompt: string): Promise<Record<string, unknown>> => {
    const raw = await rawChat(cfg, system, prompt, {
      jsonMode: true,
      temperature: EVALUATIVE_TEMPERATURE,
      seed: EVALUATIVE_SEED,
    });
    return extractJson(raw);
  };
}

export function makeLlmChat(cfg: ProviderCfg) {
  return async (system: string, message: string): Promise<string> => rawChat(cfg, system, message);
}

/** Settings "Test key": one minimal call. Returns {ok,error}. */
export async function validateKey(cfg: ProviderCfg): Promise<{ ok: boolean; error: string | null }> {
  try {
    await rawChat(cfg, '', 'Hi', { temperature: 0 });
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof ClientLLMError && /Rate limit/.test(e.message)) return { ok: true, error: null };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
