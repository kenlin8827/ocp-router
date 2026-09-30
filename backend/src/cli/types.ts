export type CliAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'web'
  | 'ui'
  | 'desktop'
  | 'setup'
  | 'teardown'
  | 'install-shims'
  | 'version'
  | 'help';

export type SupportedClient = 'opencode' | 'claude' | 'codex';

export interface CliOptions {
  action: CliAction;
  client?: SupportedClient;
  port?: number;
  host?: string;
  daemon?: boolean;
  force?: boolean;
  verbose?: boolean;
  args: string[];
}

export interface DaemonInfo {
  pid: number;
  port: number;
  host: string;
  startTime: string;
  version: string;
}

export interface ClientHookStatus {
  name: SupportedClient;
  displayName: string;
  configPath: string;
  exists: boolean;
  hooked: boolean;
  backupExists: boolean;
  details: string;
}
