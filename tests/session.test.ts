import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session/session-manager.js';
import { ChatCompletionRequest } from '../src/types/openai.js';
import { RoutingDecision, TierLevel, TierModelConfig } from '../src/types/router.js';

describe('Monotonic Session Ratchet & Zero-Header Fingerprinting', () => {
  let sessionManager: SessionManager;

  const mockModelFinder = (tier: TierLevel): TierModelConfig => ({
    id: `mock-${tier}-model`,
    provider: `provider-${tier}`,
    realModel: `real-${tier}`,
    pricing: { input: 1, cacheRead: 0.1, output: 2 },
    supportsStreaming: true,
    supportsTools: true,
    supportsJsonSchema: true,
  });

  beforeEach(() => {
    sessionManager = new SessionManager({ enabled: true, strategy: 'monotonic' });
  });

  it('should track conversation across turns using Prefix Chain hash without any headers', () => {
    // Turn 1
    const req1: ChatCompletionRequest = {
      model: 'auto',
      messages: [{ role: 'user', content: 'What is the speed of light?' }],
    };

    const resolve1 = sessionManager.resolveSessionId(req1, '192.168.1.100');
    assert.strictEqual(resolve1.lookupType, 'root_anchor');
    const sessionId1 = resolve1.sessionId;
    assert.ok(sessionId1.startsWith('sess_'));

    // Turn 1 completes with assistant reply
    const assistantReply1 = 'The speed of light in vacuum is approximately 299,792,458 meters per second.';
    sessionManager.registerCompletedTurn(sessionId1, req1.messages, assistantReply1);

    // Turn 2 (Client sends full conversation history, NO headers)
    const req2: ChatCompletionRequest = {
      model: 'auto',
      messages: [
        { role: 'user', content: 'What is the speed of light?' },
        { role: 'assistant', content: assistantReply1 },
        { role: 'user', content: 'And in miles per second?' },
      ],
    };

    const resolve2 = sessionManager.resolveSessionId(req2, '192.168.1.100');
    assert.strictEqual(resolve2.lookupType, 'prefix_chain', 'Should locate session via prefix chain hash of prior turn');
    assert.strictEqual(resolve2.sessionId, sessionId1, 'Session ID must match across turns');
  });

  it('should enforce Monotonic Ratchet: allow escalation, block downgrade, and preserve pinned model', () => {
    const sessionId = 'test-session-ratchet-1';

    // Turn 1: Simple greeting -> fast
    const decisionTurn1: RoutingDecision = {
      targetTier: 'fast',
      confidence: 0.95,
      reason: 'Simple greeting',
      needsSchemaValidation: false,
      features: {
        tokenCountEstimate: 5,
        hasCode: false,
        hasMathOrProof: false,
        hasMultiTurn: false,
        hasToolsOrSchema: false,
        complexityScore: 1.0,
      },
    };

    const r1 = sessionManager.applyRatchet(sessionId, decisionTurn1, mockModelFinder);
    assert.strictEqual(r1.finalDecision.targetTier, 'fast');
    assert.strictEqual(r1.session.pinnedModel, 'mock-fast-model');
    assert.strictEqual(r1.ratchetApplied, false);

    // Turn 2: Complex architecture task -> flagship (Escalation triggered!)
    const decisionTurn2: RoutingDecision = {
      targetTier: 'flagship',
      confidence: 0.90,
      reason: 'Complex distributed system refactoring',
      needsSchemaValidation: false,
      features: {
        tokenCountEstimate: 800,
        hasCode: true,
        hasMathOrProof: false,
        hasMultiTurn: true,
        hasToolsOrSchema: false,
        complexityScore: 6.0,
      },
    };

    const r2 = sessionManager.applyRatchet(sessionId, decisionTurn2, mockModelFinder);
    assert.strictEqual(r2.finalDecision.targetTier, 'flagship', 'Should allow upward escalation to flagship');
    assert.strictEqual(r2.session.maxTier, 'flagship');
    assert.strictEqual(r2.session.pinnedModel, 'mock-flagship-model');
    assert.strictEqual(r2.ratchetApplied, true);

    // Turn 3: User says short follow-up "OK thanks" -> classified in isolation as fast
    // Monotonic Ratchet must BLOCK downgrade to fast and keep flagship with pinned model!
    const decisionTurn3: RoutingDecision = {
      targetTier: 'fast',
      confidence: 0.92,
      reason: 'Casual gratitude',
      needsSchemaValidation: false,
      features: {
        tokenCountEstimate: 3,
        hasCode: false,
        hasMathOrProof: false,
        hasMultiTurn: true,
        hasToolsOrSchema: false,
        complexityScore: 1.0,
      },
    };

    const r3 = sessionManager.applyRatchet(sessionId, decisionTurn3, mockModelFinder);
    assert.strictEqual(r3.finalDecision.targetTier, 'flagship', 'Downgrade must be blocked! Locked to flagship quality');
    assert.strictEqual(r3.session.pinnedModel, 'mock-flagship-model', 'Must reuse pinned model to guarantee 100% KV cache hit');
    assert.strictEqual(r3.ratchetApplied, true, 'Ratchet applied flag must be true');
    assert.ok(r3.finalDecision.reason.includes('Monotonic Ratchet'));
  });

  it('should respect explicit session headers when provided by client', () => {
    const req: ChatCompletionRequest = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Anything' }],
    };

    // Client passes custom header
    const resolve = sessionManager.resolveSessionId(req, '127.0.0.1', {
      'x-session-id': 'custom-enterprise-session-888',
    });

    assert.strictEqual(resolve.lookupType, 'explicit_header');
    assert.strictEqual(resolve.sessionId, 'custom-enterprise-session-888');
  });

  it('should support OpenAI native request.user field as session identity', () => {
    const req: ChatCompletionRequest = {
      model: 'auto',
      messages: [{ role: 'user', content: 'Anything' }],
      user: 'openai-user-guid-999',
    };

    const resolve = sessionManager.resolveSessionId(req, '127.0.0.1');
    assert.strictEqual(resolve.lookupType, 'request_user');
    assert.strictEqual(resolve.sessionId, 'openai-user-guid-999');
  });
});
