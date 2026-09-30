/**
 * Unified provider/model catalog — normalized across sources.
 *
 * Pricing unit convention: USD per 1M tokens (models.dev `cost` is already $/1M).
 */

export type CatalogSourceId = 'models-dev' | 'openrouter' | 'openai-compatible' | 'config' | 'service';

export interface CatalogPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CatalogModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  toolCall?: boolean;
  contextLimit?: number;
  outputLimit?: number;
  pricing?: CatalogPricing;
  source: CatalogSourceId;
}

export interface CatalogProviderRecord {
  id: string;
  name?: string;
  /** models.dev logo asset (svg); frontend falls back to an initial-letter avatar on error */
  logoUrl?: string;
  npm?: string;
  /** default API base from the catalog */
  api?: string;
  /** effective base URL override (opencode.jsonc definition wins, then live service) */
  baseURL?: string;
  doc?: string;
  env?: string[];
  /** defined in opencode.jsonc provider node */
  custom: boolean;
  /** has a usable credential (auth.json entry or inline key) */
  connected: boolean;
  sources: CatalogSourceId[];
  models: CatalogModel[];
}

export interface CatalogSourceState<T> {
  fetchedAt: number;
  data: T;
}
