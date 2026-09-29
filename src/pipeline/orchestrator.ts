import crypto from 'node:crypto';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';
import { ExecutionResult, ModelPricing } from '../types/router.js';
import { RouterConfig } from '../config/types.js';
import { PromptOptimizer } from './prompt-optimizer.js';
import { RouterEngine } from '../router/index.js';
import { SchemaAssertion } from '../validator/schema-assertion.js';
import { FallbackContextBuilder } from '../validator/parser.js';
import { BudgetManager } from '../budget/budget-manager.js';
import { ProviderRegistry } from '../providers/registry.js';
import { FinOpsTracker } from '../metrics/finops-tracker.js';
import { FlywheelCollector } from '../flywheel/collector.js';
import { SessionManager } from '../session/session-manager.js';
import { TraceTracker } from '../trace/tracker.js';

export interface ProcessContext {
  clientIp?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export class PipelineOrchestrator {
  private config: RouterConfig;
  private registry: ProviderRegistry;
  private tracker: FinOpsTracker;
  private flywheel: FlywheelCollector;
  private sessionManager: SessionManager;
  private traceTracker: TraceTracker;
  private baselinePricing: ModelPricing;

  constructor(
    config: RouterConfig,
    registry: ProviderRegistry,
    tracker: FinOpsTracker,
    sessionManager?: SessionManager
  ) {
    this.config = config;
    this.registry = registry;
    this.tracker = tracker;
    this.flywheel = new FlywheelCollector(config.flywheel);
    this.sessionManager = sessionManager || new SessionManager(config.session);
    this.traceTracker = new TraceTracker();

    // Lookup baseline pricing for FinOps dollar calculation
    const baselineModel = this.registry.getModel(config.baselineModel) || this.registry.getModelForTier('tier2');
    this.baselinePricing = baselineModel.pricing;
  }

  public getTracker(): FinOpsTracker {
    return this.tracker;
  }

  public getFlywheel(): FlywheelCollector {
    return this.flywheel;
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getTraceTracker(): TraceTracker {
    return this.traceTracker;
  }

  /**
   * The complete orchestration workflow:
   * 1. Prompt normalization (canonical order)
   * 2. Zero-header session identification & prefix fingerprinting
   * 3. Multi-Layer hierarchical routing (Layer 0 -> Layer 1 -> Layer 2)
   * 4. Monotonic Ratchet session state enforcement (escalation only + pinned model for KV Cache protection)
   * 5. Execution with cascading fallback & schema assertion (Tier 1 lead, Tier 2 fallback)
   * 6. Budget enforcement & FinOps accounting
   * 7. Active learning data flywheel logging
   * 8. Post-turn prefix fingerprint registration
   */
  public async process(
    request: ChatCompletionRequest,
    context?: ProcessContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. Optimize message prefix order & resolve model tier aliases
    const normalizedMessages = PromptOptimizer.normalizeMessages(request);
    const normalizedRequest: ChatCompletionRequest = {
      ...request,
      messages: normalizedMessages,
    };

    if (request.model === 'tier1-fast') {
      normalizedRequest.router_options = { ...normalizedRequest.router_options, force_tier: 'tier1' };
    } else if (request.model === 'tier2-flagship') {
      normalizedRequest.router_options = { ...normalizedRequest.router_options, force_tier: 'tier2' };
    } else if (request.model === 'tier3-reasoning') {
      normalizedRequest.router_options = { ...normalizedRequest.router_options, force_tier: 'tier3' };
    } else if (request.model && request.model !== 'auto' && request.model !== 'cascading-auto') {
      const specific = this.registry.getModel(request.model);
      if (specific) {
        normalizedRequest.router_options = { ...normalizedRequest.router_options, force_tier: specific.tier };
      }
    }

    // 2. Identify / track conversation session (zero-header prefix chain + root anchor)
    const sessionResolve = this.sessionManager.resolveSessionId(
      normalizedRequest,
      context?.clientIp,
      context?.headers
    );
    const sessionId = sessionResolve.sessionId;

    // 3. Multi-Layer Hierarchical Router (Layer 0 FastRules -> Layer 1 Local CPU -> Layer 2 Jev)
    const initialDecision = await RouterEngine.routeAsync(
      normalizedRequest,
      this.config.rules,
      this.config.classifier
    );

    // 4. Apply Monotonic Session Ratchet
    // Intercept any downgrade attempts from short follow-ups; lock to pinned model to preserve KV cache
    const ratchetResult = this.sessionManager.applyRatchet(
      sessionId,
      initialDecision,
      (tier) => this.registry.getModelForTier(tier)
    );
    const decision = ratchetResult.finalDecision;
    decision.sessionId = sessionId;
    decision.sessionRatchetApplied = ratchetResult.ratchetApplied;

    let finalResponse: ChatCompletionResponse;
    let actualTier = decision.targetTier;
    // Prefer pinned model from session ratchet to maximize KV cache hit rate
    let actualModel = (ratchetResult.session.pinnedModel ? this.registry.getModel(ratchetResult.session.pinnedModel) : null) || this.registry.getModelForTier(actualTier);
    let fallbackOccurred = false;
    let fallbackReason: string | undefined = undefined;

    // 5. Execution with Cascading Fallback & Schema Assertion
    if (decision.needsSchemaValidation && this.config.fallback.enabled && !request.router_options?.disable_fallback) {
      // 5A: Tier 1 lead - Deploy Tier 1 first
      const tier1Model = this.registry.getModelForTier('tier1');
      const preparedTier1Req = BudgetManager.applyBudget(
        normalizedRequest,
        tier1Model,
        decision,
        this.config.budget
      );

      let tier1Res: ChatCompletionResponse | null = null;
      let assertionPassed = false;
      let assertionError = '';

      try {
        tier1Res = await this.registry.execute(preparedTier1Req, tier1Model);
        const content = tier1Res.choices[0]?.message?.content || '';

        // Local static AST / Schema assertion (Zero extra LLM cost!)
        const validation = SchemaAssertion.validate(content, normalizedRequest.response_format);
        if (validation.valid) {
          assertionPassed = true;
          finalResponse = tier1Res;
          actualTier = 'tier1';
          actualModel = tier1Model;
        } else {
          assertionError = validation.error || 'Schema validation assertion failed';
        }
      } catch (err: any) {
        assertionError = `Tier 1 Execution Error: ${err.message}`;
      }

      // 5B: Flagship fallback - If Tier 1 failed assertion, silent escalation to Tier 2/3
      if (!assertionPassed) {
        fallbackOccurred = true;
        fallbackReason = assertionError;
        const escalateTier = this.config.fallback.escalateTier;
        const flagshipModel = this.registry.getModelForTier(escalateTier);

        const failedContent = tier1Res?.choices[0]?.message?.content || '';
        const fallbackReq = FallbackContextBuilder.buildEscalationRequest(
          normalizedRequest,
          failedContent,
          assertionError,
          flagshipModel.id
        );

        // Apply budget ceilings to flagship model
        const preparedFallbackReq = BudgetManager.applyBudget(
          fallbackReq,
          flagshipModel,
          decision,
          this.config.budget
        );

        finalResponse = await this.registry.execute(preparedFallbackReq, flagshipModel);
        actualTier = escalateTier;
        actualModel = flagshipModel;
      }
    } else {
      // Standard Direct Model Execution
      const preparedReq = BudgetManager.applyBudget(
        normalizedRequest,
        actualModel,
        decision,
        this.config.budget
      );

      finalResponse = await this.registry.execute(preparedReq, actualModel);
    }

    // 6. Post-Turn Registration: Register completed turn prefix fingerprint for zero-header tracking
    const assistantContent = finalResponse!.choices[0]?.message?.content || '';
    this.sessionManager.registerCompletedTurn(
      sessionId,
      normalizedRequest.messages,
      assistantContent
    );

    // 7. FinOps Tracking & Economics Calculation
    const latencyMs = Date.now() - startTime;
    const actualCost = BudgetManager.calculateCost(finalResponse!.usage, actualModel.pricing);
    const baselineCost = BudgetManager.calculateBaselineCost(
      finalResponse!.usage,
      this.baselinePricing
    );
    const savedCostUsd = Math.max(0, baselineCost - actualCost);

    const cachedTokens = PromptOptimizer.extractCachedTokens(finalResponse!.usage);
    this.tracker.record({
      tier: actualTier,
      fallbackOccurred,
      promptTokens: finalResponse!.usage?.prompt_tokens || 0,
      cachedPromptTokens: cachedTokens,
      completionTokens: finalResponse!.usage?.completion_tokens || 0,
      reasoningTokens: finalResponse!.usage?.completion_tokens_details?.reasoning_tokens || 0,
      actualCost,
      baselineCost,
      latencyMs,
    });

    // 8. Active Learning Data Flywheel Collection
    await this.flywheel.record({
      requestId: finalResponse!.id || `req_${Date.now()}`,
      request: normalizedRequest,
      decision,
      tierUsed: actualTier,
      modelUsed: actualModel.id,
      fallbackOccurred,
      fallbackReason,
      costUsd: actualCost,
      latencyMs,
    });

    // 9. Session Trajectory Recording
    const traceId = `trace_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const lastUserMsg = normalizedRequest.messages.filter(m => m.role === 'user').pop();
    const userPromptSummary = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content.slice(0, 200)
      : Array.isArray(lastUserMsg?.content)
        ? (lastUserMsg.content.map(p => (p as any).text || '').join(' ')).slice(0, 200)
        : '';

    this.traceTracker.record({
      traceId,
      sessionId,
      turnNumber: ratchetResult.session.turnCount,
      timestamp: startTime,
      request: {
        model: request.model || 'auto',
        userPromptSummary,
        messageCount: normalizedRequest.messages.length,
        hasSystemPrompt: normalizedRequest.messages.some(m => m.role === 'system'),
        hasToolsOrSchema: Boolean(decision.needsSchemaValidation),
      },
      routing: {
        layerUsed: (decision.layerUsed || 'layer0') as any,
        targetTier: actualTier,
        confidence: decision.confidence,
        reason: decision.reason,
        sessionRatchetApplied: ratchetResult.ratchetApplied,
      },
      execution: {
        modelUsed: actualModel.id,
        provider: actualModel.provider,
        tierUsed: actualTier,
        latencyMs,
        fallbackOccurred,
        fallbackReason,
      },
      finops: {
        promptTokens: finalResponse!.usage?.prompt_tokens || 0,
        completionTokens: finalResponse!.usage?.completion_tokens || 0,
        cachedPromptTokens: cachedTokens,
        costUsd: actualCost,
        savedCostUsd,
      },
    });

    return {
      response: finalResponse!,
      tierUsed: actualTier,
      modelUsed: actualModel.id,
      layerUsed: decision.layerUsed || 'layer0',
      fallbackOccurred,
      fallbackReason,
      sessionId,
      sessionRatchetApplied: ratchetResult.ratchetApplied,
      traceId,
      costUsd: actualCost,
      baselineCostUsd: baselineCost,
      savedCostUsd,
      latencyMs,
    };
  }
}
