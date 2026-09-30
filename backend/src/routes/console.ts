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
    '/providers',
    '/keys', // legacy alias for /providers
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

  // 7. OpenCode-native Provider Management (opencode.jsonc `provider` node + auth.json)
  //     - Definitions live in ~/.config/opencode/opencode.jsonc (JSONC, comment-preserving edits)
  //     - Credentials live in ~/.local/share/opencode/auth.json
  //     - Connectable catalog comes from models.dev (same source as `opencode auth login`)
  const ocHandlers = {
    list: async () => {
      const { listOpenCodeProviders, getOpenCodeConfigPath, getOpenCodeAuthPath } = await import(
        '../opencode/user-config.js'
      );
      const { catalogRepository } = await import('../opencode/catalog/repository.js');
      const unified = await catalogRepository.list();
      const byId = new Map(unified.map((p) => [p.id, p]));
      return {
        status: 'ok',
        configPath: getOpenCodeConfigPath(),
        authPath: getOpenCodeAuthPath(),
        catalogSync: catalogRepository.lastSyncOrigin,
        providers: listOpenCodeProviders().map((v) => {
          const u = byId.get(v.id);
          return {
            ...v,
            logoUrl: u?.logoUrl,
            priceFrom: u ? catalogRepository.minInputPrice(u) : undefined,
            modelsCount: u?.models.length ?? v.models.length,
          };
        }),
      };
    },

    catalog: async () => {
      const { catalogRepository } = await import('../opencode/catalog/repository.js');
      const unified = await catalogRepository.list();
      // Trim model arrays from the list payload (detail endpoint can serve them later)
      const providers = unified.map((p) => ({
        id: p.id,
        name: p.name,
        logoUrl: p.logoUrl,
        npm: p.npm,
        api: p.api,
        baseURL: p.baseURL,
        doc: p.doc,
        env: p.env,
        custom: p.custom,
        connected: p.connected,
        sources: p.sources,
        modelCount: p.models.length,
        priceFrom: catalogRepository.minInputPrice(p),
      }));
      return { status: 'ok', source: catalogRepository.lastSyncOrigin, providers };
    },

    create: async (req: any, reply: any) => {
      const body = req.body as any;
      if (!body?.id) {
        return reply.status(400).send({ success: false, error: 'Provider id is required' });
      }
      const { upsertCustomProvider } = await import('../opencode/user-config.js');
      const result = upsertCustomProvider({
        id: String(body.id),
        name: body.name,
        npm: body.npm,
        baseURL: body.baseURL,
        apiKey: body.apiKey,
        apiKeyInline: Boolean(body.apiKeyInline),
        headers: body.headers,
        models: body.models,
        options: body.options,
      });
      if (!result.success) return reply.status(400).send(result);
      return { status: 'ok', ...result };
    },

    update: async (req: any, reply: any) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const { upsertCustomProvider, getProviderNodeById } = await import('../opencode/user-config.js');
      const existing = getProviderNodeById(id);
      if (!existing) {
        return reply.status(404).send({ success: false, error: `Provider '${id}' not found in opencode.jsonc` });
      }
      const result = upsertCustomProvider({
        id,
        name: body.name ?? existing.name,
        npm: body.npm ?? existing.npm,
        baseURL: body.baseURL ?? existing.options?.baseURL,
        apiKey: body.apiKey,
        apiKeyInline: body.apiKeyInline ?? Boolean(existing.options?.apiKey),
        headers: body.headers ?? existing.options?.headers,
        models: body.models ?? existing.models,
        options: existing.options,
      });
      if (!result.success) return reply.status(400).send(result);
      return { status: 'ok', ...result };
    },

    connect: async (req: any, reply: any) => {
      const { id } = req.params as { id: string };
      const body = req.body as { apiKey?: string; baseURL?: string };
      const { setAuthApiKey, upsertCustomProvider, getProviderNodeById } = await import('../opencode/user-config.js');
      try {
        if (!body?.apiKey) {
          return reply.status(400).send({
            success: false,
            oauthHint: true,
            error: `API key required. For OAuth-based providers run: opencode auth login ${id}`,
          });
        }
        setAuthApiKey(id, body.apiKey);
        // Optional baseURL override — merge with the existing definition so we
        // never wipe name/npm/models of a config-defined custom provider.
        if (body.baseURL) {
          const existing = getProviderNodeById(id);
          upsertCustomProvider({
            id,
            baseURL: body.baseURL,
            name: existing?.name,
            npm: existing?.npm,
            headers: existing?.options?.headers,
            models: existing?.models,
            options: existing?.options,
          });
        }
        return { status: 'ok', success: true, message: `Provider '${id}' connected via auth.json` };
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message });
      }
    },

    setKey: async (req: any, reply: any) => {
      const { id } = req.params as { id: string };
      const body = req.body as { apiKey?: string };
      const { setAuthApiKey } = await import('../opencode/user-config.js');
      if (!body?.apiKey) {
        return reply.status(400).send({ success: false, error: 'apiKey is required' });
      }
      try {
        setAuthApiKey(id, body.apiKey);
        return { status: 'ok', success: true, message: `Credential updated for '${id}'` };
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message });
      }
    },

    remove: async (req: any, reply: any) => {
      const { id } = req.params as { id: string };
      const query = req.query as { purgeAuth?: string };
      const { deleteCustomProvider, removeAuthEntry, getProviderNodeById } = await import(
        '../opencode/user-config.js'
      );
      const purgeAuth = query.purgeAuth === '1' || query.purgeAuth === 'true';
      if (getProviderNodeById(id)) {
        const result = deleteCustomProvider(id, { purgeAuth });
        if (!result.success) return reply.status(400).send(result);
        return { status: 'ok', ...result };
      }
      // Credential-only entry (catalog provider connected via auth.json)
      try {
        removeAuthEntry(id);
        return { status: 'ok', success: true, message: `Credential entry '${id}' removed` };
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message });
      }
    },
  };

  for (const prefix of ['/api/ui', '/api/console']) {
    app.get(`${prefix}/opencode/providers`, ocHandlers.list);
    app.get(`${prefix}/opencode/catalog`, ocHandlers.catalog);
    app.post(`${prefix}/opencode/providers`, ocHandlers.create);
    app.patch(`${prefix}/opencode/providers/:id`, ocHandlers.update);
    app.post(`${prefix}/opencode/providers/:id/connect`, ocHandlers.connect);
    app.post(`${prefix}/opencode/providers/:id/key`, ocHandlers.setKey);
    app.delete(`${prefix}/opencode/providers/:id`, ocHandlers.remove);
  }

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
