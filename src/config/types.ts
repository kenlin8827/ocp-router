import { ModelPricing, TierLevel } from '../types/router.js';

import { CircuitBreakerConfig } from '../resilience/types.js';

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

export interface RouterConfig {
  port: number;
  host: string;
  adminApiKey?: string;
  opencode?: OpenCodeConfig;
  rules?: CustomRule[];
  fallback: FallbackConfig;
  budget: BudgetConfig;
  classifier?: ClassifierConfig;
  flywheel?: FlywheelConfig;
  session?: SessionConfig;
  circuitBreaker?: CircuitBreakerConfig;
  providers?: ProviderConfig[];
  models?: ModelRegistration[];
  baselineModel: string; // Default flagship model id for calculating FinOps cost savings
}

export type { CircuitBreakerConfig };
