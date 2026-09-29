import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RouterEngine } from '../src/router/index.js';
import { ChatCompletionRequest } from '../src/types/openai.js';
import { CustomRule } from '../src/config/types.js';

describe('Zero-Hardcoding Model-Driven Semantic Router', () => {
  it('should respect client force_tier override', () => {
    const req: ChatCompletionRequest = {
      model: 'cascading-auto',
      messages: [{ role: 'user', content: 'Anything' }],
      router_options: { force_tier: 'tier3' },
    };
    const decision = RouterEngine.route(req);
    assert.strictEqual(decision.targetTier, 'tier3');
    assert.strictEqual(decision.confidence, 1.0);
  });

  it('should evaluate user-configured dynamic domain rules from config.yaml without code hardcoding', () => {
    const customRules: CustomRule[] = [
      {
        name: 'custom_billing_rule',
        pattern: '(billing|invoice|payment|subscription)',
        tier: 'tier2',
        reason: 'User domain-specific rule',
      },
    ];

    const req: ChatCompletionRequest = {
      model: 'cascading-auto',
      messages: [{ role: 'user', content: 'Generate monthly subscription billing report' }],
    };

    const decision = RouterEngine.route(req, customRules);
    assert.strictEqual(decision.targetTier, 'tier2');
    assert.strictEqual(decision.ruleMatched, 'custom_billing_rule');
  });

  it('should detect structured JSON output protocol and enable schema validation for Tier 1 with fallback', () => {
    const req: ChatCompletionRequest = {
      model: 'cascading-auto',
      messages: [{ role: 'user', content: 'Extract contact info and return as JSON.' }],
      response_format: { type: 'json_object' },
    };

    const decision = RouterEngine.route(req);
    assert.strictEqual(decision.needsSchemaValidation, true);
    assert.strictEqual(decision.targetTier, 'tier1', 'Should deploy Tier 1 first for structured tasks (Tier 1 lead)');
  });

  it('should default safely to Tier 2 flagship quality when no model is active, never degrading to Tier 1', () => {
    // Ultra-short query (P=NP?) without local model loaded
    const req1: ChatCompletionRequest = {
      model: 'cascading-auto',
      messages: [{ role: 'user', content: 'P=NP?' }],
    };
    const dec1 = RouterEngine.route(req1);
    assert.strictEqual(dec1.targetTier, 'tier2', 'Must default to Tier 2 quality baseline, never degraded to Tier 1!');

    // Another short query
    const req2: ChatCompletionRequest = {
      model: 'cascading-auto',
      messages: [{ role: 'user', content: 'Compose a sonnet' }],
    };
    const dec2 = RouterEngine.route(req2);
    assert.strictEqual(dec2.targetTier, 'tier2', 'Must default to Tier 2 quality baseline!');
  });
});
