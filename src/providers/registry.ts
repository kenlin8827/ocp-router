import { LLMProvider } from './base.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { ModelRegistration, ProviderConfig, RouterConfig } from '../config/types.js';
import { TierLevel } from '../types/router.js';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private models = new Map<string, ModelRegistration>();
  private tierDefaults = new Map<TierLevel, ModelRegistration>();
  private mockMode = false;

  constructor(config: RouterConfig, mockMode = false) {
    this.mockMode = mockMode;

    // Initialize providers
    for (const pConfig of config.providers || []) {
      if (pConfig.type === 'anthropic') {
        this.providers.set(pConfig.name, new AnthropicProvider(pConfig));
      } else {
        this.providers.set(pConfig.name, new OpenAICompatibleProvider(pConfig));
      }
    }

    // Initialize models
    for (const mConfig of config.models || []) {
      this.models.set(mConfig.id, mConfig);
      if (mConfig.isDefaultInTier) {
        this.tierDefaults.set(mConfig.tier, mConfig);
      } else if (!this.tierDefaults.has(mConfig.tier)) {
        this.tierDefaults.set(mConfig.tier, mConfig);
      }
    }

    // In mock testing mode, if no models provided, populate mock tier models
    if (this.mockMode && this.models.size === 0) {
      const mockT1: ModelRegistration = {
        id: 'mock-fast',
        provider: 'mock',
        upstreamModel: 'mock-fast',
        tier: 'fast',
        isDefaultInTier: true,
        pricing: { promptUsdPer1M: 0.2, cachedPromptUsdPer1M: 0.05, completionUsdPer1M: 0.8 },
      };
      const mockT2: ModelRegistration = {
        id: 'mock-flagship',
        provider: 'mock',
        upstreamModel: 'mock-flagship',
        tier: 'flagship',
        isDefaultInTier: true,
        pricing: { promptUsdPer1M: 3.0, cachedPromptUsdPer1M: 0.75, completionUsdPer1M: 12.0 },
      };
      const mockT3: ModelRegistration = {
        id: 'mock-reasoning',
        provider: 'mock',
        upstreamModel: 'mock-reasoning',
        tier: 'reasoning',
        isDefaultInTier: true,
        pricing: { promptUsdPer1M: 15.0, cachedPromptUsdPer1M: 3.75, completionUsdPer1M: 60.0 },
      };
      this.registerModel(mockT1, true);
      this.registerModel(mockT2, true);
      this.registerModel(mockT3, true);
    }
  }

  public registerProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  public registerModel(model: ModelRegistration, isDefault = false): void {
    this.models.set(model.id, model);
    if (isDefault || !this.tierDefaults.has(model.tier)) {
      this.tierDefaults.set(model.tier, model);
    }
  }

  public setDefaultTierModel(tier: TierLevel, model: ModelRegistration): void {
    this.models.set(model.id, model);
    this.tierDefaults.set(tier, model);
  }

  public getModel(modelId: string): ModelRegistration | undefined {
    return this.models.get(modelId);
  }

  public getModelForTier(tier: TierLevel): ModelRegistration {
    const model = this.tierDefaults.get(tier);
    if (!model) {
      const fallback =
        this.tierDefaults.get('flagship') ||
        this.tierDefaults.get('fast') ||
        this.tierDefaults.get('reasoning') ||
        Array.from(this.models.values())[0];
      if (!fallback) {
        throw new Error(`No models registered in system.`);
      }
      return fallback;
    }
    return model;
  }

  public getAllModels(): ModelRegistration[] {
    return Array.from(this.models.values());
  }

  public async execute(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<ChatCompletionResponse> {
    if (this.mockMode) {
      return this.mockExecute(request, model);
    }

    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new Error(`Provider '${model.provider}' not found for model '${model.id}'`);
    }

    return provider.createCompletion(request, model);
  }

  /**
   * High-fidelity mock executor for automated testing & offline demos
   */
  private async mockExecute(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<ChatCompletionResponse> {
    const isJsonRequested =
      request.response_format?.type === 'json_object' ||
      request.response_format?.type === 'json_schema' ||
      /json/i.test(JSON.stringify(request.messages));

    let content = 'This is a standard mock response from ' + model.id;

    if (isJsonRequested) {
      // Simulate fast tier occasionally returning slightly malformed JSON or valid JSON
      if (model.tier === 'fast' && (request as any).__simulate_malformed__) {
        content = '{ "name": "sample", "invalid_json_trailing": ';
      } else {
        content = JSON.stringify({
          status: 'success',
          tier: model.tier,
          model: model.id,
          data: {
            title: 'Mock Structured Output',
            category: 'test',
          },
        });
      }
    }

    return {
      id: `mock-chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 80,
        total_tokens: 230,
        prompt_tokens_details: {
          cached_tokens: 50,
        },
      },
    };
  }
}
