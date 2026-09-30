import { loadConfig } from './config/index.js';
import { createServer } from './server.js';
import { OpenCodeConnector } from './opencode/sync.js';
import { OpenCodeProxyProvider } from './providers/opencode-proxy.js';
import { ProviderRegistry } from './providers/registry.js';
import { FinOpsTracker } from './metrics/finops-tracker.js';
import { PipelineOrchestrator } from './pipeline/orchestrator.js';

import { Layer1Classifier } from './router/layer1-classifier.js';
import { catalogRepository } from './opencode/catalog/repository.js';

async function main() {
  const config = loadConfig();

  // -1. Provider/model catalog sync (config-driven sources; defaults when unset)
  try {
    catalogRepository.applyConfig(config.catalog);
    await catalogRepository.start();
    console.log(`[OCR] Catalog synced: ${catalogRepository.lastSyncOrigin}`);
  } catch (err: any) {
    console.warn(`[OCR] Catalog sync failed (will retry on interval): ${err.message}`);
  }

  // 0. Auto-initialize Layer 1 model base scaffold
  await Layer1Classifier.init(config.classifier?.localModel);
  console.log(`[OCR] Layer 1 classifier ready: ${Layer1Classifier.getModelStatus()}`);
  
  // 1. Check OpenCode v2 connection
  const openCodeConnector = new OpenCodeConnector(config.opencode?.url, config.opencode?.password);
  const openCodeAvailable = openCodeConnector.isAvailable();

  let registry: ProviderRegistry;
  let tracker = new FinOpsTracker();
  let orchestrator: PipelineOrchestrator;

  if (openCodeAvailable) {
    const serviceCfg = openCodeConnector.getServiceConfig()!;
    console.log(`[OCR] Connected to local OpenCode v2 service: ${serviceCfg.baseUrl}`);
    
    try {
      const syncedModels = await openCodeConnector.syncToTierModels();
      console.log(`[OCR] Dynamically synchronized ${syncedModels.length} models from OpenCode!`);

      config.models = syncedModels;
      const defaultFlagship = syncedModels.find(m => m.tier === 'flagship' && m.isDefaultInTier) || syncedModels[0];
      config.baselineModel = defaultFlagship?.id || 'auto';

      registry = new ProviderRegistry(config, false);
      const openCodeProxy = new OpenCodeProxyProvider(serviceCfg);

      // Register all OpenCode-managed providers in proxy mode
      const providers = await openCodeConnector.getProviders();
      for (const p of providers) {
        registry.registerProvider(p.id, openCodeProxy);
      }
      registry.registerProvider('opencode', openCodeProxy);

      console.log(`[OCR] Connected to ${providers.length} upstream providers via OpenCode (Keyless proxy pass-through)`);
    } catch (err: any) {
      console.warn(`[OCR] OpenCode model sync failed, falling back to standalone config: ${err.message}`);
      registry = new ProviderRegistry(config, true);
    }
  } else {
    console.log('[OCR] No OpenCode v2 local service detected, using config.yaml static setup');
    registry = new ProviderRegistry(config, false);
  }

  orchestrator = new PipelineOrchestrator(config, registry, tracker);
  const { app } = createServer(config, false, registry, orchestrator);

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log('\n============================================================');
    console.log(`🚀 OCR Gateway (OpenCode Router) is ready! (OpenAI API Compatible)`);
    console.log(`👉 API Base URL     : http://127.0.0.1:${config.port}/v1`);
    console.log(`👉 Default Model    : auto (Virtual models: auto, auto-fast, auto-flagship, auto-reasoning)`);
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
