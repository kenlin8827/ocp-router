import { CircuitBreakerManager } from './circuit-breaker-manager.js';
import { ErrorClassifier } from './error-classifier.js';
import { ModelRegistration } from '../config/types.js';
import { ChatCompletionRequest } from '../types/openai.js';

export interface ProberTargetResolver {
  getModel(modelId: string): ModelRegistration | undefined;
  execute(request: ChatCompletionRequest, model: ModelRegistration): Promise<any>;
}

export class ActiveHealthProber {
  private manager: CircuitBreakerManager;
  private resolver: ProberTargetResolver;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isProbing = false;

  constructor(
    manager: CircuitBreakerManager,
    resolver: ProberTargetResolver,
    intervalMs = 60000
  ) {
    this.manager = manager;
    this.resolver = resolver;
    this.intervalMs = intervalMs;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.probeTrippedModels().catch(() => {
        // Silently swallow errors during background probe
      });
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async probeTrippedModels(): Promise<void> {
    if (this.isProbing) return;
    this.isProbing = true;

    try {
      const snapshots = this.manager.getAllSnapshots();
      // Target models that are in OPEN (and cooldown has elapsed) or in HALF_OPEN
      const candidates = snapshots.filter(s => {
        if (s.state === 'HALF_OPEN') return true;
        if (s.state === 'OPEN' && s.remainingCooldownMs <= 0) return true;
        return false;
      });

      for (const candidate of candidates) {
        const model = this.resolver.getModel(candidate.modelId);
        if (!model) continue;

        const probeReq: ChatCompletionRequest = {
          model: model.upstreamModel,
          messages: [{ role: 'user', content: 'health_check_ping' }],
          max_tokens: 1,
        };

        try {
          await this.resolver.execute(probeReq, model);
          // If successful, record success and close breaker!
          this.manager.recordSuccess(model.id);
        } catch (err: any) {
          const diagnosis = ErrorClassifier.classify(err, model.id, model.provider);
          this.manager.recordFailure(model.id, diagnosis, model.provider);
        }
      }
    } finally {
      this.isProbing = false;
    }
  }
}
