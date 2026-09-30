import { DEFAULT_CATALOG_SOURCES, type CatalogSourceConfig } from '../../../config/types.js';
import { normalizeModelsDev } from './models-dev.js';
import { normalizeOpenRouter } from './openrouter.js';
import type { CatalogModel, CatalogProviderRecord } from '../types.js';

/**
 * Normalizer registry — the extension point for catalog sources.
 *
 * Adding a source of a KNOWN type is pure config (config.yaml `catalog.sources`).
 * A NEW response shape requires registering one small normalizer here — that is
 * the deliberate boundary (no embedded scripting engines).
 */

export interface RemoteSourceDef {
  id: string;
  type: CatalogSourceConfig['type'];
  url: string;
  enabled: boolean;
  priority: number;
}

export interface ParsedSource {
  providers?: CatalogProviderRecord[];
  models?: CatalogModel[];
}

/** /v1/models (OpenAI-compatible) — bare model ids, rarely any pricing. */
export function normalizeOpenAICompatible(raw: any): CatalogModel[] {
  const data: any[] = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
  return data
    .filter((m) => m?.id)
    .map((m) => ({
      id: String(m.id),
      name: m.name || undefined,
      contextLimit: m.context_length ?? m.context_window ?? m.max_model_len,
      source: 'openai-compatible' as const,
    }));
}

const REGISTRY: Record<CatalogSourceConfig['type'], (raw: any) => ParsedSource> = {
  'provider-catalog': (raw) => ({ providers: normalizeModelsDev(raw) }),
  'model-list': (raw) => ({ models: normalizeOpenRouter(raw) }),
  'openai-compatible': (raw) => ({ models: normalizeOpenAICompatible(raw) }),
};

export function parseByType(type: CatalogSourceConfig['type'], raw: any): ParsedSource | null {
  const parse = REGISTRY[type];
  if (!parse) return null;
  try {
    return parse(raw);
  } catch {
    return null;
  }
}

/** Configured sources, falling back to built-in defaults; disabled entries removed. */
export function resolveSources(cfg?: CatalogSourceConfig[]): RemoteSourceDef[] {
  const list = cfg && cfg.length > 0 ? cfg : DEFAULT_CATALOG_SOURCES;
  return list
    .filter((s) => s.enabled !== false && s.id && s.type && s.url)
    .map((s) => ({
      id: s.id,
      type: s.type,
      url: s.url,
      enabled: true,
      priority: typeof s.priority === 'number' ? s.priority : 50,
    }))
    .sort((a, b) => a.priority - b.priority);
}
