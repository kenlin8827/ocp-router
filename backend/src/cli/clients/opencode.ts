import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  ClientAdapter,
  createBackup,
  restoreBackup,
  safeReadJson,
  safeWriteJson,
  OCR_DEFAULT_PORT,
  OCR_DEFAULT_V1_URL,
  OCR_WATERMARK,
} from './base.js';
import { ClientHookStatus } from '../types.js';

export class OpenCodeClientAdapter implements ClientAdapter {
  name = 'opencode' as const;
  displayName = 'OpenCode';

  getConfigPath(): string {
    const home = os.homedir();
    const candidateJsonc = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    const candidateJson = path.join(home, '.config', 'opencode', 'opencode.json');
    const candidateAlt = path.join(home, '.opencode', 'opencode.json');

    if (fs.existsSync(candidateJsonc)) return candidateJsonc;
    if (fs.existsSync(candidateJson)) return candidateJson;
    if (fs.existsSync(candidateAlt)) return candidateAlt;
    return candidateJson;
  }

  getStatus(): ClientHookStatus {
    const configPath = this.getConfigPath();
    const exists = fs.existsSync(configPath);
    const backupExists = fs.existsSync(`${configPath}.bak.ocr`);
    let hooked = false;
    let details = 'Not configured';

    if (exists) {
      const data = safeReadJson(configPath);
      if (data) {
        if (data.providers?.ocr || data.providers?.['opencode-router'] || data.provider?.baseUrl?.includes('/v1')) {
          hooked = true;
          details = 'Routed to OpenCode Router gateway';
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
    const targetUrl = `http://127.0.0.1:${port}/v1`;

    let data = safeReadJson(configPath) || {};

    // 1. Create safety backup
    if (fs.existsSync(configPath)) {
      createBackup(configPath);
    }

    // 2. Inject OCR provider
    if (!data.providers || typeof data.providers !== 'object') {
      data.providers = {};
    }

    data.providers.ocr = {
      type: 'openai',
      baseUrl: targetUrl,
      apiKey: 'ocr-local-token',
      models: ['auto', 'auto-fast', 'auto-flagship', 'auto-reasoning'],
      [OCR_WATERMARK]: true,
    };

    // Keep previous default provider if wanted, or set ocr
    if (!data._ocr_previous_default) {
      data._ocr_previous_default = data.defaultProvider || null;
    }
    data.defaultProvider = 'ocr';
    data[OCR_WATERMARK] = true;

    safeWriteJson(configPath, data);

    return {
      success: true,
      message: `OpenCode connected to OCR gateway (${targetUrl}). Backup created at ${configPath}.bak.ocr`,
    };
  }

  async teardown(): Promise<{ success: boolean; message: string }> {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return { success: false, message: `Configuration file not found at ${configPath}` };
    }

    // If backup exists, restore it directly
    if (restoreBackup(configPath)) {
      return {
        success: true,
        message: `OpenCode restored from backup (${configPath}.bak.ocr)`,
      };
    }

    // Otherwise cleanly remove OCR entry
    const data = safeReadJson(configPath);
    if (!data) {
      return { success: false, message: `Could not parse OpenCode config at ${configPath}` };
    }

    if (data.providers?.ocr) {
      delete data.providers.ocr;
    }
    if (data[OCR_WATERMARK]) {
      delete data[OCR_WATERMARK];
    }
    if (data._ocr_previous_default) {
      data.defaultProvider = data._ocr_previous_default;
      delete data._ocr_previous_default;
    } else if (data.defaultProvider === 'ocr') {
      delete data.defaultProvider;
    }

    safeWriteJson(configPath, data);

    return {
      success: true,
      message: `OpenCode configuration reverted successfully. OCR gateway decoupled.`,
    };
  }
}
