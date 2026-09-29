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
        providers: parsed?.providers || DEFAULT_CONFIG.providers,
        models: parsed?.models || DEFAULT_CONFIG.models,
      };
    } catch (err) {
      console.warn(`[Config] Failed to parse ${resolvedPath}, falling back to defaults:`, err);
    }
  }
  return DEFAULT_CONFIG;
}
