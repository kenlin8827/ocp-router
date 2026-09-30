/**
 * One-shot upstream probe behind the console "Test" buttons.
 *
 * Speaks the three wire shapes users actually configure in opencode.jsonc:
 *   - openai    → POST {base}/chat/completions              (default / OpenAI-compatible gateways)
 *   - anthropic → POST {base}/messages                      (x-api-key, or Bearer for OAuth)
 *   - google    → POST {base}/models/{model}:generateContent
 *
 * A probe sends a tiny "ping" completion (max_tokens 16) and reports latency.
 * Real cost is a fraction of a cent; the value is catching dead keys / wrong
 * baseURLs / wrong model ids before the first genuine request fails.
 */

export type ProbeKind = 'openai' | 'anthropic' | 'google';

export interface ProbeOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  kind?: ProbeKind;
  /** Provider-configured extra headers (opencode.jsonc options.headers). */
  headers?: Record<string, string>;
  /** auth.json credential is an OAuth token — anthropic wants Bearer, not x-api-key. */
  oauth?: boolean;
  timeoutMs?: number;
}

export interface ProbeResult {
  ok: boolean;
  kind: ProbeKind;
  model?: string;
  latencyMs?: number;
  error?: string;
  authHint?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Map catalog `api` / npm package hints onto a wire shape. */
export function probeKindFor(api?: string, npm?: string): ProbeKind {
  const hay = `${api || ''} ${npm || ''}`.toLowerCase();
  if (hay.includes('anthropic')) return 'anthropic';
  if (hay.includes('google')) return 'google';
  return 'openai';
}

function statusHint(status: number): { authHint?: boolean; hint?: string } {
  if (status === 401 || status === 403) return { authHint: true, hint: '鉴权失败，请检查 API Key' };
  if (status === 404) return { hint: '端点不存在（baseURL 可能缺少 /v1 后缀，或 API 类型不匹配）' };
  if (status === 429) return { hint: '被限流 / 额度不足' };
  if (status >= 500) return { hint: '上游服务错误' };
  return {};
}

export async function probeProvider(opts: ProbeOptions): Promise<ProbeResult> {
  const kind = opts.kind ?? 'openai';
  const base = opts.baseURL.replace(/\/+$/, '');
  let url: string;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (kind === 'anthropic') {
    url = `${base}/messages`;
    headers['anthropic-version'] = '2023-06-01';
    if (opts.oauth) headers['authorization'] = `Bearer ${opts.apiKey}`;
    else headers['x-api-key'] = opts.apiKey;
  } else if (kind === 'google') {
    url = `${base}/models/${encodeURIComponent(opts.model)}:generateContent`;
    headers['x-goog-api-key'] = opts.apiKey;
  } else {
    url = `${base}/chat/completions`;
    headers['authorization'] = `Bearer ${opts.apiKey}`;
  }
  // User-configured headers win — same precedence as the gateway executor.
  Object.assign(headers, opts.headers || {});

  const body =
    kind === 'anthropic'
      ? { model: opts.model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
      : kind === 'google'
        ? { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 16 } }
        : { model: opts.model, max_tokens: 16, stream: false, messages: [{ role: 'user', content: 'ping' }] };

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      const { authHint, hint } = statusHint(res.status);
      return {
        ok: false,
        kind,
        model: opts.model,
        latencyMs,
        authHint,
        error: `HTTP ${res.status}${hint ? ` —— ${hint}` : ''}${text ? ` | ${text}` : ''}`,
      };
    }
    return { ok: true, kind, model: opts.model, latencyMs };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    const cause = err?.cause?.code || err?.cause?.message || err?.message;
    return {
      ok: false,
      kind,
      model: opts.model,
      latencyMs,
      error: aborted
        ? `请求超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`
        : `无法访问 ${url}: ${cause}`,
    };
  }
}
