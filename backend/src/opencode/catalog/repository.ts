import { OpenCodeConnector } from '../sync.js';
import { listOpenCodeProviders, getProviderNodeById } from '../user-config.js';
import type { CatalogConfig } from '../../config/types.js';
import { resolveSources, parseByType, type RemoteSourceDef, type ParsedSource } from './sources/registry.js';
import { modelsDevLogoUrl } from './sources/models-dev.js';
import { readCacheFile, writeCacheFile } from './cache.js';
import type { CatalogModel, CatalogProviderRecord, CatalogSourceId } from './types.js';

/**
 * Config-driven multi-source catalog aggregator.
 *
 * Remote sources are declared in config.yaml (`catalog.sources`) — id/type/url/
 * enabled/priority — and dispatched through the normalizer registry. Adding a
 * source of a known type requires zero code changes.
 *
 * Merge precedence (highest wins): config definition > live service > remote
 * sources by ascending `priority` (openrouter 30 > models-dev 40 by default).
 * OpenRouter-style `vendor/model` ids are demultiplexed onto matching provider
 * records so first-party pricing overlays the static catalog; unmatched vendors
 * stay under their own source entry.
 */

const SERVICE_TTL_MS = 5 * 60 * 1000;
/** OpenRouter's official brand glyph (verified 200). */
const OPENROUTER_BRAND_LOGO = 'https://openrouter.ai/brand/v2/openrouter-glyph-light.svg';

/** Union-merge model lists by id; `overlay` entries win on collision. */
export function mergeModels(base: CatalogModel[], overlay: CatalogModel[]): CatalogModel[] {
  const byId = new Map<string, CatalogModel>();
  for (const m of base) byId.set(m.id, m);
  for (const m of overlay) {
    const existing = byId.get(m.id);
    byId.set(m.id, existing ? { ...existing, ...m, source: m.source } : m);
  }
  return Array.from(byId.values());
}

function addSource(sources: CatalogSourceId[], s: CatalogSourceId): CatalogSourceId[] {
  return sources.includes(s) ? sources : [...sources, s];
}

interface ServiceProbe {
  available: boolean;
  baseURLs: Map<string, string>;
}

interface RemoteState {
  def: RemoteSourceDef;
  parsed: ParsedSource;
  origin: 'network' | 'cache' | 'stale' | 'none';
}

export class CatalogRepository {
  private remote = new Map<string, RemoteState>();
  private serviceProbe: ServiceProbe | null = null;
  private serviceProbedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connector: OpenCodeConnector | null = null;
  private sources: RemoteSourceDef[] = resolveSources();
  private intervalMs = 24 * 3600 * 1000;
  private started = false;

  /**
   * Apply config before start(). If `catalog.sources` is empty/omitted the
   * built-in defaults (openrouter, models.dev) are used.
   */
  applyConfig(catalog?: CatalogConfig): this {
    if (this.started) return this;
    if (catalog?.syncIntervalMs && catalog.syncIntervalMs > 0) this.intervalMs = catalog.syncIntervalMs;
    this.sources = resolveSources(catalog?.sources);
    return this;
  }

