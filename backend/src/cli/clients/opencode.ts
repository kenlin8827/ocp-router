import fs from 'node:fs';
import {
  ClientAdapter,
  createBackup,
  restoreBackup,
  safeReadJson,
  OCR_DEFAULT_PORT,
} from './base.js';
import { ClientHookStatus } from '../types.js';
import {
  ROUTER_PROVIDER_ID,
  getOpenCodeConfigPath,
  patchJsonc,
  readJsonc,
} from '../../opencode/user-config.js';

/**
 * OpenCode client adapter.
 *
 * OpenCode v2 config schema notes:
 *  - Custom/static providers live under the *singular* `provider` node
 *    (NOT `providers`), each entry being an AI SDK provider package binding:
 *      "provider": { "<id>": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": ... }, "models": {...} } }
 *  - The file is JSONC (comments allowed) — every write must be a
 *    comment-preserving text-level edit (see opencode/user-config.ts).
 *  - The default model is selected via the top-level `model` key ("provider/model-id").
 */

/** Sidecar that remembers the user's previous default model across setup/teardown. */
function metaPathFor(configPath: string): string {
  return `${configPath}.ocr-meta.json`;
}

function readMeta(configPath: string): { previousModel?: string } {
  try {
    const p = metaPathFor(configPath);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return {};
}

function writeMeta(configPath: string, meta: { previousModel?: string }): void {
  try {
    fs.writeFileSync(metaPathFor(configPath), JSON.stringify(meta, null, 2), 'utf8');
  } catch {
    // best effort
  }
}

function buildRouterProviderNode(port: number): any {
  const targetUrl = `http://127.0.0.1:${port}/v1`;
  const modelEntry = (label: string) => ({ name: label });
  return {
    npm: '@ai-sdk/openai-compatible',
    name: 'OpenCode Router',
    options: {
      baseURL: targetUrl,
      apiKey: 'ocr-local-token',
    },
    models: {
      auto: modelEntry('Auto (intelligent multi-tier routing)'),
      'auto-fast': modelEntry('Force Fast tier'),
      'auto-flagship': modelEntry('Force Flagship tier'),
      'auto-reasoning': modelEntry('Force Reasoning tier'),
    },
  };
}

export class OpenCodeClientAdapter implements ClientAdapter {
  name = 'opencode' as const;
  displayName = 'OpenCode';

  getConfigPath(): string {
    return getOpenCodeConfigPath();
  }

  getStatus(): ClientHookStatus {
    const configPath = this.getConfigPath();
    const exists = fs.existsSync(configPath);
    const backupExists = fs.existsSync(`${configPath}.bak.ocr`);
    let hooked = false;
    let details = 'Not configured';

    if (exists) {
      // Tolerant JSONC read (comments-safe); fall back to legacy plain-JSON reader.
      const data = readJsonc(configPath) ?? safeReadJson(configPath);
      if (data) {
        const routerEntry = data.provider?.[ROUTER_PROVIDER_ID];
        if (routerEntry?.options?.baseURL) {
          hooked = true;
          details = `Routed to OpenCode Router gateway (${routerEntry.options.baseURL})`;
        } else if (data.providers?.ocr || data.providers?.['opencode-router']) {
          // Legacy (invalid-schema) leftovers from previous adapter versions
          hooked = true;
          details = 'Legacy hook detected (invalid schema) — re-run setup to fix';
        } else {
          details = 'Active with native providers';
        }
      } else {
        details = 'Config file present (unparsed/empty)';
      }
    } else {
      details = 'No OpenCode configuration detected';
    }

    return {
      name: this.name,
      displayName: this.displayName,
      configPath,
      exists,
      hooked,
      backupExists,
      details,
    };
  }

  async setup(options?: { port?: number }): Promise<{ success: boolean; message: string }> {
    const configPath = this.getConfigPath();
    const port = options?.port || OCR_DEFAULT_PORT;

    // 1. Safety backup (single rolling .bak.ocr, restorable via teardown)
    if (fs.existsSync(configPath)) {
      createBackup(configPath);
    }

    // 2. Inject the router provider under the correct singular `provider` node
    //    using a comment-preserving JSONC edit.
    patchJsonc(configPath, ['provider', ROUTER_PROVIDER_ID], buildRouterProviderNode(port));

    // 3. Point the default model at the router (record previous for teardown)
    const current = readJsonc(configPath) || {};
    const previousModel = current?.model;
    if (previousModel && previousModel !== `${ROUTER_PROVIDER_ID}/auto`) {
      writeMeta(configPath, { previousModel });
    }
    patchJsonc(configPath, ['model'], `${ROUTER_PROVIDER_ID}/auto`);

    return {
      success: true,
      message: `OpenCode routed to OCR gateway (http://127.0.0.1:${port}/v1). Backup at ${configPath}.bak.ocr`,
    };
  }

  async teardown(): Promise<{ success: boolean; message: string }> {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return { success: false, message: `Configuration file not found at ${configPath}` };
    }

    // If backup exists, restore it directly (full revert, comments included)
    if (restoreBackup(configPath)) {
      return {
        success: true,
        message: `OpenCode configuration restored from backup (${configPath}.bak.ocr)`,
      };
    }

    // Otherwise surgically remove our provider node + default-model override
    const data = readJsonc(configPath);
    if (!data) {
      return { success: false, message: `Could not parse OpenCode config at ${configPath}` };
    }

    if (data.provider?.[ROUTER_PROVIDER_ID]) {
      patchJsonc(configPath, ['provider', ROUTER_PROVIDER_ID], undefined);
    }

    if (data.model === `${ROUTER_PROVIDER_ID}/auto`) {
      const { previousModel } = readMeta(configPath);
      if (previousModel) {
        patchJsonc(configPath, ['model'], previousModel);
      } else {
        patchJsonc(configPath, ['model'], undefined);
      }
    }

    // Clean legacy invalid-schema leftovers (providers.ocr etc.)
    const legacy = safeReadJson(configPath);
    if (legacy?.providers?.ocr || legacy?.[ 'opencode-router-managed' ]) {
      const cleaned = { ...legacy };
      delete cleaned.providers?.ocr;
      delete cleaned[ 'opencode-router-managed' ];
      if (cleaned._ocr_previous_default !== undefined) {
        if (cleaned._ocr_previous_default) cleaned.defaultProvider = cleaned._ocr_previous_default;
        delete cleaned._ocr_previous_default;
      }
      if (cleaned.defaultProvider === 'ocr') delete cleaned.defaultProvider;
      fs.writeFileSync(configPath, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
    }

    return {
      success: true,
      message: 'OpenCode configuration reverted successfully. OCR gateway decoupled.',
    };
  }
}
