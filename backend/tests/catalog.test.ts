import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModelsDev, modelsDevLogoUrl } from '../src/opencode/catalog/sources/models-dev.js';
import { normalizeOpenRouter, OPENROUTER_PROVIDER_ID } from '../src/opencode/catalog/sources/openrouter.js';
import { mergeModels } from '../src/opencode/catalog/repository.js';
import { readCacheFile, writeCacheFile } from '../src/opencode/catalog/cache.js';
import { isAllowedLogoUrl, localLogoApiPath, getLogoCached, writeLogoCache } from '../src/opencode/catalog/logos.js';
import { resolveSources, parseByType, normalizeOpenAICompatible } from '../src/opencode/catalog/sources/registry.js';
import type { CatalogModel } from '../src/opencode/catalog/types.js';

describe('Catalog sources & repository', () => {
  let tmpDir: string;
  let oldCacheHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-catalog-'));
    oldCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = tmpDir;
  });

  afterEach(() => {
    if (oldCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = oldCacheHome;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('normalizes models.dev providers into the OpenCode schema (identity passthrough)', () => {
    const records = normalizeModelsDev({
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        npm: '@ai-sdk/anthropic',
        api: 'https://api.anthropic.com/v1',
        env: ['ANTHROPIC_API_KEY'],
        models: {
          'claude-haiku': {
            name: 'Claude Haiku',
            reasoning: true,
            tool_call: true,
            limit: { context: 200000, output: 64000 },
            cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
          },
        },
      },
      broken: null,
    });

    expect(records.length).toBe(1);
    const a = records[0];
    expect(a.id).toBe('anthropic');
    expect(a.logo).toBe('https://models.dev/logos/anthropic.svg');
    const m = a.models[0];
    expect(m.source).toBe('builtin');
    expect(m.tool_call).toBe(true);
    expect(m.reasoning).toBe(true);
    expect(m.limit).toEqual({ context: 200000, output: 64000 });
    expect(m.cost).toEqual({ input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 });
    expect(modelsDevLogoUrl('deepseek')).toBe('https://models.dev/logos/deepseek.svg');
  });

  it('normalizes OpenRouter models converting $/token pricing to $/1M', () => {
    const models = normalizeOpenRouter({
      data: [
        {
          id: 'openai/gpt-4o',
          name: 'OpenAI: GPT-4o',
          context_length: 128000,
          pricing: { prompt: '0.0000025', completion: '0.00001', input_cache_read: '0.00000125' },
          top_provider: { max_completion_tokens: 16384 },
          supported_parameters: ['tools', 'temperature'],
        },
        {
          id: 'deepseek/deepseek-r1',
          name: 'DeepSeek: R1',
          pricing: { prompt: '0.0000005', completion: '0.000002' },
          supported_parameters: ['reasoning', 'tools'],
        },
        { no_id: true },
      ],
    });

    expect(models.length).toBe(2);
    const gpt = models[0];
    expect(gpt.cost?.input).toBeCloseTo(2.5, 6); // $/1M
    expect(gpt.cost?.output).toBeCloseTo(10, 6);
    expect(gpt.cost?.cache_read).toBeCloseTo(1.25, 6);
    expect(gpt.limit?.context).toBe(128000);
    expect(gpt.limit?.output).toBe(16384);
    expect(gpt.tool_call).toBe(true);
    expect(gpt.reasoning).toBeUndefined();
    expect(models[1].reasoning).toBe(true);
  });

  it('merges model lists fill-missing-only: first non-blank value wins, source kept', () => {
    const first: CatalogModel[] = [
      { id: 'a', name: 'A', reasoning: true, cost: { input: 1 }, limit: { context: 200000 }, source: 'config' },
      { id: 'b', name: 'B', source: 'config' },
    ];
    const later: CatalogModel[] = [
      { id: 'a', name: 'A-override-ignored', cost: { input: 99, output: 9 }, limit: { context: 1, output: 8192 }, source: 'openrouter' },
      { id: 'c', name: 'C', source: 'openrouter' },
    ];
    const merged = mergeModels(first, later);
    expect(merged.length).toBe(3);
    const a = merged.find((m) => m.id === 'a');
    expect(a?.name).toBe('A'); // first non-blank wins — later sources never overwrite
    expect(a?.source).toBe('config'); // creating source kept
    expect(a?.cost?.input).toBe(1); // non-blank kept
    expect(a?.cost?.output).toBe(9); // blank filled from later source
    expect(a?.limit?.context).toBe(200000); // kept
    expect(a?.limit?.output).toBe(8192); // filled
    expect(merged.find((m) => m.id === 'b')?.name).toBe('B');
    expect(merged.find((m) => m.id === 'c')?.source).toBe('openrouter');
  });

  it('treats 0 and empty containers as unset (fillable by later sources)', () => {
    const merged = mergeModels(
      [{ id: 'x', cost: { input: 0 }, limit: {}, source: 'config' }],
      [{ id: 'x', cost: { input: 5 }, limit: { context: 4096 }, source: 'openrouter' }]
    );
    expect(merged[0].cost?.input).toBe(5); // zero → fillable
    expect(merged[0].limit?.context).toBe(4096); // empty container → fillable
  });

  it('caches catalog payloads to disk (round-trip + stale-on-error)', () => {
    writeCacheFile('unit-test-src', [{ hello: 'world' }]);
    const read = readCacheFile<any[]>('unit-test-src');
    expect(read?.fetchedAt).toBeGreaterThan(0);
    expect(read?.data[0].hello).toBe('world');
    expect(readCacheFile('missing-src')).toBeNull();
  });

  it('openrouter provider id is stable', () => {
    expect(OPENROUTER_PROVIDER_ID).toBe('openrouter');
  });

  it('resolveSources falls back to defaults with builtin as the baseline (first)', () => {
    const defaults = resolveSources(undefined);
    expect(defaults.map((s) => s.id)).toEqual(['builtin', 'openrouter']); // priority ascending
    expect(defaults[0].priority).toBeLessThan(defaults[1].priority);

    // config override replaces the whole list; disabled entries are dropped
    const custom = resolveSources([
      { id: 'relay', type: 'openai-compatible', url: 'http://x/v1/models', priority: 10 },
      { id: 'off', type: 'model-list', url: 'https://y', enabled: false },
    ]);
    expect(custom.map((s) => s.id)).toEqual(['relay']);
  });

  it('parseByType dispatches to the registered normalizer', () => {
    const providers = parseByType('provider-catalog', { anthropic: { name: 'Anthropic', models: {} } });
    expect(providers?.providers?.[0].id).toBe('anthropic');

    const models = parseByType('model-list', { data: [{ id: 'openai/gpt-4o', pricing: { prompt: '0.0000025' } }] });
    expect(models?.models?.[0].cost?.input).toBeCloseTo(2.5, 6);

    const oc = parseByType('openai-compatible', { data: [{ id: 'glm-5.3-flash', context_length: 200000 }] });
    expect(oc?.models?.[0].id).toBe('glm-5.3-flash');
    expect(oc?.models?.[0].limit?.context).toBe(200000);

    expect(parseByType('nope' as any, {})).toBeNull();
  });

  it('normalizeOpenAICompatible accepts bare /v1/models payloads', () => {
    const models = normalizeOpenAICompatible({
      object: 'list',
      data: [{ id: 'model-a' }, { id: 'model-b', name: 'Model B', max_model_len: 8192 }, {}],
    });
    expect(models.length).toBe(2);
    expect(models[1].limit?.context).toBe(8192);
  });

  it('logo proxy path allow-lists hosts and passes unknown URLs through', () => {
    const md = modelsDevLogoUrl('anthropic');
    expect(isAllowedLogoUrl(md)).toBe(true);
    expect(isAllowedLogoUrl('https://openrouter.ai/brand/v2/openrouter-glyph-light.svg')).toBe(true);
    expect(localLogoApiPath(md)).toBe(`/api/console/catalog/logo?url=${encodeURIComponent(md)}`);
    expect(localLogoApiPath(undefined)).toBeUndefined();

    expect(isAllowedLogoUrl('https://evil.example/logo.svg')).toBe(false);
    expect(isAllowedLogoUrl('http://models.dev/logos/a.svg')).toBe(false); // https only
    expect(localLogoApiPath('https://evil.example/logo.svg')).toBe('https://evil.example/logo.svg');
  });

  it('serves logos from the disk cache without touching the network', async () => {
    const url = modelsDevLogoUrl('unit-test-logo');
    writeLogoCache(url, {
      fetchedAt: Date.now(), // fresh → no fetch attempted
      contentType: 'image/svg+xml',
      base64: Buffer.from('<svg/>').toString('base64'),
    });
    const out = await getLogoCached(url);
    expect(out?.contentType).toBe('image/svg+xml');
    expect(out?.body.toString('utf8')).toBe('<svg/>');

    // non-allow-listed URLs are rejected outright
    expect(await getLogoCached('https://evil.example/logo.svg')).toBeNull();
    expect(await getLogoCached(undefined)).toBeNull();
  });
});
