import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RouterConfig } from '../src/config/types.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { FinOpsTracker } from '../src/metrics/finops-tracker.js';
import { PipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { createServer } from '../src/server.js';

describe('Resilience: Cost-Aware In-Place Retry & KV Cache Preservation (ADR-0009)', () => {
  const baseConfig: RouterConfig = {
    port: 3000,
    host: '127.0.0.1',
    baselineModel: 'primary-flagship',
    fallback: {
      enabled: false,
      maxRetries: 1,
      escalateTier: 'flagship',
      injectErrorContext: true,
    },
    budget: {
      defaultReasoningEffort: 'low',
      enforceReasoningEffortOnMediumTasks: false,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2,
    },
    retry: {
      enabled: true,
      inplace: {
        enabled: true,
        maxAttempts: 1,
        backoffMs: 10,
        jitterMs: 5,
      },
      failover: {
        enabled: true,
        maxAttempts: 2,
        tierCrossPolicy: 'allow_escalate',
      },
    },
    models: [
      {
        id: 'primary-flagship',
        provider: 'mock',
        upstreamModel: 'primary-flagship',
        tier: 'flagship',
        priority: 1,
        isDefaultInTier: true,
        pricing: { input: 3.0, cacheRead: 0.3, output: 15.0 },
      },
      {
        id: 'secondary-flagship',
        provider: 'mock',
        upstreamModel: 'secondary-flagship',
        tier: 'flagship',
        priority: 2,
        pricing: { input: 3.0, cacheRead: 0.3, output: 15.0 },
      },
      {
        id: 'mock-fast-1',
        provider: 'mock',
        upstreamModel: 'mock-fast-1',
        tier: 'fast',
        priority: 1,
        isDefaultInTier: true,
        pricing: { input: 0.15, cacheRead: 0.015, output: 0.6 },
      },
      {
        id: 'mock-fast-2',
        provider: 'mock',
        upstreamModel: 'mock-fast-2',
        tier: 'fast',
        priority: 2,
        pricing: { input: 0.15, cacheRead: 0.015, output: 0.6 },
      },
    ],
  };

  it('should succeed via In-Place Retry on transient 503, preserving same model and 100% KV cache', async () => {
    const registry = new ProviderRegistry(baseConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(baseConfig, registry, tracker);

    // Primary flagship fails once with 503, then succeeds on in-place retry
    const req: any = {
      model: 'auto-flagship',
      messages: [{ role: 'user', content: 'Explain distributed consensus algorithms' }],
      __simulate_error_model__: 'primary-flagship',
      __simulate_status__: 503,
      __simulate_message__: 'Temporary upstream 503 gateway blip',
      __simulate_fail_times__: 1,
    };

    const result = await orchestrator.process(req);

    // Verified: Request succeeded on primary-flagship!
    assert.ok(result.response);
    assert.equal(result.modelUsed, 'primary-flagship');
    assert.equal(result.failoverOccurred, false);
    assert.equal(result.failoverAttempts, 1);
    assert.equal(result.inplaceRetries, 1);

    // Circuit breaker must still be CLOSED because the in-place retry recovered
    const breaker = registry.getCircuitBreakerManager().getBreaker('primary-flagship');
    assert.equal(breaker?.getState(), 'CLOSED');
  });

  it('should skip in-place retry and immediately failover to backup model when inplace.enabled is false', async () => {
    const noInplaceConfig: RouterConfig = {
      ...baseConfig,
      retry: {
        ...baseConfig.retry,
        inplace: {
          enabled: false,
          maxAttempts: 0,
        },
      },
    };

    const registry = new ProviderRegistry(noInplaceConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(noInplaceConfig, registry, tracker);

    const req: any = {
      model: 'auto-flagship',
      messages: [{ role: 'user', content: 'Explain Paxos' }],
      __simulate_error_model__: 'primary-flagship',
      __simulate_status__: 503,
      __simulate_fail_times__: 1,
    };

    const result = await orchestrator.process(req);

    // Because inplace is disabled, it immediately fails over to secondary-flagship
    assert.equal(result.modelUsed, 'secondary-flagship');
    assert.equal(result.failoverOccurred, true);
    assert.equal(result.failoverAttempts, 2);
    assert.equal(result.inplaceRetries, 0);
  });

  it('should immediately bypass in-place retry on 402 Quota Exhausted and failover with 0 wasted retries', async () => {
    const registry = new ProviderRegistry(baseConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(baseConfig, registry, tracker);

    const req: any = {
      model: 'auto-flagship',
      messages: [{ role: 'user', content: 'Explain Raft' }],
      __simulate_error_model__: 'primary-flagship',
      __simulate_status__: 402,
      __simulate_message__: 'insufficient_quota: account balance is 0',
    };

    const result = await orchestrator.process(req);

    // Verified: Bypassed in-place retry, switched immediately to backup
    assert.equal(result.modelUsed, 'secondary-flagship');
    assert.equal(result.failoverOccurred, true);
    assert.equal(result.failoverAttempts, 2);
    assert.equal(result.inplaceRetries, 0);

    // Primary breaker must be hard-tripped into OPEN
    const breaker = registry.getCircuitBreakerManager().getBreaker('primary-flagship');
    assert.equal(breaker?.getState(), 'OPEN');
    assert.equal(breaker?.getSnapshot().category, 'QUOTA_EXHAUSTED');
  });

  it('should abort immediately on non-retriable 400 client error without retries or failover', async () => {
    const registry = new ProviderRegistry(baseConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(baseConfig, registry, tracker);

    const req: any = {
      model: 'auto-flagship',
      messages: [{ role: 'user', content: 'Super massive prompt' }],
      __simulate_error_model__: 'primary-flagship',
      __simulate_status__: 400,
      __simulate_message__: 'context_length_exceeded: prompt exceeds max 128k',
    };

    await assert.rejects(async () => {
      await orchestrator.process(req);
    }, (err: any) => {
      assert.ok(err.message.includes('context_length_exceeded') || err.message.includes('400'));
      return true;
    });

    // Primary breaker must NOT be tripped on client input error
    const breaker = registry.getCircuitBreakerManager().getBreaker('primary-flagship');
    assert.equal(breaker?.getState(), 'CLOSED');
  });
});

describe('Resilience: Hierarchical Failover & Tier Crossing Policies (ADR-0009)', () => {
  const crossTierConfig: RouterConfig = {
    port: 3000,
    host: '127.0.0.1',
    baselineModel: 'flagship-1',
    fallback: {
      enabled: false,
      maxRetries: 1,
      escalateTier: 'flagship',
      injectErrorContext: false,
    },
    budget: {
      defaultReasoningEffort: 'low',
      enforceReasoningEffortOnMediumTasks: false,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 1,
    },
    retry: {
      enabled: true,
      inplace: {
        enabled: true,
        maxAttempts: 1,
        backoffMs: 10,
        jitterMs: 5,
      },
      failover: {
        enabled: true,
        maxAttempts: 3,
        tierCrossPolicy: 'allow_escalate',
      },
    },
    models: [
      {
        id: 'fast-1',
        provider: 'mock',
        upstreamModel: 'fast-1',
        tier: 'fast',
        priority: 1,
        isDefaultInTier: true,
        pricing: { input: 0.15, cacheRead: 0.015, output: 0.6 },
      },
      {
        id: 'fast-2',
        provider: 'mock',
        upstreamModel: 'fast-2',
        tier: 'fast',
        priority: 2,
        pricing: { input: 0.15, cacheRead: 0.015, output: 0.6 },
      },
      {
        id: 'flagship-1',
        provider: 'mock',
        upstreamModel: 'flagship-1',
        tier: 'flagship',
        priority: 1,
        isDefaultInTier: true,
        pricing: { input: 3.0, cacheRead: 0.3, output: 15.0 },
      },
    ],
  };

  it('should escalate from fast to flagship when all fast candidates fail under allow_escalate policy', async () => {
    const registry = new ProviderRegistry(crossTierConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(crossTierConfig, registry, tracker);

    // Trip both fast-1 and fast-2 to simulate total outage in Fast Tier
    registry.getCircuitBreakerManager().getBreaker('fast-1')?.trip('503 outage', 'SERVICE_UNAVAILABLE', 3600000);
    registry.getCircuitBreakerManager().getBreaker('fast-2')?.trip('503 outage', 'SERVICE_UNAVAILABLE', 3600000);

    const req: any = {
      model: 'auto-fast',
      messages: [{ role: 'user', content: 'Quick greeting' }],
    };

    const result = await orchestrator.process(req);

    // Under allow_escalate, should escalate up to flagship-1 to preserve user uptime!
    assert.equal(result.tierUsed, 'flagship');
    assert.equal(result.modelUsed, 'flagship-1');
  });

  it('should refuse to cross tiers and fail cleanly when tierCrossPolicy is same_tier_only', async () => {
    const strictConfig: RouterConfig = {
      ...crossTierConfig,
      retry: {
        ...crossTierConfig.retry,
        failover: {
          enabled: true,
          maxAttempts: 3,
          tierCrossPolicy: 'same_tier_only',
        },
      },
    };

    const registry = new ProviderRegistry(strictConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(strictConfig, registry, tracker);

    // Both fast models fail
    const req: any = {
      model: 'auto-fast',
      messages: [{ role: 'user', content: 'Batch task' }],
      __simulate_error_all__: true,
      __simulate_status__: 503,
    };

    await assert.rejects(async () => {
      await orchestrator.process(req);
    }, (err: any) => {
      assert.ok(err.message.includes('fast') || err.message.includes('503'));
      return true;
    });
  });

  it('should enforce Strict Anti-Downgrade: Flagship requests must NEVER downgrade to fast tier', async () => {
    const registry = new ProviderRegistry(crossTierConfig, true);
    const tracker = new FinOpsTracker();
    const orchestrator = new PipelineOrchestrator(crossTierConfig, registry, tracker);

    // Trip flagship-1
    registry.getCircuitBreakerManager().getBreaker('flagship-1')?.trip('Flagship down', 'SERVICE_UNAVAILABLE', 3600000);

    const req: any = {
      model: 'auto-flagship',
      messages: [{ role: 'user', content: 'Critical architecture design' }],
      __simulate_error_model__: 'flagship-1',
      __simulate_status__: 503,
    };

    // Must NOT downgrade to fast-1; should fail instead of degrading code intelligence
    await assert.rejects(async () => {
      await orchestrator.process(req);
    });
  });
});

describe('Resilience: End-to-End HTTP Headers & Observability', () => {
  const e2eConfig: RouterConfig = {
    port: 3000,
    host: '127.0.0.1',
    baselineModel: 'primary-model',
    fallback: {
      enabled: false,
      maxRetries: 1,
      escalateTier: 'flagship',
      injectErrorContext: false,
    },
    budget: {
      defaultReasoningEffort: 'low',
      enforceReasoningEffortOnMediumTasks: false,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2,
    },
    retry: {
      enabled: true,
      inplace: {
        enabled: true,
        maxAttempts: 1,
        backoffMs: 10,
        jitterMs: 5,
      },
      failover: {
        enabled: true,
        maxAttempts: 2,
        tierCrossPolicy: 'allow_escalate',
      },
    },
    models: [
      {
        id: 'primary-model',
        provider: 'mock',
        upstreamModel: 'primary-model',
        tier: 'flagship',
        priority: 1,
        isDefaultInTier: true,
        pricing: { input: 3.0, cacheRead: 0.3, output: 15.0 },
      },
    ],
  };

  it('POST /v1/chat/completions should attach X-OCR-InPlace-Retries and X-OCR-Failover headers', async () => {
    const { app } = createServer(e2eConfig, true);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is 42?' }],
        __simulate_error_model__: 'primary-model',
        __simulate_status__: 503,
        __simulate_fail_times__: 1,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-ocr-model'], 'primary-model');
    assert.equal(res.headers['x-ocr-inplace-retries'], '1');
    assert.equal(res.headers['x-ocr-failover'], 'false');
    assert.equal(res.headers['x-ocr-failover-attempts'], '1');
    assert.equal(res.headers['x-ocr-breaker-state'], 'CLOSED');
  });
});
