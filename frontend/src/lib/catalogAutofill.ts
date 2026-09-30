import { opencodeApi, type OpenCodeModelView } from './api';

/**
 * Catalog auto-fill for the manual model editor: match a user-entered model id
 * against the aggregate catalog (models.dev / OpenRouter / config) and derive
 * a form patch from the hit. Consumers apply fill-blank-only semantics —
 * values the user already typed are never overwritten.
 */

/** Suffix matches shorter than this are noise (e.g. "gpt" matching everything). */
const MIN_SUFFIX_LEN = 3;

/** Reasoning-effort suffixes commonly embedded in gateway model ids
 *  ('ag/gemini-3.8-flash-high' → bare 'gemini-3.8-flash-high' → 'gemini-3.8-flash'). */
const EFFORT_SUFFIXES = ['xhigh', 'high', 'medium', 'low', 'minimal', 'fast', 'thinking', 'reasoning'];

/** Effort suffixes that map 1:1 onto the editor's reasoningEffort dropdown. */
const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'];

/**
 * Reasoning-effort level encoded in the user-entered model id, if any
 * ('my-relay/gemini-3.8-flash-high' → 'high'). Only suffixes that are valid
 * dropdown levels map; others (xhigh/fast/thinking) are match-only.
 */
export function detectEffortLevel(keys: (string | undefined)[]): string | undefined {
  for (const raw of keys) {
    const trimmed = (raw || '').trim().toLowerCase();
    if (!trimmed) continue;
    const bare = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
    return EFFORT_LEVELS.find((s) => bare.endsWith(`-${s}`));
  }
  return undefined;
}

/**
 * Normalize user-entered model ids into ordered candidate keys, most canonical
 * first: vendor prefix stripped (last '/' segment), then one trailing
 * effort-suffix removed per key. The un-stripped form always outranks the
 * stripped one, so real ids that genuinely end in an effort word are safe.
 */
export function candidateKeys(keys: (string | undefined)[]): string[] {
  const out: string[] = [];
  const push = (k: string) => {
    if (k && !out.includes(k)) out.push(k);
  };
  for (const raw of keys) {
    const trimmed = (raw || '').trim().toLowerCase();
    if (!trimmed) continue;
    const bare = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
    push(bare);
    for (const s of EFFORT_SUFFIXES) {
      const stripped = bare.endsWith(`-${s}`) ? bare.slice(0, bare.length - s.length - 1) : null;
      // a too-short remainder ('gpt-low' → 'gpt') is noise, not a catalog id
      if (stripped && stripped.length >= MIN_SUFFIX_LEN) push(stripped);
      if (stripped) break; // strip at most one effort suffix
    }
  }
  return out;
}

/**
 * Score a catalog entry against the candidates. Priority (high → low): exact
 * match on an earlier candidate > later candidate; same-provider >
 * cross-provider; dash-insensitive exact ('gemini3.8flash' ≡ 'gemini-3.8-flash',
 * some gateways drop separators) > vendor-qualified suffix match as last resort.
 */
function scoreCandidate(m: OpenCodeModelView, candidates: string[], provider: string): number {
  const id = (m.id || '').toLowerCase();
  const sameProvider = Boolean(provider) && (m.providerId || '').toLowerCase() === provider;
  const exactIdx = candidates.indexOf(id);
  if (exactIdx >= 0) {
    const exact = sameProvider ? [50, 30, 22] : [40, 25, 12];
    return exact[Math.min(exactIdx, exact.length - 1)];
  }
  const normId = id.replace(/-/g, '');
  if (normId.length >= MIN_SUFFIX_LEN) {
    const dashIdx = candidates.findIndex((c) => c.replace(/-/g, '') === normId);
    if (dashIdx >= 0) return (sameProvider ? 35 : 28) - dashIdx;
  }
  const want = candidates[0];
  if (want.length >= MIN_SUFFIX_LEN && id.length >= MIN_SUFFIX_LEN && (id.endsWith(want) || want.endsWith(id))) {
    return sameProvider ? 15 : 5;
  }
  return 0;
}

export interface CatalogMatch {
  model: OpenCodeModelView;
  /** How many entries share the winning score — >1 means the pick was ambiguous. */
  alternatives: number;
}

/**
 * Find the best catalog match for a model among the given candidate ids
 * (later keys act as fallbacks, e.g. [modelID, modelKey]). Handles vendor
 * prefixes, trailing reasoning-effort suffixes and dash-style variants via
 * candidateKeys() + scoreCandidate(). Ties keep the first catalog entry —
 * `alternatives` reports the ambiguity so callers can surface it.
 */
export async function matchCatalogModel(providerId: string, ...keys: (string | undefined)[]): Promise<CatalogMatch | null> {
  const candidates = candidateKeys(keys);
  if (candidates.length === 0) return null;
  const res = await opencodeApi.listModels();
  const provider = (providerId || '').trim().toLowerCase();
  let best: OpenCodeModelView | null = null;
  let bestScore = 0;
  let alternatives = 0;
  for (const m of res.models || []) {
    const s = scoreCandidate(m, candidates, provider);
    if (s <= 0) continue;
    if (s > bestScore) {
      best = m;
      bestScore = s;
      alternatives = 1;
    } else if (s === bestScore) {
      alternatives++;
    }
  }
  return best ? { model: best, alternatives } : null;
}

export interface CatalogAutofillPatch {
  name?: string;
  tools?: boolean;
  inputMod?: string[];
  outputMod?: string[];
  contextLimit?: string;
  outputLimit?: string;
  costInput?: string;
  costOutput?: string;
  costCacheRead?: string;
  costCacheWrite?: string;
}

/** Catalog record → editor form patch (string-typed limits, per ModelFormState). */
export function catalogAutofillPatch(m: OpenCodeModelView): CatalogAutofillPatch {
  const patch: CatalogAutofillPatch = {};
  if (m.name) patch.name = m.name;
  if (typeof m.limit?.context === 'number' && m.limit.context > 0) patch.contextLimit = String(m.limit.context);
  if (typeof m.limit?.output === 'number' && m.limit.output > 0) patch.outputLimit = String(m.limit.output);
  const input = (m.modalities?.input || []).filter(Boolean);
  const output = (m.modalities?.output || []).filter(Boolean);
  if (input.length > 0) patch.inputMod = input;
  else if (m.attachment === true) patch.inputMod = ['text', 'image']; // legacy v1 vision flag
  if (output.length > 0) patch.outputMod = output;
  if (m.tool_call != null) patch.tools = m.tool_call === true;
  // pricing ($/1M) — finite, non-negative numbers only (OpenRouter has negative
  // promo prices); blank form fields get the catalog value, 0 (free) is kept
  const num = (v: unknown): string | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? String(v) : undefined;
  patch.costInput = num(m.cost?.input);
  patch.costOutput = num(m.cost?.output);
  patch.costCacheRead = num(m.cost?.cache_read);
  patch.costCacheWrite = num(m.cost?.cache_write);
  return patch;
}
