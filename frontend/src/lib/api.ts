export interface GatewayMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheHitRatio: number;
  totalTokens: number;
  cachedTokens: number;
  costSavingsUsd: number;
  savingsPercentage: number;
  avgLatencyMs: number;
}

export interface ClientStatus {
  name: string;
  displayName: string;
  configPath: string;
  exists: boolean;
  hooked: boolean;
  targetProvider: string;
  backupExists: boolean;
}

export interface BreakerInfo {
  model: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailureTime: number | null;
  cooldownRemainingMs: number;
}

export interface GatewayStatusResponse {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  memoryUsageMb: {
    heapUsed: number;
    rss: number;
  };
  metrics: GatewayMetrics;
  circuitBreakers: {
    total: number;
    openCount: number;
    breakers: BreakerInfo[];
  };
  clients: ClientStatus[];
  budget: {
    monthlyLimitUsd: number;
    currentSpendUsd: number;
    usageRatio: number;
    hardLimitEnforced: boolean;
  };
}

export interface TraceRecord {
  id: string;
  timestamp: string;
  sessionId?: string;
  model: string;
  provider: string;
  status: 'success' | 'fallback' | 'error';
  latencyMs: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUsd?: {
    actual: number;
    baseline: number;
    savings: number;
  };
  cacheHit?: boolean;
}

export interface SessionRecord {
  sessionId: string;
  pinnedModel: string;
  currentTier: number;
  traceCount: number;
  totalTokens: number;
  createdAt: string;
  lastActiveAt: string;
}

export const api = {
  async getStatus(): Promise<GatewayStatusResponse> {
    const res = await fetch('/api/ui/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getConfig(): Promise<any> {
    const res = await fetch('/api/ui/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async saveConfig(config: any): Promise<{ status: string; message: string }> {
    const res = await fetch('/api/ui/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async getRawYaml(): Promise<{ status: string; yaml: string }> {
    const res = await fetch('/api/ui/config/raw');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async saveRawYaml(yaml: string): Promise<{ status: string; message: string }> {
    const res = await fetch('/api/ui/config/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async toggleClient(client: string, action: 'setup' | 'teardown'): Promise<{ status: string; message: string }> {
    const res = await fetch(`/api/ui/client/${client}/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async resetBreakers(): Promise<{ status: string; message?: string }> {
    const res = await fetch('/v1/health/circuit-breakers/reset', { method: 'POST' });
    return res.json();
  },

  async restartGateway(): Promise<{ status: string; message?: string }> {
    const res = await fetch('/api/ui/restart', { method: 'POST' });
    return res.json();
  },

  async getTraces(limit = 50): Promise<{ traces: TraceRecord[] }> {
    const res = await fetch(`/v1/traces?limit=${limit}`);
    if (!res.ok) return { traces: [] };
    return res.json();
  },

  async getSessions(): Promise<{ sessions: SessionRecord[] }> {
    const res = await fetch('/v1/sessions');
    if (!res.ok) return { sessions: [] };
    return res.json();
  },

  async getApiKeys(): Promise<{ status: string; keys: ApiKeyItem[] }> {
    const res = await fetch('/api/ui/api-keys');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async createApiKey(payload: {
    name: string;
    key?: string;
    role?: 'admin' | 'user';
    expiresAt?: string;
    description?: string;
  }): Promise<{ success: boolean; data?: ApiKeyItem; error?: string }> {
    const res = await fetch('/api/ui/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateApiKey(
    id: string,
    updates: Partial<ApiKeyItem>
  ): Promise<{ success: boolean; data?: ApiKeyItem; error?: string }> {
    const res = await fetch(`/api/ui/api-keys/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  },

  async deleteApiKey(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/ui/api-keys/${id}`, { method: 'DELETE' });
    return res.json();
  },
};

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  role?: 'admin' | 'user';
  enabled: boolean;
  createdAt: string;
  expiresAt?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// OpenCode-native provider management (opencode.jsonc `provider` + auth.json)
// ---------------------------------------------------------------------------

export interface OpenCodeProviderView {
  id: string;
  name?: string;
  npm?: string;
  baseURL?: string;
  models: string[];
  custom: boolean;
  logoUrl?: string;
  priceFrom?: number;
  modelsCount?: number;
  auth: {
    connected: boolean;
    type?: 'api' | 'oauth' | 'wellknown';
    keyMasked?: string;
    expires?: number;
    inline?: boolean;
  };
}

export interface OpenCodeCatalogProvider {
  id: string;
  name: string;
  logoUrl?: string;
  npm?: string;
  api?: string;
  baseURL?: string;
  doc?: string;
  env?: string[];
  custom: boolean;
  connected: boolean;
  sources: string[];
  modelCount: number;
  priceFrom?: number;
}

export interface CustomProviderPayload {
  id: string;
  name?: string;
  npm?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyInline?: boolean;
  headers?: Record<string, string>;
  models?: Record<string, any>;
  options?: Record<string, any>;
}

function ocJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    return res
      .json()
      .catch(() => ({}))
      .then((e: any) => {
        throw new Error(e?.error || e?.message || `HTTP ${res.status}`);
      }) as Promise<T>;
  }
  return res.json();
}

export const opencodeApi = {
  async listProviders(): Promise<{
    status: string;
    configPath: string;
    authPath: string;
    providers: OpenCodeProviderView[];
  }> {
    return ocJson(await fetch('/api/ui/opencode/providers'));
  },

  async catalog(refresh = false): Promise<{ status: string; source: string; providers: OpenCodeCatalogProvider[] }> {
    return ocJson(await fetch(`/api/ui/opencode/catalog${refresh ? '?refresh=1' : ''}`));
  },

  async createProvider(payload: CustomProviderPayload): Promise<{ status: string; success: boolean }> {
    return ocJson(
      await fetch('/api/ui/opencode/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
  },

  async updateProvider(id: string, payload: Partial<CustomProviderPayload>): Promise<{ status: string; success: boolean }> {
    return ocJson(
      await fetch(`/api/ui/opencode/providers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
  },

  async connectProvider(id: string, apiKey: string, baseURL?: string): Promise<{ status: string; success: boolean; message?: string }> {
    return ocJson(
      await fetch(`/api/ui/opencode/providers/${encodeURIComponent(id)}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseURL }),
      })
    );
  },

  async deleteProvider(id: string, purgeAuth = false): Promise<{ status: string; success: boolean; message?: string }> {
    return ocJson(
      await fetch(`/api/ui/opencode/providers/${encodeURIComponent(id)}${purgeAuth ? '?purgeAuth=1' : ''}`, {
        method: 'DELETE',
      })
    );
  },
};
