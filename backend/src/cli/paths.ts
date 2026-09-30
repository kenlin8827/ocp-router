import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function getOcrHomeDir(): string {
  const home = os.homedir();
  const dir = path.join(home, '.opencode-router');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getPidFilePath(): string {
  return path.join(getOcrHomeDir(), 'ocr.pid');
}

export function getLogFilePath(): string {
  return path.join(getOcrHomeDir(), 'ocr.log');
}

export function getInfoFilePath(): string {
  return path.join(getOcrHomeDir(), 'ocr.info.json');
}

export function getDefaultBinDir(): string {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'opencode-router', 'bin');
  }
  return path.join(os.homedir(), '.local', 'bin');
}

export function getRepoRootDir(): string {
  // src/cli/paths.ts -> root is two levels up
  const currentDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return path.resolve(currentDir, '..', '..', '..');
}
