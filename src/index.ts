import { loadConfig } from './config/index.js';
import { createServer } from './server.js';
import { OpenCodeConnector } from './opencode/sync.js';
import { OpenCodeProxyProvider } from './providers/opencode-proxy.js';
import { ProviderRegistry } from './providers/registry.js';
import { FinOpsTracker } from './metrics/finops-tracker.js';
import { PipelineOrchestrator } from './pipeline/orchestrator.js';

import { Layer1Classifier } from './router/layer1-classifier.js';

async function main() {
  const config = loadConfig();
  
  // 0. Auto-initialize Layer 1 model base scaffold
  await Layer1Classifier.init(config.classifier?.localModel);
  console.log(`[ocp-router] Layer 1 classifier ready: ${Layer1Classifier.getModelStatus()}`);
  
  // 1. Check OpenCode v2 connection
  const openCodeConnector = new OpenCodeConnector(config.opencode?.url, config.opencode?.password);
  const openCodeAvailable = openCodeConnector.isAvailable();

  let registry: ProviderRegistry;
  let tracker = new FinOpsTracker();
  let orchestrator: PipelineOrchestrator;

  if (openCodeAvailable) {
    const serviceCfg = openCodeConnector.getServiceConfig()!;
    console.log(`[ocp-router] Connected to local OpenCode v2 service: ${serviceCfg.baseUrl}`);
    
    try {
      const syncedModels = await openCodeConnector.syncToTierModels();
      console.log(`[ocp-router] Dynamically synchronized ${syncedModels.length} models from OpenCode!`);

      config.models = syncedModels;
      const defaultTier2 = syncedModels.find(m => m.tier === 'tier2' && m.isDefaultInTier) || syncedModels[0];
      config.baselineModel = defaultTier2?.id || 'auto';

      registry = new ProviderRegistry(config, false);
      const openCodeProxy = new OpenCodeProxyProvider(serviceCfg);

      // Register all OpenCode-managed providers in proxy mode
      const providers = await openCodeConnector.getProviders();
      for (const p of providers) {
        registry.registerProvider(p.id, openCodeProxy);
      }
      registry.registerProvider('opencode', openCodeProxy);

      console.log(`[ocp-router] Connected to ${providers.length} upstream providers via OpenCode (Keyless proxy pass-through)`);
    } catch (err: any) {
      console.warn(`[ocp-router] OpenCode model sync failed, falling back to standalone config: ${err.message}`);
      registry = new ProviderRegistry(config, true);
    }
  } else {
    console.log('[ocp-router] No OpenCode v2 local service detected, using config.yaml static setup');
    registry = new ProviderRegistry(config, false);
  }

  orchestrator = new PipelineOrchestrator(config, registry, tracker);
  const { app } = createServer(config, false, registry, orchestrator);

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log('\n============================================================');
    console.log(`🚀 OCP Router Gateway is ready! (OpenAI API Compatible)`);
    console.log(`👉 API Base URL     : http://127.0.0.1:${config.port}/v1`);
    console.log(`👉 Default Model    : auto (or cascading-auto)`);
    console.log(`👉 Chat Completions : http://127.0.0.1:${config.port}/v1/chat/completions`);
    console.log(`👉 Models List      : http://127.0.0.1:${config.port}/v1/models`);
    console.log(`👉 FinOps Metrics   : http://127.0.0.1:${config.port}/v1/metrics`);
    console.log(`👉 Sessions Inspect : http://127.0.0.1:${config.port}/v1/sessions`);
    console.log('============================================================\n');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
