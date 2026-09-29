import { ChatCompletionRequest, Usage } from '../types/openai.js';
import { ModelPricing, RoutingDecision } from '../types/router.js';
import { BudgetConfig, ModelRegistration } from '../config/types.js';

export class BudgetManager {
  /**
   * Applies reasoning token ceilings and reasoning_effort clamp to prevent runaway token bills
   */
  public static applyBudget(
    request: ChatCompletionRequest,
    modelConfig: ModelRegistration,
    decision: RoutingDecision,
    config: BudgetConfig
  ): ChatCompletionRequest {
    const modified: ChatCompletionRequest = { ...request };

    // 1. Enforce Reasoning Effort
    if (modelConfig.supportsReasoningEffort) {
      if (!modified.reasoning_effort) {
        if (config.enforceReasoningEffortOnMediumTasks && decision.features.complexityScore < 7.5) {
          // Moderate task: constrain reasoning effort to low or medium
          modified.reasoning_effort = config.defaultReasoningEffort || 'low';
        } else {
          modified.reasoning_effort = 'medium';
        }
      }
    }

    // 2. Cap max completion tokens if exceeding budget limit
    if (config.maxCompletionTokensLimit) {
      if (!modified.max_completion_tokens && !modified.max_tokens) {
        modified.max_completion_tokens = config.maxCompletionTokensLimit;
      } else if (modified.max_completion_tokens && modified.max_completion_tokens > config.maxCompletionTokensLimit) {
        modified.max_completion_tokens = config.maxCompletionTokensLimit;
      }
    }

    return modified;
  }

  /**
   * Calculate exact cost in USD for a given usage and model pricing
   */
  public static calculateCost(usage: Usage | undefined, pricing: ModelPricing): number {
    if (!usage) return 0;

    const cachedPromptTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const uncachedPromptTokens = Math.max(0, usage.prompt_tokens - cachedPromptTokens);
    const completionTokens = usage.completion_tokens || 0;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;

    const promptCost = (uncachedPromptTokens / 1_000_000) * pricing.promptUsdPer1M;
    const cachedPromptCost = (cachedPromptTokens / 1_000_000) * pricing.cachedPromptUsdPer1M;
    
    // Reasoning tokens might have separate pricing or be included in completion
    let completionCost = 0;
    if (pricing.reasoningUsdPer1M && reasoningTokens > 0) {
      const normalCompletionTokens = Math.max(0, completionTokens - reasoningTokens);
      completionCost = (normalCompletionTokens / 1_000_000) * pricing.completionUsdPer1M +
                       (reasoningTokens / 1_000_000) * pricing.reasoningUsdPer1M;
    } else {
      completionCost = (completionTokens / 1_000_000) * pricing.completionUsdPer1M;
    }

    return promptCost + cachedPromptCost + completionCost;
  }

  /**
   * Calculate baseline cost if this request was sent to a standard flagship model (e.g. Claude 3.5 Sonnet)
   */
  public static calculateBaselineCost(usage: Usage | undefined, baselinePricing: ModelPricing): number {
    if (!usage) return 0;
    const promptCost = (usage.prompt_tokens / 1_000_000) * baselinePricing.promptUsdPer1M;
    const completionCost = (usage.completion_tokens / 1_000_000) * baselinePricing.completionUsdPer1M;
    return promptCost + completionCost;
  }
}
