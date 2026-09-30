import fs from 'node:fs';
import path from 'node:path';
import { ClientHookStatus, SupportedClient } from '../types.js';

export const OCR_DEFAULT_PORT = 4000;
export const OCR_DEFAULT_URL = `http://127.0.0.1:${OCR_DEFAULT_PORT}`;
export const OCR_DEFAULT_V1_URL = `${OCR_DEFAULT_URL}/v1`;
export const OCR_WATERMARK = 'opencode-router-managed';

/** Strip json comments (line and block) without external dependency */
export function stripJsonComments(jsonStr: string): string {
  return jsonStr
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1');
}

export function safeReadJson(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const cleaned = stripJsonComments(raw);
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function safeWriteJson(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(data, null, 2) + '\n';
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function createBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak.ocr`;
  try {
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

export function restoreBackup(filePath: string): boolean {
  const backupPath = `${filePath}.bak.ocr`;
  if (!fs.existsSync(backupPath)) return false;
  try {
    fs.copyFileSync(backupPath, filePath);
    fs.unlinkSync(backupPath);
    return true;
  } catch {
    return false;
  }
}

export interface ClientAdapter {
  name: SupportedClient;
  displayName: string;
  getConfigPath(): string;
  getStatus(): ClientHookStatus;
  setup(options?: { port?: number }): Promise<{ success: boolean; message: string }>;
  teardown(): Promise<{ success: boolean; message: string }>;
}
