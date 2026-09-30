import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModelsDev, modelsDevLogoUrl } from '../src/opencode/catalog/sources/models-dev.js';
import { normalizeOpenRouter, OPENROUTER_PROVIDER_ID } from '../src/opencode/catalog/sources/openrouter.js';
import { mergeModels } from '../src/opencode/catalog/repository.js';
import { readCacheFile, writeCacheFile } from '../src/opencode/catalog/cache.js';
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

  it('normalizes models.dev providers with $/1M pricing and logo urls', () => {
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
    expect(a.logoUrl).toBe('https://models.dev/logos/anthropic.svg');
    expect(a.models[0].pricing).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
    expect(a.models[0].contextLimit).toBe(200000);
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
    expect(gpt.pricing?.input).toBeCloseTo(2.5, 6); // $/1M
    expect(gpt.pricing?.output).toBeCloseTo(10, 6);
    expect(gpt.pricing?.cacheRead).toBeCloseTo(1.25, 6);
    expect(gpt.contextLimit).toBe(128000);
    expect(gpt.outputLimit).toBe(16384);
    expect(gpt.toolCall).toBe(true);
    expect(gpt.reasoning).toBeUndefined();
    expect(models[1].reasoning).toBe(true);
  });

  it('merges model lists with overlay precedence', () => {
    const dev: CatalogModel[] = [
      { id: 'a', name: 'A', pricing: { input: 1 }, source: 'models-dev' },
      { id: 'b', name: 'B', source: 'models-dev' },
    ];
    const cfg: CatalogModel[] = [
      { id: 'a', name: 'A-custom', source: 'config' },
      { id: 'c', name: 'C', source: 'config' },
    ];
    const merged = mergeModels(dev, cfg);
    expect(merged.length).toBe(3);
    const a = merged.find((m) => m.id === 'a');
    expect(a?.name).toBe('A-custom');
    expect(a?.source).toBe('config');
    expect(a?.pricing?.input).toBe(1); // kept from base
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

  it('resolveSources falls back to built-in defaults when config is empty', () => {
    const defaults = resolveSources(undefined);
    expect(defaults.map((s) => s.id)).toEqual(['openrouter', 'models-dev']); // priority ascending
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
    expect(models?.models?.[0].pricing?.input).toBeCloseTo(2.5, 6);

    const oc = parseByType('openai-compatible', { data: [{ id: 'glm-5.3-flash', context_length: 200000 }] });
    expect(oc?.models?.[0].id).toBe('glm-5.3-flash');
    expect(oc?.models?.[0].contextLimit).toBe(200000);

    expect(parseByType('nope' as any, {})).toBeNull();
  });

  it('normalizeOpenAICompatible accepts bare /v1/models payloads', () => {
    const models = normalizeOpenAICompatible({
      object: 'list',
      data: [{ id: 'model-a' }, { id: 'model-b', name: 'Model B', max_model_len: 8192 }, {}],
    });
    expect(models.length).toBe(2);
    expect(models[1].contextLimit).toBe(8192);
  });
});
