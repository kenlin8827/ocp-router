import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listOpenCodeProviders,
  listConfigProviders,
  upsertCustomProvider,
  deleteCustomProvider,
  getProviderNodeById,
  setAuthApiKey,
  removeAuthEntry,
  readAuthEntries,
  maskSecret,
  expandEnvTemplate,
  getOpenCodeConfigPath,
  getOpenCodeAuthPath,
} from '../src/opencode/user-config.js';

describe('OpenCode user-config (opencode.jsonc provider node + auth.json)', () => {
  let tmpDir: string;
  let oldConfigHome: string | undefined;
  let oldDataHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-userconfig-'));
    oldConfigHome = process.env.XDG_CONFIG_HOME;
    oldDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
  });

  afterEach(() => {
    if (oldConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfigHome;
    if (oldDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = oldDataHome;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should create config file with provider node when missing', () => {
    const result = upsertCustomProvider({
      id: 'home-lab',
      name: 'Home Lab',
      baseURL: 'http://192.168.1.10:20180/v1',
      apiKey: 'sk-test-1234567890',
    });
    expect(result.success).toBe(true);

    const configPath = getOpenCodeConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.provider['home-lab'].npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider['home-lab'].options.baseURL).toBe('http://192.168.1.10:20180/v1');

    // Key went to auth.json, NOT into the jsonc
    expect(parsed.provider['home-lab'].options.apiKey).toBeUndefined();
    const auth = JSON.parse(fs.readFileSync(getOpenCodeAuthPath(), 'utf8'));
    expect(auth['home-lab']).toEqual({ type: 'api', key: 'sk-test-1234567890' });
  });

  it('must preserve JSONC comments when upserting and deleting providers', () => {
    const configPath = getOpenCodeConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        '{',
        '  // Top comment: keep me!',
        '  "model": "zhipuai-coding-plan/glm-5.3-flash",',
        '  "provider": {',
        '    // headroom proxy, tuned by hand',
        '    "headroom": {',
        '      "npm": "@ai-sdk/openai-compatible",',
        '      "options": { "baseURL": "http://127.0.0.1:8787/v1", "apiKey": "{env:VOLC_CODING_KEY}" }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'utf8'
    );

    const result = upsertCustomProvider({ id: 'maisuitx', baseURL: 'http://192.168.18.10:20180/v1' });
    expect(result.success).toBe(true);

    let raw = fs.readFileSync(configPath, 'utf8');
    expect(raw).toContain('// Top comment: keep me!');
    expect(raw).toContain('// headroom proxy, tuned by hand');
    expect(raw).toContain('{env:VOLC_CODING_KEY}');

    let parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    expect(parsed.provider.headroom.options.baseURL).toBe('http://127.0.0.1:8787/v1');
    expect(parsed.provider.maisuitx.options.baseURL).toBe('http://192.168.18.10:20180/v1');
    expect(parsed.model).toBe('zhipuai-coding-plan/glm-5.3-flash');

    // Delete keeps comments and siblings intact
    const del = deleteCustomProvider('maisuitx');
    expect(del.success).toBe(true);
    raw = fs.readFileSync(configPath, 'utf8');
    expect(raw).toContain('// headroom proxy, tuned by hand');
    parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    expect(parsed.provider.maisuitx).toBeUndefined();
    expect(parsed.provider.headroom).toBeDefined();
  });

  it('should support inline api key with {env:VAR} templates', () => {
    process.env['OCR_TEST_PROVIDER_KEY'] = 'sk-from-env-9876543210';
    const result = upsertCustomProvider({
      id: 'inline',
      baseURL: 'http://10.0.0.1/v1',
      apiKey: '{env:OCR_TEST_PROVIDER_KEY}',
      apiKeyInline: true,
    });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(getOpenCodeConfigPath(), 'utf8'));
    expect(parsed.provider.inline.options.apiKey).toBe('{env:OCR_TEST_PROVIDER_KEY}');
    const auth = readAuthEntries();
    expect(auth['inline']).toBeUndefined();

    const view = listConfigProviders().find((p) => p.id === 'inline');
    expect(view?.auth.connected).toBe(true);
    expect(view?.auth.keyMasked).toBe('sk-f••••3210');
    delete process.env['OCR_TEST_PROVIDER_KEY'];
  });

  it('should merge config providers and auth credentials into a safe view', () => {
    fs.mkdirSync(path.dirname(getOpenCodeConfigPath()), { recursive: true });
    fs.writeFileSync(
      getOpenCodeConfigPath(),
      JSON.stringify({ provider: { deepseek: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://api.deepseek.com/v1' } } } }),
      'utf8'
    );
    setAuthApiKey('deepseek', 'sk-fake-deepseek-0000000042');
    setAuthApiKey('kimi-for-coding', 'sk-fake-kimi-00000000xyz');

    const providers = listOpenCodeProviders();
    const deepseek = providers.find((p) => p.id === 'deepseek');
    expect(deepseek?.auth.connected).toBe(true);
    expect(deepseek?.auth.keyMasked).toBe('sk-f••••0042');
    expect(deepseek?.baseURL).toBe('https://api.deepseek.com/v1');

    const kimi = providers.find((p) => p.id === 'kimi-for-coding');
    expect(kimi?.custom).toBe(false); // credential-only
    expect(kimi?.auth.keyMasked).toBe('sk-f••••0xyz');

    // No raw secrets anywhere in the view
    expect(JSON.stringify(providers)).not.toContain('sk-fake-deepseek-0000000042');
    expect(JSON.stringify(providers)).not.toContain('sk-fake-kimi-00000000');
  });

  it('should reject invalid provider ids and remove auth entries', () => {
    const bad = upsertCustomProvider({ id: '../evil', baseURL: 'http://x/v1' });
    expect(bad.success).toBe(false);

    setAuthApiKey('temp', 'sk-temp-1234567890abc');
    expect(readAuthEntries()['temp']).toBeDefined();
    removeAuthEntry('temp');
    expect(readAuthEntries()['temp']).toBeUndefined();

    const missing = deleteCustomProvider('does-not-exist');
    expect(missing.success).toBe(false);
    expect(getProviderNodeById('does-not-exist')).toBeUndefined();
  });

  it('should mask secrets and expand env templates', () => {
    expect(maskSecret(undefined)).toBe('');
    expect(maskSecret('short')).toBe('sh••••');
    expect(maskSecret('sk-very-long-secret-key-xyz')).toBe('sk-v••••-xyz');

    process.env.OCR_TEMPLATE_TEST = 'expanded';
    expect(expandEnvTemplate('{env:OCR_TEMPLATE_TEST}')).toBe('expanded');
    expect(expandEnvTemplate('{env:NOT_SET_ANYWHERE_XYZ}')).toBe('');
    expect(expandEnvTemplate('plain-key')).toBe('plain-key');
  });
});
