import { ModelPricing, TierLevel } from '../types/router.js';

import { CircuitBreakerConfig, RetryConfig } from '../resilience/types.js';

export interface ProviderConfig {
  name: string;
  type: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  organization?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ModelRegistration {
  id: string; // e.g., 'gpt-4o-mini', 'claude-3-5-haiku-20241022', 'deepseek-chat'
  provider: string; // matches ProviderConfig.name
  upstreamModel: string; // actual model name sent to upstream
  tier: TierLevel;
  pricing: ModelPricing;
  priority?: number; // lower number = higher priority within the tier (e.g. 1 is primary, 2 is backup)
  isDefaultInTier?: boolean;
  supportsReasoningEffort?: boolean;
  supportsPromptCaching?: boolean;
}

export interface FallbackConfig {
  enabled: boolean;
  maxRetries: number;
  escalateTier: 'flagship' | 'reasoning';
  injectErrorContext: boolean;
}

export interface BudgetConfig {
  defaultReasoningEffort: 'low' | 'medium' | 'high';
  enforceReasoningEffortOnMediumTasks: boolean;
  maxCompletionTokensLimit?: number;
}

export interface CustomRule {
  name: string;
  pattern: string; // regex pattern
  tier: TierLevel;
  reason?: string;
}

export interface OpenCodeConfig {
  url?: string;
  password?: string;
}

export interface Layer1ClassifierConfig {
  enabled: boolean;
  modelPath?: string;
  confidenceThreshold?: number; // e.g., 0.85
}
export type LocalModelConfig = Layer1ClassifierConfig;

export interface Layer2JudgeConfig {
  enabled: boolean;
  provider: 'typesafe' | 'opencode' | 'openrouter' | 'custom';
  baseUrl?: string;
  apiKey?: string;
  model?: string; // e.g. 'typesafe/jev'
  timeoutMs?: number;
}
export type Layer2DecisionConfig = Layer2JudgeConfig;

export interface ClassifierConfig {
  layer1?: Layer1ClassifierConfig;
  localModel?: Layer1ClassifierConfig;
  layer2?: Layer2JudgeConfig;
}

export interface FlywheelConfig {
  enabled: boolean;
  datasetPath?: string; // default: './data/flywheel.jsonl'
  maxSamples?: number;
  logUserPrompt?: boolean;
}

export interface SessionConfig {
  enabled: boolean;
  strategy?: 'monotonic' | 'sticky' | 'stateless';
  ttlSeconds?: number; // default: 3600 (1 hour)
  maxSessions?: number; // default: 10000
}

export interface ApiKeyConfig {
  id: string; // Unique identifier, e.g. 'key-xxxxxx'
  name: string; // Client / application name, e.g. 'Cursor IDE', 'NextChat'
  key: string; // The token string, e.g. 'sk-ocr-xxxxxx'
  role?: 'admin' | 'user';
  enabled: boolean;
  createdAt: string;
  expiresAt?: string;
  description?: string;
}

/**
 * Catalog source registry — remote sources are fully config-declared.
 * `type` maps to a normalizer registered in opencode/catalog/sources/registry.ts;
 * adding a new source of a KNOWN type is pure configuration (no code).
 * `priority`: lower number = higher precedence when merging (config=10, service=20;
 * remote sources should use >=30).
 */
export interface CatalogSourceConfig {
  id: string;
  type: 'provider-catalog' | 'model-list' | 'openai-compatible';
  url: string;
  enabled?: boolean;
  priority?: number;
}

export interface CatalogConfig {
  syncIntervalMs?: number;
  sources?: CatalogSourceConfig[];
}

export const DEFAULT_CATALOG_SOURCES: CatalogSourceConfig[] = [
  // Baseline: the OpenCode built-in catalog (models.dev) — lowest priority number,
  // processed first, so its non-blank values win and later sources only fill blanks.
  { id: 'builtin', type: 'provider-catalog', url: 'https://models.dev/api.json', enabled: true, priority: 10 },
  // Extension sources fill missing fields only (never overwrite non-blank values).
  { id: 'openrouter', type: 'model-list', url: 'https://openrouter.ai/api/v1/models', enabled: true, priority: 30 },
];

export interface RouterConfig {
  port: number;
  host: string;
  adminApiKey?: string;
  apiKeys?: ApiKeyConfig[];
  opencode?: OpenCodeConfig;
  catalog?: CatalogConfig;
  rules?: CustomRule[];
  fallback: FallbackConfig;
  budget: BudgetConfig;
  classifier?: ClassifierConfig;
  flywheel?: FlywheelConfig;
  session?: SessionConfig;
  circuitBreaker?: CircuitBreakerConfig;
  retry?: RetryConfig;
  providers?: ProviderConfig[];
  models?: ModelRegistration[];
  baselineModel: string; // Default flagship model id for calculating FinOps cost savings
}

export type { CircuitBreakerConfig, RetryConfig };
