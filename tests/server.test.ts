import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/index.js';
import { createServer } from '../src/server.js';

describe('Fastify Gateway Server & OpenAI Endpoints', () => {
  const config = loadConfig();
  const { app } = createServer(config, true); // mockMode = true

  it('GET /health should return 200 and healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.modelsRegistered > 0);
  });

  it('GET /v1/models should return virtual cascading models (auto) and physical models', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.object, 'list');
    const ids = body.data.map((m: any) => m.id);
    assert.ok(ids.includes('auto'), 'Expected virtual "auto" model');
    assert.ok(ids.includes('cascading-auto'));
    assert.ok(ids.includes('tier1-fast'));
    assert.ok(ids.includes('tier2-flagship'));
    assert.ok(ids.includes('tier3-reasoning'));
  });

  it('GET /v1/models/:model should return single model definition', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models/auto',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.id, 'auto');
    assert.strictEqual(body.object, 'model');
  });

  it('POST /v1/chat/completions with model="auto" should auto-route and attach FinOps headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'auto',
        messages: [{ role: 'user', content: 'What is the speed of light?' }],
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(['tier1', 'tier2'].includes(res.headers['x-ocp-router-tier'] as string));
    assert.ok(res.headers['x-ocp-router-session-id']);
    assert.ok(res.headers['x-ocp-router-cost-usd']);
    assert.ok(res.headers['x-ocp-router-saved-usd']);
    // Backward compatibility check
    assert.ok(['tier1', 'tier2'].includes(res.headers['x-llm-router-tier'] as string));

    const body = JSON.parse(res.body);
    assert.strictEqual(body.object, 'chat.completion');
    assert.ok(body.choices.length > 0);
  });

  it('POST /v1/chat/completions with stream=true should stream Server-Sent Events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'auto',
        stream: true,
        messages: [{ role: 'user', content: 'Say hello in streaming mode' }],
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/event-stream'));
    assert.ok(res.body.includes('data: {"id":'));
    assert.ok(res.body.includes('chat.completion.chunk'));
    assert.ok(res.body.includes('data: [DONE]'));
  });

  it('GET /v1/metrics should expose FinOps economics summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
    });

    assert.strictEqual(res.statusCode, 200);
    const metrics = JSON.parse(res.body);
    assert.ok(metrics.totalRequests >= 2);
    assert.ok(metrics.economics.totalSavingsUsd >= 0);
  });
});
