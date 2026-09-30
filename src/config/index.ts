import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import dotenv from 'dotenv';
import { RouterConfig } from './types.js';

dotenv.config();

const DEFAULT_CONFIG: RouterConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  adminApiKey: process.env.ROUTER_API_KEY || undefined,
  baselineModel: 'auto',
  rules: [],
  fallback: {
    enabled: true,
    maxRetries: 1,
    escalateTier: 'flagship',
    injectErrorContext: true,
  },
  budget: {
    defaultReasoningEffort: 'low',
    enforceReasoningEffortOnMediumTasks: true,
    maxCompletionTokensLimit: 16384,
  },
  classifier: {
    localModel: {
      enabled: false,
      confidenceThreshold: 0.85,
    },
    layer2: {
      enabled: false,
      provider: 'typesafe',
      model: 'typesafe/jev',
      timeoutMs: 1500,
    },
  },
  flywheel: {
    enabled: true,
    datasetPath: './data/flywheel.jsonl',
    maxSamples: 100000,
    logUserPrompt: true,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    slidingWindowSize: 20,
    failureRateThreshold: 0.5,
    initialCooldownMs: 30000,
    maxCooldownMs: 5 * 3600 * 1000, // 5 hours max cooldown
    cooldownMultiplier: 2.0,
    quotaCooldownMs: 12 * 3600 * 1000, // 12 hours for quota/balance exhaustion
    halfOpenMaxProbes: 1,
    activeProbing: {
      enabled: false,
      intervalMs: 60000,
    },
  },
  retry: {
    enabled: true,
    inplace: {
      enabled: true,
      maxAttempts: 1,
      backoffMs: 200,
      jitterMs: 100,
      retryOnCauses: [
        'connection_reset',
        'network_timeout',
        'gateway_error',
        'rate_limit_burst',
        'dns_error',
      ],
      maxRateLimitWaitMs: 2000,
    },
    failover: {
      enabled: true,
      maxAttempts: 2,
      tierCrossPolicy: 'allow_escalate',
    },
  },
  providers: [],
  models: [],
};

export function loadConfig(configPath?: string): RouterConfig {
  const resolvedPath = configPath || path.resolve(process.cwd(), 'config.yaml');
  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        rules: parsed?.rules || DEFAULT_CONFIG.rules,
        fallback: { ...DEFAULT_CONFIG.fallback, ...parsed?.fallback },
        budget: { ...DEFAULT_CONFIG.budget, ...parsed?.budget },
        classifier: {
          localModel: { ...DEFAULT_CONFIG.classifier?.localModel, ...parsed?.classifier?.localModel },
          layer2: { ...DEFAULT_CONFIG.classifier?.layer2, ...parsed?.classifier?.layer2 },
        },
        flywheel: { ...DEFAULT_CONFIG.flywheel, ...parsed?.flywheel },
        circuitBreaker: { ...DEFAULT_CONFIG.circuitBreaker, ...parsed?.circuitBreaker },
        retry: {
          enabled: parsed?.retry?.enabled ?? DEFAULT_CONFIG.retry?.enabled,
          inplace: { ...DEFAULT_CONFIG.retry?.inplace, ...parsed?.retry?.inplace },
          failover: { ...DEFAULT_CONFIG.retry?.failover, ...parsed?.retry?.failover },
        },
        providers: parsed?.providers || DEFAULT_CONFIG.providers,
        models: parsed?.models || DEFAULT_CONFIG.models,
      };
    } catch (err) {
      console.warn(`[Config] Failed to parse ${resolvedPath}, falling back to defaults:`, err);
    }
  }
  return DEFAULT_CONFIG;
}
