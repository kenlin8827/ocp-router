import { TierLevel } from '../types/router.js';

export interface FinOpsStats {
  totalRequests: number;
  fallbackCount: number;
  tierDistribution: {
    fast: { count: number; pct: number };
    flagship: { count: number; pct: number };
    reasoning: { count: number; pct: number };
  };
  tokens: {
    totalPromptTokens: number;
    totalCachedPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
  };
  economics: {
    actualCostUsd: number;
    baselineCostUsd: number;
    totalSavingsUsd: number;
    savingsPct: number;
  };
  latency: {
    avgMs: number;
    fastAvgMs: number;
    flagshipAvgMs: number;
    reasoningAvgMs: number;
  };
}

export class FinOpsTracker {
  private totalRequests = 0;
  private fallbackCount = 0;

  private tierCounts: Record<TierLevel, number> = {
    fast: 0,
    flagship: 0,
    reasoning: 0,
  };

  private tierLatencySum: Record<TierLevel, number> = {
    fast: 0,
    flagship: 0,
    reasoning: 0,
  };

  private promptTokens = 0;
  private cachedPromptTokens = 0;
  private completionTokens = 0;
  private reasoningTokens = 0;

  private actualCostUsd = 0;
  private baselineCostUsd = 0;

  public record(params: {
    tier: TierLevel;
    fallbackOccurred: boolean;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
    reasoningTokens?: number;
    actualCost: number;
    baselineCost: number;
    latencyMs: number;
  }): void {
    this.totalRequests++;
    if (params.fallbackOccurred) {
      this.fallbackCount++;
    }

    this.tierCounts[params.tier]++;
    this.tierLatencySum[params.tier] += params.latencyMs;

    this.promptTokens += params.promptTokens;
    this.cachedPromptTokens += params.cachedPromptTokens;
    this.completionTokens += params.completionTokens;
    this.reasoningTokens += params.reasoningTokens || 0;

    this.actualCostUsd += params.actualCost;
    this.baselineCostUsd += params.baselineCost;
  }

  public getStats(): FinOpsStats {
    const total = this.totalRequests || 1;
    const fastCount = this.tierCounts.fast;
    const flagshipCount = this.tierCounts.flagship;
    const reasoningCount = this.tierCounts.reasoning;

    const totalSavings = Math.max(0, this.baselineCostUsd - this.actualCostUsd);
    const savingsPct = this.baselineCostUsd > 0 ? (totalSavings / this.baselineCostUsd) * 100 : 0;

    const totalLatency =
      this.tierLatencySum.fast + this.tierLatencySum.flagship + this.tierLatencySum.reasoning;

    return {
      totalRequests: this.totalRequests,
      fallbackCount: this.fallbackCount,
      tierDistribution: {
        fast: {
          count: fastCount,
          pct: Number(((fastCount / total) * 100).toFixed(2)),
        },
        flagship: {
          count: flagshipCount,
          pct: Number(((flagshipCount / total) * 100).toFixed(2)),
        },
        reasoning: {
          count: reasoningCount,
          pct: Number(((reasoningCount / total) * 100).toFixed(2)),
        },
      },
      tokens: {
        totalPromptTokens: this.promptTokens,
        totalCachedPromptTokens: this.cachedPromptTokens,
        totalCompletionTokens: this.completionTokens,
        totalReasoningTokens: this.reasoningTokens,
      },
      economics: {
        actualCostUsd: Number(this.actualCostUsd.toFixed(5)),
        baselineCostUsd: Number(this.baselineCostUsd.toFixed(5)),
        totalSavingsUsd: Number(totalSavings.toFixed(5)),
        savingsPct: Number(savingsPct.toFixed(2)),
      },
      latency: {
        avgMs: this.totalRequests > 0 ? Math.round(totalLatency / this.totalRequests) : 0,
        fastAvgMs: fastCount > 0 ? Math.round(this.tierLatencySum.fast / fastCount) : 0,
        flagshipAvgMs: flagshipCount > 0 ? Math.round(this.tierLatencySum.flagship / flagshipCount) : 0,
        reasoningAvgMs: reasoningCount > 0 ? Math.round(this.tierLatencySum.reasoning / reasoningCount) : 0,
      },
    };
  }

  public reset(): void {
    this.totalRequests = 0;
    this.fallbackCount = 0;
    this.tierCounts = { fast: 0, flagship: 0, reasoning: 0 };
    this.tierLatencySum = { fast: 0, flagship: 0, reasoning: 0 };
    this.promptTokens = 0;
    this.cachedPromptTokens = 0;
    this.completionTokens = 0;
    this.reasoningTokens = 0;
    this.actualCostUsd = 0;
    this.baselineCostUsd = 0;
  }
}
