import { TierLevel } from '../types/router.js';

export interface FinOpsStats {
  totalRequests: number;
  fallbackCount: number;
  tierDistribution: {
    tier1: { count: number; pct: number };
    tier2: { count: number; pct: number };
    tier3: { count: number; pct: number };
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
    tier1AvgMs: number;
    tier2AvgMs: number;
    tier3AvgMs: number;
  };
}

export class FinOpsTracker {
  private totalRequests = 0;
  private fallbackCount = 0;

  private tierCounts: Record<TierLevel, number> = {
    tier1: 0,
    tier2: 0,
    tier3: 0,
  };

  private tierLatencySum: Record<TierLevel, number> = {
    tier1: 0,
    tier2: 0,
    tier3: 0,
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
    const tier1Count = this.tierCounts.tier1;
    const tier2Count = this.tierCounts.tier2;
    const tier3Count = this.tierCounts.tier3;

    const totalSavings = Math.max(0, this.baselineCostUsd - this.actualCostUsd);
    const savingsPct = this.baselineCostUsd > 0 ? (totalSavings / this.baselineCostUsd) * 100 : 0;

    const totalLatency =
      this.tierLatencySum.tier1 + this.tierLatencySum.tier2 + this.tierLatencySum.tier3;

    return {
      totalRequests: this.totalRequests,
      fallbackCount: this.fallbackCount,
      tierDistribution: {
        tier1: {
          count: tier1Count,
          pct: Number(((tier1Count / total) * 100).toFixed(2)),
        },
        tier2: {
          count: tier2Count,
          pct: Number(((tier2Count / total) * 100).toFixed(2)),
        },
        tier3: {
          count: tier3Count,
          pct: Number(((tier3Count / total) * 100).toFixed(2)),
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
        tier1AvgMs: tier1Count > 0 ? Math.round(this.tierLatencySum.tier1 / tier1Count) : 0,
        tier2AvgMs: tier2Count > 0 ? Math.round(this.tierLatencySum.tier2 / tier2Count) : 0,
        tier3AvgMs: tier3Count > 0 ? Math.round(this.tierLatencySum.tier3 / tier3Count) : 0,
      },
    };
  }

  public reset(): void {
    this.totalRequests = 0;
    this.fallbackCount = 0;
    this.tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
    this.tierLatencySum = { tier1: 0, tier2: 0, tier3: 0 };
    this.promptTokens = 0;
    this.cachedPromptTokens = 0;
    this.completionTokens = 0;
    this.reasoningTokens = 0;
    this.actualCostUsd = 0;
    this.baselineCostUsd = 0;
  }
}
