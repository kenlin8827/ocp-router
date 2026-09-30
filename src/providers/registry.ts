import { LLMProvider } from './base.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { ModelRegistration, ProviderConfig, RouterConfig } from '../config/types.js';
import { TierLevel } from '../types/router.js';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';
import { CircuitBreakerManager, UpstreamError } from '../resilience/index.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private models = new Map<string, ModelRegistration>();
  private tierDefaults = new Map<TierLevel, ModelRegistration>();
  private circuitBreakerManager: CircuitBreakerManager;
  private mockMode = false;

  constructor(config: RouterConfig, mockMode = false) {
    this.mockMode = mockMode;
    this.circuitBreakerManager = new CircuitBreakerManager(config.circuitBreaker);

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
      this.registerModel(mConfig, mConfig.isDefaultInTier);
    }

    // In mock testing mode, if no models provided, populate mock tier models
    if (this.mockMode && this.models.size === 0) {
      const mockT1: ModelRegistration = {
        id: 'mock-fast',
        provider: 'mock',
        upstreamModel: 'mock-fast',
        tier: 'fast',
        isDefaultInTier: true,
        pricing: { input: 0.2, cacheRead: 0.05, output: 0.8 },
      };
      const mockT2: ModelRegistration = {
        id: 'mock-flagship',
        provider: 'mock',
        upstreamModel: 'mock-flagship',
        tier: 'flagship',
        isDefaultInTier: true,
        pricing: { input: 3.0, cacheRead: 0.75, output: 12.0 },
      };
      const mockT3: ModelRegistration = {
        id: 'mock-reasoning',
        provider: 'mock',
        upstreamModel: 'mock-reasoning',
        tier: 'reasoning',
        isDefaultInTier: true,
        pricing: { input: 15.0, cacheRead: 3.75, output: 60.0 },
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
    this.circuitBreakerManager.registerModel(model);
    if (isDefault || !this.tierDefaults.has(model.tier)) {
      this.tierDefaults.set(model.tier, model);
    }
  }

  public getCircuitBreakerManager(): CircuitBreakerManager {
    return this.circuitBreakerManager;
  }

  public setDefaultTierModel(tier: TierLevel, model: ModelRegistration): void {
    this.models.set(model.id, model);
    this.tierDefaults.set(tier, model);
    this.circuitBreakerManager.registerModel(model);
  }

  public getModel(modelId: string): ModelRegistration | undefined {
    return this.models.get(modelId);
  }

  /**
   * Returns all candidate models registered for a given tier, sorted by priority.
   * If healthyOnly is true, only returns models where circuit breaker allows execution.
   */
  public getCandidateModelsForTier(tier: TierLevel, healthyOnly = true): ModelRegistration[] {
    const list = Array.from(this.models.values()).filter(m => m.tier === tier);
    list.sort((a, b) => {
      const prioA = a.isDefaultInTier ? 0 : (a.priority ?? 10);
      const prioB = b.isDefaultInTier ? 0 : (b.priority ?? 10);
      return prioA - prioB;
    });

    if (healthyOnly) {
      return list.filter(m => this.circuitBreakerManager.isAvailable(m.id));
    }
    return list;
  }

  public getModelForTier(tier: TierLevel, healthyOnly = true): ModelRegistration {
    const candidates = this.getCandidateModelsForTier(tier, healthyOnly);
    if (candidates.length > 0) {
      return candidates[0];
    }
    // If healthyOnly was true and no healthy models found, fallback to any model in tier
    if (healthyOnly) {
      const anyCandidate = this.getCandidateModelsForTier(tier, false);
      if (anyCandidate.length > 0) {
        return anyCandidate[0];
      }
    }
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
    const reqAny = request as any;
    if (reqAny.__simulate_error_model__ === model.id || reqAny.__simulate_error_all__) {
      const status = reqAny.__simulate_status__ || 503;
      const errorMsg = reqAny.__simulate_message__ || `Simulated error for model ${model.id} (Status ${status})`;
      throw new UpstreamError({
        message: errorMsg,
        status,
        errorBody: JSON.stringify({ error: { message: errorMsg, code: reqAny.__simulate_code__ } }),
        provider: model.provider,
        modelId: model.id,
        retryAfterSeconds: reqAny.__simulate_retry_after__,
      });
    }

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