  /** Boot-time sync of every enabled source + periodic refresh. */
  async start(): Promise<void> {
    this.started = true;
    await Promise.all(this.sources.map((def) => this.syncRemote(def)));
    this.timer = setInterval(() => {
      void Promise.all(this.sources.map((def) => this.syncRemote(def)));
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get lastSyncOrigin(): string {
    return this.sources
      .map((def) => `${def.id}:${this.remote.get(def.id)?.origin ?? 'none'}`)
      .join(', ');
  }

  private async syncRemote(def: RemoteSourceDef): Promise<void> {
    const cacheName = `catalog-${def.id}`;
    const cached = readCacheFile<ParsedSource>(cacheName);
    // Shape validation: legacy caches (pre-repository) stored a bare array and
    // must NOT be treated as a valid ParsedSource.
    const cachedValid = Boolean(
      cached?.data &&
      typeof cached.data === 'object' &&
      !Array.isArray(cached.data) &&
      (Array.isArray(cached.data.providers) || Array.isArray(cached.data.models))
    );
    const fresh = cachedValid && cached && Date.now() - cached.fetchedAt < this.intervalMs;

    if (fresh && cached) {
      this.applyRemote(def, cached.data, 'cache');
      return;
    }

    try {
      const res = await fetch(def.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'OpenCode-Router/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseByType(def.type, await res.json());
      if (!parsed) throw new Error(`no normalizer registered for type '${def.type}'`);
      const nonEmpty = (parsed.providers?.length || parsed.models?.length || 0) > 0;
      if (nonEmpty) writeCacheFile(cacheName, parsed);
      this.applyRemote(def, parsed, nonEmpty ? 'network' : 'none');
    } catch {
      if (cachedValid && cached) this.applyRemote(def, cached.data, 'stale');
      else {
        this.remote.set(def.id, { def, parsed: {}, origin: 'none' });
      }
    }
  }

  private applyRemote(def: RemoteSourceDef, parsed: ParsedSource, origin: RemoteState['origin']): void {
    this.remote.set(def.id, { def, parsed, origin });
  }

  /** Remote entries producing model lists, ascending priority. */
  private modelSources(): RemoteState[] {
    return [...this.remote.values()]
      .filter((r) => Array.isArray(r.parsed.models) && r.parsed.models!.length > 0)
      .sort((a, b) => a.def.priority - b.def.priority);
  }

  /** OpenRouter-style `vendor/model` → vendor → models (first writer wins per id). */
  private demuxByVendor(): Map<string, CatalogModel[]> {
    const map = new Map<string, CatalogModel[]>();
    for (const src of this.modelSources()) {
      for (const m of src.parsed.models!) {
        const slash = m.id.indexOf('/');
        if (slash <= 0) continue;
        const vendor = m.id.slice(0, slash);
        if (!map.has(vendor)) map.set(vendor, []);
        map.get(vendor)!.push({ ...m, id: m.id.slice(slash + 1) });
      }
    }
    return map;
  }

  private configModelsFor(id: string): CatalogModel[] {
    const node = getProviderNodeById(id);
    if (!node?.models || typeof node.models !== 'object') return [];
    return Object.entries<any>(node.models).map(([mid, m]) => ({
      id: mid,
      name: m?.name || undefined,
      reasoning: m?.reasoning === true || undefined,
      source: 'config' as const,
    }));
  }

  /** Unified, management-safe catalog view (no secrets). */
  async list(): Promise<CatalogProviderRecord[]> {
    const unified = new Map<string, CatalogProviderRecord>();

    // 1. opencode user data (config definitions + credentials) — real-time, top precedence
    for (const v of listOpenCodeProviders()) {
      unified.set(v.id, {
        id: v.id,
        name: v.name,
        npm: v.npm,
        baseURL: v.baseURL,
        custom: v.custom,
        connected: v.auth.connected,
        sources: ['config'],
        models: this.configModelsFor(v.id),
      });
    }

    const orByVendor = this.demuxByVendor();

    // 2. provider-catalog sources (ascending priority): metadata + models overlay
    for (const src of [...this.remote.values()]
      .filter((r) => Array.isArray(r.parsed.providers) && r.parsed.providers!.length > 0)
      .sort((a, b) => a.def.priority - b.def.priority)) {
      for (const md of src.parsed.providers!) {
        const catalogModels = orByVendor.get(md.id);
        const merged = catalogModels ? mergeModels(md.models, catalogModels) : md.models;
        const existing = unified.get(md.id);
        if (!existing) {
          unified.set(md.id, { ...md, models: merged });
          continue;
        }
        existing.name = existing.name || md.name;
        existing.logoUrl = existing.logoUrl || md.logoUrl;
        existing.api = existing.api || md.api;
        existing.doc = existing.doc || md.doc;
        existing.env = existing.env || md.env;
        existing.sources = addSource(existing.sources, src.def.id as CatalogSourceId);
        existing.models = mergeModels(merged, existing.models); // config models win
      }
    }

    // 3. model-list sources: demux overlay onto matching providers + own record
    const ownRecordDone = new Set<string>();
    for (const src of this.modelSources()) {
      const sourceId = src.def.id as CatalogSourceId;
      for (const [vendor, models] of orByVendor) {
        const rec = unified.get(vendor);
        if (!rec) continue;
        // Only overlay models whose source belongs to this src (demux map is shared)
        rec.sources = addSource(rec.sources, sourceId);
        rec.models = mergeModels(
          rec.models,
          models.filter((m) => !rec.models.some((e) => e.id === m.id && e.source === 'config'))
        );
      }
      // First-party record for the source itself (e.g. 'openrouter')
      if (!ownRecordDone.has(src.def.id)) {
        ownRecordDone.add(src.def.id);
        const rec = unified.get(src.def.id);
        const models = src.parsed.models!;
        if (rec) {
          rec.models = mergeModels(models, rec.models.filter((m) => m.source === 'config'));
          rec.sources = addSource(rec.sources, sourceId);
          if (src.def.id === 'openrouter') rec.logoUrl = OPENROUTER_BRAND_LOGO;
        } else {
          unified.set(src.def.id, {
            id: src.def.id,
            name: src.def.id,
            logoUrl: src.def.id === 'openrouter' ? OPENROUTER_BRAND_LOGO : modelsDevLogoUrl(src.def.id),
            custom: false,
            connected: false,
            sources: [sourceId],
            models,
          });
        }
      }
    }

    // 4. live service baseURL hints (effective routing endpoints)
    const service = await this.probeService();
    if (service.available) {
      for (const [id, baseURL] of service.baseURLs) {
        const rec = unified.get(id);
        if (!rec) continue;
        rec.baseURL = rec.baseURL || baseURL;
        rec.sources = addSource(rec.sources, 'service');
      }
    }

    return Array.from(unified.values()).sort(
      (a, b) =>
        Number(b.custom || b.connected) - Number(a.custom || a.connected) ||
        (a.name || '').localeCompare(b.name || '')
    );
  }

  async getProvider(id: string): Promise<CatalogProviderRecord | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  /** Cheapest known input price ($/1M); negative promo prices are ignored. */
  minInputPrice(rec: CatalogProviderRecord): number | undefined {
    const prices = rec.models
      .map((m) => m.pricing?.input)
      .filter((v): v is number => typeof v === 'number' && v >= 0);
    return prices.length > 0 ? Math.min(...prices) : undefined;
  }

  private async probeService(): Promise<ServiceProbe> {
    if (this.serviceProbe && Date.now() - this.serviceProbedAt < SERVICE_TTL_MS) {
      return this.serviceProbe;
    }
    const probe: ServiceProbe = { available: false, baseURLs: new Map() };
    try {
      if (!this.connector) this.connector = new OpenCodeConnector();
      if (this.connector.isAvailable()) {
        const providers = await this.connector.getProviders();
        for (const p of providers) {
          const baseURL = p?.settings?.baseURL;
          if (p?.id && typeof baseURL === 'string') probe.baseURLs.set(p.id, baseURL);
        }
        probe.available = true;
      }
    } catch {
      // service offline — keep cached negative result for the TTL window
    }
    this.serviceProbe = probe;
    this.serviceProbedAt = Date.now();
    return probe;
  }
}

/** Process-wide singleton (scheduler runs once per gateway). */
export const catalogRepository = new CatalogRepository();
