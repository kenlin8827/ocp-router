import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { getAllClientStatuses, setupClient, teardownClient } from '../cli/clients/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { getRawConfig, loadConfig, saveConfig, saveRawConfig } from '../config/index.js';
import { RouterConfig } from '../config/types.js';
import {
  listApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  validateApiKey,
} from '../auth/api-keys.js';

export { validateApiKey };

export function registerConsoleRoutes(
  app: FastifyInstance,
  registry: ProviderRegistry,
  orchestrator: PipelineOrchestrator
): void {
  const candidateDistDirs = [
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../frontend/dist'),
  ];
  const FRONTEND_DIST = candidateDistDirs.find((p) => fs.existsSync(p)) || path.resolve(process.cwd(), 'frontend/dist');

  // 1. Static Asset Serving from frontend/dist/assets
  app.get('/assets/:file', async (req: any, reply: any) => {
    const file = req.params.file;
    const filePath = path.join(FRONTEND_DIST, 'assets', file);
    if (fs.existsSync(filePath)) {
      if (file.endsWith('.js')) reply.type('application/javascript');
      else if (file.endsWith('.css')) reply.type('text/css');
      else if (file.endsWith('.svg')) reply.type('image/svg+xml');
      else if (file.endsWith('.json')) reply.type('application/json');
      return reply.send(fs.readFileSync(filePath));
    }
    return reply.status(404).send('Not Found');
  });

  // 2. React SPA HTML Handler
  const handleHtml = async (_req: any, reply: any) => {
    const indexHtmlPath = path.join(FRONTEND_DIST, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      return reply.type('text/html').send(fs.readFileSync(indexHtmlPath, 'utf8'));
    }
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>OpenCode Router Gateway Console</title></head>
        <body style="background:#09090b;color:#f4f4f5;font-family:sans-serif;padding:40px;text-align:center;">
          <h2>⚡ OpenCode Router Gateway Console</h2>
          <p style="color:#a1a1aa;">The web console assets have not been built yet.</p>
          <p>Please run <code style="color:#06b6d4;background:rgba(255,255,255,0.1);padding:4px 8px;border-radius:4px;">npm run build:frontend</code> to build the React application.</p>
        </body>
      </html>
    `);
  };

  const SPA_ROUTES = [
    '/',
    '/ui',
    '/dashboard',
    '/chains',
    '/rules',
    '/cache',
    '/keys',
    '/api-keys',
    '/clients',
    '/guardrails',
    '/usage',
    '/settings',
    '/yaml',
  ];

  for (const route of SPA_ROUTES) {
    app.get(route, handleHtml);
  }

  // 3. Status Aggregation API for Console
  const handleStatus = async () => {
    const cbSummary = registry.getCircuitBreakerManager().getSummary();
    const metrics = orchestrator.getTracker().getStats();
    const clients = getAllClientStatuses();
    const config = loadConfig();

    const maskedProviders = (config.providers || []).map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 4)}••••${p.apiKey.slice(-4)}` : '',
      rawKeyConfigured: Boolean(p.apiKey),
    }));

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics,
      circuitBreakers: cbSummary,
      clients,
      providers: maskedProviders,
      registeredModelsCount: registry.getAllModels().length,
    };
  };

  app.get('/api/ui/status', handleStatus);
  app.get('/api/console/status', handleStatus);

  // 4. Client Interception Setup / Teardown
  const handleSetup = async (req: any, reply: any) => {
    const { client } = req.params as { client: string };
    const result = await setupClient(client);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };

  const handleTeardown = async (req: any, reply: any) => {
    const { client } = req.params as { client: string };
    const result = await teardownClient(client);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };

  app.post('/api/ui/client/:client/setup', handleSetup);
  app.post('/api/console/client/:client/setup', handleSetup);
  app.post('/api/ui/client/:client/teardown', handleTeardown);
  app.post('/api/console/client/:client/teardown', handleTeardown);

  // 5. Configuration Read & Write API
  app.get('/api/ui/config', async () => ({ status: 'ok', config: loadConfig() }));
  app.get('/api/console/config', async () => ({ status: 'ok', config: loadConfig() }));

  const handleSaveConfig = async (req: any, reply: any) => {
    const body = req.body as Partial<RouterConfig>;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ success: false, message: 'Invalid config payload' });
    }
    const result = saveConfig(body);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };
  app.post('/api/ui/config', handleSaveConfig);
  app.post('/api/console/config', handleSaveConfig);

  // 6. Raw YAML Configuration
  app.get('/api/ui/config/raw', async () => ({ status: 'ok', yaml: getRawConfig() }));
  app.get('/api/console/config/raw', async () => ({ status: 'ok', yaml: getRawConfig() }));

  const handleSaveRawYaml = async (req: any, reply: any) => {
    const body = req.body as { yaml?: string };
    if (!body?.yaml || typeof body.yaml !== 'string') {
      return reply.status(400).send({ success: false, message: 'YAML content is required' });
    }
    const result = saveRawConfig(body.yaml);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };
  app.post('/api/ui/config/raw', handleSaveRawYaml);
  app.post('/api/console/config/raw', handleSaveRawYaml);

  // 7. Provider Key Connectivity Test (Ping Probe)
  const handleTestProbe = async (req: any) => {
    const body = req.body as { baseUrl: string; apiKey?: string; type?: string };
    const baseUrl = body.baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const apiKey = body.apiKey || '';
    const type = body.type || 'openai';

    const startTime = Date.now();
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'OpenCode-Router-Probe/1.0',
      };

      let targetUrl = `${baseUrl}/models`;
      if (type === 'anthropic') {
        targetUrl = `${baseUrl}/v1/models`;
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        if (!targetUrl.includes('/v1') && !targetUrl.includes('/models')) {
          targetUrl = `${baseUrl}/v1/models`;
        }
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }

      const res = await fetch(targetUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;
      if (res.ok) {
        return { ok: true, status: res.status, latencyMs, message: `Connection successful (${latencyMs}ms)` };
      } else if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, latencyMs, message: `Authentication failed (${res.status})` };
      } else {
        return { ok: false, status: res.status, latencyMs, message: `Upstream HTTP ${res.status}` };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return { ok: false, latencyMs, message: `Network error or timeout: ${err.message}` };
    }
  };
  app.post('/api/ui/providers/test', handleTestProbe);
  app.post('/api/console/providers/test', handleTestProbe);

  // 8. Save or Update Provider API Key
  const handleSaveKeys = async (req: any, reply: any) => {
    const body = req.body as { name?: string; keys?: Record<string, { apiKey: string; baseUrl?: string }>; apiKey?: string; baseUrl?: string };
    const currentConfig = loadConfig();
    const providers = currentConfig.providers || [];

    if (body.keys && typeof body.keys === 'object') {
      for (const [providerName, info] of Object.entries(body.keys)) {
        const idx = providers.findIndex((p) => p.name.toLowerCase() === providerName.toLowerCase());
        if (idx !== -1) {
          if (info.apiKey) providers[idx].apiKey = info.apiKey;
          if (info.baseUrl) providers[idx].baseUrl = info.baseUrl;
        } else if (info.apiKey) {
          providers.push({
            name: providerName,
            type: 'openai-compatible',
            baseUrl: info.baseUrl || 'https://api.openai.com/v1',
            apiKey: info.apiKey,
          });
        }
      }
      currentConfig.providers = providers;
      return saveConfig(currentConfig);
    }

    if (!body.name) {
      return reply.status(400).send({ success: false, message: 'Provider name or keys dictionary is required' });
    }

    const existingIdx = providers.findIndex((p) => p.name.toLowerCase() === body.name!.toLowerCase());
    if (existingIdx !== -1) {
      if (body.apiKey) providers[existingIdx].apiKey = body.apiKey;
      if (body.baseUrl) providers[existingIdx].baseUrl = body.baseUrl;
    } else {
      providers.push({
        name: body.name,
        type: 'openai-compatible',
        baseUrl: body.baseUrl || 'https://api.openai.com/v1',
        apiKey: body.apiKey || '',
      });
    }

    currentConfig.providers = providers;
    return saveConfig(currentConfig);
  };
  app.post('/api/ui/providers/keys', handleSaveKeys);
  app.post('/api/console/providers/keys', handleSaveKeys);

  // 9. Client API Keys Management (for external client access)
  const handleListApiKeys = async () => {
    return { status: 'ok', keys: listApiKeys(false) };
  };
  app.get('/api/ui/api-keys', handleListApiKeys);
  app.get('/api/console/api-keys', handleListApiKeys);

  const handleCreateApiKey = async (req: any, reply: any) => {
    const body = req.body as { name: string; key?: string; role?: 'admin' | 'user'; expiresAt?: string; description?: string };
    if (!body?.name) {
      return reply.status(400).send({ success: false, message: 'API Key name is required' });
    }
    const result = createApiKey(body);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };
  app.post('/api/ui/api-keys', handleCreateApiKey);
  app.post('/api/console/api-keys', handleCreateApiKey);

  const handleUpdateApiKey = async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; enabled?: boolean; expiresAt?: string; description?: string; role?: 'admin' | 'user' };
    const result = updateApiKey(id, body);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };
  app.put('/api/ui/api-keys/:id', handleUpdateApiKey);
  app.put('/api/console/api-keys/:id', handleUpdateApiKey);

  const handleDeleteApiKey = async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    const result = deleteApiKey(id);
    if (!result.success) return reply.status(400).send(result);
    return result;
  };
  app.delete('/api/ui/api-keys/:id', handleDeleteApiKey);
  app.delete('/api/console/api-keys/:id', handleDeleteApiKey);

  // 10. Remote restart trigger from UI
  const handleRestart = async () => {
    setTimeout(() => process.exit(0), 500);
    return { status: 'restarting', message: 'Gateway restart signal acknowledged' };
  };
  app.post('/api/ui/restart', handleRestart);
  app.post('/api/console/restart', handleRestart);
}

// Backwards compatibility export
export const registerUiRoutes = registerConsoleRoutes;
