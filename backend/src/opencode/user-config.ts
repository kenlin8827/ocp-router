import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyEdits,
  modify,
  parse,
  type JSONPath,
  type ParseError,
} from 'jsonc-parser';

/**
 * OpenCode user-level configuration management.
 *
 * Responsibilities (mirrors OpenCode's own conventions):
 *  - Provider definitions  -> `provider` node of ~/.config/opencode/opencode.jsonc (JSONC, comments preserved)
 *  - Credentials           -> ~/.local/share/opencode/auth.json ({ "<providerID>": { type: 'api', key } | { type: 'oauth', ... } })
 *
 * Hard rules:
 *  - All writes to opencode.jsonc are text-level edits via jsonc-parser (parse -> modify -> applyEdits),
 *    so user comments and formatting survive.
 *  - All writes are read-modify-write with atomic rename (temp file + rename).
 *  - Secrets are never returned unmasked from list/read APIs.
 */

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function getOpenCodeConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'opencode');
}

export function getOpenCodeConfigPath(): string {
  const dir = getOpenCodeConfigDir();
  const candidates = [
    path.join(dir, 'opencode.jsonc'),
    path.join(dir, 'opencode.json'),
    path.join(os.homedir(), '.opencode', 'opencode.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // default target when nothing exists yet
}

export function getOpenCodeAuthPath(): string {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgData, 'opencode', 'auth.json');
}

// ---------------------------------------------------------------------------
// JSONC primitives (comment-preserving)
// ---------------------------------------------------------------------------

/** Parse a JSONC file tolerantly; returns undefined when missing or unparsable. */
export function readJsonc(filePath: string): any {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const errors: ParseError[] = [];
    const parsed = parse(raw, errors, { allowTrailingComma: true });
    if (errors.length > 0 || parsed === undefined) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function backupOnce(filePath: string, suffix: string): void {
  if (!fs.existsSync(filePath)) return;
  const backupPath = `${filePath}${suffix}`;
  if (!fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // best effort
    }
  }
}

/**
 * Patch a single location inside a JSONC file with a text-level edit.
 * Passing `undefined` as value removes the property (JSONPath must point at a property).
 * Preserves all comments and unrelated formatting.
 */
export function patchJsonc(
  filePath: string,
  jsonPath: JSONPath,
  value: any,
  opts: { backupSuffix?: string } = {}
): void {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  let edits;
  try {
    edits = modify(raw, jsonPath, value, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
  } catch {
    throw new Error(`Unable to compute JSONC edit for ${filePath} at ${jsonPath.join('.')}`);
  }

  const edited = applyEdits(raw, edits);
  if (edited === raw) return; // nothing changed

  if (opts.backupSuffix) backupOnce(filePath, opts.backupSuffix);
  atomicWrite(filePath, edited);
}

// ---------------------------------------------------------------------------
// auth.json (credentials store)
// ---------------------------------------------------------------------------

export interface OpenCodeAuthEntry {
  type: 'api' | 'oauth' | 'wellknown';
  key?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  account_id?: string;
}

export function readAuthEntries(): Record<string, OpenCodeAuthEntry> {
  const authPath = getOpenCodeAuthPath();
  const parsed = readJsonc(authPath);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed as Record<string, OpenCodeAuthEntry>;
}

export function setAuthEntry(providerId: string, entry: OpenCodeAuthEntry): void {
  if (!providerId || /[^A-Za-z0-9._\-\/]/.test(providerId)) {
    throw new Error(`Invalid provider id: '${providerId}'`);
  }
  const authPath = getOpenCodeAuthPath();
  const current = readAuthEntries();
  const existing = current[providerId];
  // Preserve oauth tokens when only refreshing api fields
  const merged: OpenCodeAuthEntry =
    existing?.type === 'oauth' && entry.type === 'oauth'
      ? { ...existing, ...entry }
      : entry;
  patchJsonc(authPath, [providerId], merged, { backupSuffix: '.ocr-backup' });
}

export function setAuthApiKey(providerId: string, apiKey: string): void {
  setAuthEntry(providerId, { type: 'api', key: apiKey });
}

export function removeAuthEntry(providerId: string): void {
  const authPath = getOpenCodeAuthPath();
  if (!fs.existsSync(authPath)) return;
  const current = readAuthEntries();
  if (!(providerId in current)) return;
  patchJsonc(authPath, [providerId], undefined, { backupSuffix: '.ocr-backup' });
}

/** Never expose a full secret through management APIs. */
export function maskSecret(secret?: string): string {
  if (!secret) return '';
  if (secret.length <= 10) return `${secret.slice(0, 2)}••••`;
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

/** Expand OpenCode-style `{env:VAR}` templates against the current environment. */
export function expandEnvTemplate(value?: string): string {
  if (!value) return '';
  return value.replace(/\{env:([A-Za-z0-9_]+)\}/g, (_m, name) => process.env[name] ?? '');
}

// ---------------------------------------------------------------------------
// Provider definitions (opencode.jsonc `provider` node)
// ---------------------------------------------------------------------------

export const ROUTER_PROVIDER_ID = 'opencode-router';
const DEFAULT_NPM = '@ai-sdk/openai-compatible';

export interface CustomProviderDef {
  id: string;
  name?: string;
  npm?: string;
  baseURL?: string;
  apiKey?: string;
  /** When true, the apiKey is written inline into options.apiKey (supports {env:VAR}); otherwise into auth.json. */
  apiKeyInline?: boolean;
  headers?: Record<string, string>;
  /** passthrough extras merged into options (organization, requestTimeoutMs, ...) */
  options?: Record<string, any>;
  models?: Record<string, any>;
}

export interface OpenCodeProviderView {
  id: string;
  name?: string;
  npm?: string;
  baseURL?: string;
  models: string[];
  custom: boolean;
  /** credential summary from auth.json / inline options (masked) */
  auth: {
    connected: boolean;
    type?: OpenCodeAuthEntry['type'];
    keyMasked?: string;
    expires?: number;
    inline?: boolean;
  };
}

function isValidProviderId(id: string): boolean {
  return Boolean(id) && /^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(id);
}

function getProviderNode(): Record<string, any> {
  const parsed = readJsonc(getOpenCodeConfigPath());
  const node = parsed?.provider;
  return node && typeof node === 'object' ? node : {};
}

/** Raw (unmasked) provider definition from opencode.jsonc — internal use only. */
export function getProviderNodeById(id: string): any | undefined {
  const node = getProviderNode();
  const def = node[id];
  return def && typeof def === 'object' ? def : undefined;
}

/** Masked, management-safe view of every provider defined in opencode.jsonc. */
export function listConfigProviders(): OpenCodeProviderView[] {
  const node = getProviderNode();
  return Object.entries(node).map(([id, def]: [string, any]) => {
    const options = def?.options && typeof def.options === 'object' ? def.options : {};
    const models = def?.models && typeof def.models === 'object' ? Object.keys(def.models) : [];
    const inlineKey = expandEnvTemplate(options.apiKey);
    return {
      id,
      name: def?.name || undefined,
      npm: def?.npm || undefined,
      baseURL: options.baseURL || undefined,
      models,
      custom: true, // anything explicitly defined in config is user-managed
      auth: {
        connected: Boolean(inlineKey),
        keyMasked: inlineKey ? maskSecret(inlineKey) : undefined,
        inline: Boolean(options.apiKey),
      },
    };
  });
}

/**
 * Upsert a custom provider into the `provider` node of opencode.jsonc.
 * By default the API key (if provided) is stored in auth.json; set apiKeyInline
 * to embed it in options instead (supports {env:VAR} templates).
 */
export function upsertCustomProvider(def: CustomProviderDef): { success: boolean; error?: string } {
  if (!isValidProviderId(def.id)) {
    return { success: false, error: `Invalid provider id: '${def.id}'` };
  }

  const options: Record<string, any> = { ...(def.options || {}) };
  if (def.baseURL) options.baseURL = def.baseURL;

  if (def.apiKey) {
    if (def.apiKeyInline) {
      options.apiKey = def.apiKey;
    } else {
      setAuthApiKey(def.id, def.apiKey);
    }
  }
  if (def.headers && Object.keys(def.headers).length > 0) options.headers = def.headers;

  const node: Record<string, any> = {};
  if (def.name) node.name = def.name;
  node.npm = def.npm || DEFAULT_NPM;
  if (Object.keys(options).length > 0) node.options = options;
  if (def.models && Object.keys(def.models).length > 0) node.models = def.models;

  try {
    patchJsonc(getOpenCodeConfigPath(), ['provider', def.id], node, {
      backupSuffix: '.ocr-backup',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function deleteCustomProvider(
  id: string,
  opts: { purgeAuth?: boolean } = {}
): { success: boolean; error?: string } {
  const node = getProviderNode();
  if (!(id in node)) {
    return { success: false, error: `Provider '${id}' is not defined in opencode.jsonc` };
  }
  try {
    patchJsonc(getOpenCodeConfigPath(), ['provider', id], undefined, {
      backupSuffix: '.ocr-backup',
    });
    if (opts.purgeAuth) removeAuthEntry(id);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Per-provider model maintenance (opencode.jsonc `provider.<id>.models`)
// ---------------------------------------------------------------------------

/** Valid model id inside a provider's `models` map — `/` allowed (aggregator
 *  gateways return vendor-scoped ids like 'vendor/model'; the key is sent
 *  verbatim as the upstream `model` field). */
function isValidModelId(id: string): boolean {
  return Boolean(id) && /^[A-Za-z0-9][A-Za-z0-9._:\-/]*$/.test(id);
}

/**
 * Glob-style pattern match used by model pull/clear.
 * - Comma-separated alternatives (`gpt-4*, o3*`)
 * - `*` / `?` wildcards when present, otherwise case-insensitive substring
 */
export function matchesGlobPattern(pattern: string, value: string): boolean {
  const parts = pattern.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return true;
  const v = value.toLowerCase();
  return parts.some((p) => {
    if (!/[*?]/.test(p)) return v.includes(p);
    const regex = new RegExp(
      '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(v);
  });
}

/** Raw model definitions of a config-defined provider ({} when the node has no models yet). */
export function getProviderModelDefs(id: string): Record<string, any> | undefined {
  const def = getProviderNodeById(id);
  if (!def) return undefined;
  return def.models && typeof def.models === 'object' ? { ...def.models } : {};
}

/** Add or replace one model inside `provider.<id>.models` (text-level JSONC edit). */
export function upsertProviderModel(
  providerId: string,
  modelId: string,
  definition: Record<string, any>
): { success: boolean; error?: string } {
  if (!getProviderNodeById(providerId)) {
    return { success: false, error: `Provider '${providerId}' is not defined in opencode.jsonc` };
  }
  if (!isValidModelId(modelId)) {
    return { success: false, error: `Invalid model id: '${modelId}'` };
  }
  if (!definition || typeof definition !== 'object') {
    return { success: false, error: 'Model definition must be an object' };
  }
  try {
    patchJsonc(getOpenCodeConfigPath(), ['provider', providerId, 'models', modelId], definition, {
      backupSuffix: '.ocr-backup',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Remove one model from `provider.<id>.models`. */
export function removeProviderModel(providerId: string, modelId: string): { success: boolean; error?: string } {
  const defs = getProviderModelDefs(providerId);
  if (defs === undefined) {
    return { success: false, error: `Provider '${providerId}' is not defined in opencode.jsonc` };
  }
  if (!(modelId in defs)) {
    return { success: false, error: `Model '${modelId}' is not defined for provider '${providerId}'` };
  }
  try {
    patchJsonc(getOpenCodeConfigPath(), ['provider', providerId, 'models', modelId], undefined, {
      backupSuffix: '.ocr-backup',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Clear models of a config-defined provider. Without a pattern the whole
 * `models` node is dropped; with a pattern only matching ids are removed
 * (per-id edits, so comments on untouched models survive).
 */
export function clearProviderModels(
  providerId: string,
  pattern?: string
): { success: boolean; removed?: number; error?: string } {
  if (!getProviderNodeById(providerId)) {
    return { success: false, error: `Provider '${providerId}' is not defined in opencode.jsonc` };
  }
  const defs = getProviderModelDefs(providerId) || {};
  const ids = Object.keys(defs);
  if (ids.length === 0) return { success: true, removed: 0 };
  try {
    if (!pattern || !pattern.trim()) {
      patchJsonc(getOpenCodeConfigPath(), ['provider', providerId, 'models'], undefined, {
        backupSuffix: '.ocr-backup',
      });
      return { success: true, removed: ids.length };
    }
    let removed = 0;
    for (const mid of ids) {
      if (!matchesGlobPattern(pattern, mid)) continue;
      patchJsonc(getOpenCodeConfigPath(), ['provider', providerId, 'models', mid], undefined, {
        backupSuffix: '.ocr-backup',
      });
      removed++;
    }
    if (removed === ids.length) {
      // pattern matched everything — drop the now-empty models node too
      patchJsonc(getOpenCodeConfigPath(), ['provider', providerId, 'models'], undefined, {
        backupSuffix: '.ocr-backup',
      });
    }
    return { success: true, removed };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Merge opencode.jsonc provider definitions with auth.json credentials into
 * a single management-safe view (one entry per provider id across both stores).
 */
export function listOpenCodeProviders(): OpenCodeProviderView[] {
  const configProviders = listConfigProviders();
  const authEntries = readAuthEntries();
  const byId = new Map<string, OpenCodeProviderView>();

  for (const p of configProviders) byId.set(p.id, p);

  for (const [id, entry] of Object.entries(authEntries)) {
    const existing = byId.get(id);
    const auth = {
      connected: true,
      type: entry.type,
      keyMasked: maskSecret(entry.key || entry.access),
      expires: entry.expires,
    };
    if (existing) {
      existing.auth = { ...existing.auth, ...auth, inline: existing.auth.inline && !entry.key };
    } else {
      byId.set(id, {
        id,
        models: [],
        custom: false, // credential-only (catalog provider connected via auth)
        auth,
      });
    }
  }

  return Array.from(byId.values());
}
