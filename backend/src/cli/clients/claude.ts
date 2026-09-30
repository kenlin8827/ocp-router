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
  OCR_WATERMARK,
} from './base.js';
import { ClientHookStatus } from '../types.js';

export class ClaudeClientAdapter implements ClientAdapter {
  name = 'claude' as const;
  displayName = 'Claude Code / Desktop';

  getConfigPath(): string {
    const home = os.homedir();
    const candidateSettings = path.join(home, '.claude', 'settings.json');
    const candidateClaudeJson = path.join(home, '.claude.json');

    if (fs.existsSync(candidateSettings)) return candidateSettings;
    if (fs.existsSync(candidateClaudeJson)) return candidateClaudeJson;
    return candidateClaudeJson;
  }

  getStatus(): ClientHookStatus {
    const configPath = this.getConfigPath();
    const exists = fs.existsSync(configPath);
    const backupExists = fs.existsSync(`${configPath}.bak.ocr`);
    let hooked = false;
    let details = 'Official Anthropic direct connection';

    if (exists) {
      const data = safeReadJson(configPath);
      if (data) {
        if (
          data[OCR_WATERMARK] ||
          data.env?.ANTHROPIC_BASE_URL?.includes('4000') ||
          data.anthropicBaseUrl?.includes('4000') ||
          data.baseUrl?.includes('4000')
        ) {
          hooked = true;
          details = 'Routed to OpenCode Router gateway (:4000)';
        }
      }
    } else {
      details = 'No Claude configuration file detected';
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
    const targetUrl = `http://127.0.0.1:${port}`;

    let data = safeReadJson(configPath) || {};

    if (fs.existsSync(configPath)) {
      createBackup(configPath);
    }

    if (!data.env || typeof data.env !== 'object') {
      data.env = {};
    }

    // Save previous url if any
    if (data.env.ANTHROPIC_BASE_URL && !data._ocr_previous_base_url) {
      data._ocr_previous_base_url = data.env.ANTHROPIC_BASE_URL;
    }

    data.env.ANTHROPIC_BASE_URL = targetUrl;
    data.anthropicBaseUrl = targetUrl;
    data[OCR_WATERMARK] = true;

    safeWriteJson(configPath, data);

    return {
      success: true,
      message: `Claude configured to route via OCR (${targetUrl}). Backup saved to ${configPath}.bak.ocr`,
    };
  }

  async teardown(): Promise<{ success: boolean; message: string }> {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return { success: false, message: `Configuration file not found at ${configPath}` };
    }

    if (restoreBackup(configPath)) {
      return {
        success: true,
        message: `Claude configuration restored from backup (${configPath}.bak.ocr)`,
      };
    }

    const data = safeReadJson(configPath);
    if (!data) {
      return { success: false, message: `Could not parse Claude config at ${configPath}` };
    }

    if (data._ocr_previous_base_url) {
      if (data.env) data.env.ANTHROPIC_BASE_URL = data._ocr_previous_base_url;
      data.anthropicBaseUrl = data._ocr_previous_base_url;
      delete data._ocr_previous_base_url;
    } else {
      if (data.env?.ANTHROPIC_BASE_URL) delete data.env.ANTHROPIC_BASE_URL;
      if (data.anthropicBaseUrl) delete data.anthropicBaseUrl;
    }

    if (data[OCR_WATERMARK]) {
      delete data[OCR_WATERMARK];
    }

    safeWriteJson(configPath, data);

    return {
      success: true,
      message: `Claude configuration decoupled from OCR. Direct Anthropic routing restored.`,
    };
  }
}
