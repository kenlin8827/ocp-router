import { ChatCompletionResponse } from './openai.js';

export type TierLevel = 'tier1' | 'tier2' | 'tier3';

export interface ModelPricing {
  promptUsdPer1M: number;
  cachedPromptUsdPer1M: number;
  completionUsdPer1M: number;
  reasoningUsdPer1M?: number;
}

export interface TierModelConfig {
  id: string;
  provider: string;
  upstreamModel?: string;
  realModel?: string;
  tier?: TierLevel;
  pricing: ModelPricing;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsJsonSchema?: boolean;
  supportsReasoningEffort?: boolean;
  supportsPromptCaching?: boolean;
  isDefaultInTier?: boolean;
}

export interface RoutingDecision {
  targetTier: TierLevel;
  confidence: number;
  reason: string;
  ruleMatched?: string;
  layerUsed?: 'layer0' | 'layer1' | 'layer2';
  needsSchemaValidation: boolean;
  sessionId?: string;
  sessionRatchetApplied?: boolean;
  pinnedModel?: string;
  features: {
    tokenCountEstimate: number;
    hasCode: boolean;
    hasMathOrProof: boolean;
    hasMultiTurn: boolean;
    hasToolsOrSchema: boolean;
    complexityScore: number;
  };
}

export interface ExecutionResult {
  response: ChatCompletionResponse;
  tierUsed: TierLevel;
  modelUsed: string;
  layerUsed?: 'layer0' | 'layer1' | 'layer2';
  fallbackOccurred: boolean;
  fallbackReason?: string;
  sessionId?: string;
  sessionRatchetApplied?: boolean;
  traceId?: string;
  costUsd: number;
  baselineCostUsd: number;
  savedCostUsd: number;
  latencyMs: number;
}


