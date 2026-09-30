import { TierLevel } from '../types/router.js';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type ErrorCategory =
  | 'QUOTA_EXHAUSTED'      // 余额不足、配额耗尽、欠费停机 (HTTP 402, insufficient_quota)
  | 'AUTHENTICATION_ERROR' // API Key 无效、未授权 (HTTP 401)
  | 'RATE_LIMITED'         // 频控限流、TPM/RPM 超限 (HTTP 429)
  | 'SERVICE_UNAVAILABLE'  // 上游服务宕机、网关超时、连接拒绝 (HTTP 500/502/503/504, ETIMEDOUT, ECONNREFUSED)
  | 'CLIENT_ERROR'         // 客户端输入错误、上下文超限 (HTTP 400, context length exceeded)
  | 'UNKNOWN';

export interface ErrorDiagnosis {
  category: ErrorCategory;
  statusCode?: number;
  isRetriable: boolean;
  shouldTripBreaker: boolean;
  hardTrip: boolean; // 立即触发熔断，无需累积重试次数（如 402 欠费）
  suggestedCooldownMs?: number;
  reason: string;
  retryAfterSeconds?: number;
  rawError?: any;
}

export interface CircuitBreakerConfig {
  enabled?: boolean;
  failureThreshold?: number; // 连续 5xx/宕机失败次数阈值（默认: 3）
  slidingWindowSize?: number; // 请求滑动窗口大小（默认: 20）
  failureRateThreshold?: number; // 窗口内错误率阈值（默认: 0.5，即 50%）
  initialCooldownMs?: number; // 初始熔断冷却时长（默认: 30000 = 30秒）
  maxCooldownMs?: number; // 最大熔断冷却上限（默认: 18000000 = 5小时）
  cooldownMultiplier?: number; // 阶梯退避倍数（默认: 2.0）
  quotaCooldownMs?: number; // 402/余额不足熔断时长（默认: 43200000 = 12小时）
  halfOpenMaxProbes?: number; // HALF_OPEN 半开探活最大放行探针数（默认: 1）
  activeProbing?: {
    enabled?: boolean;
    intervalMs?: number; // 后台探活巡检间隔（默认: 60000 = 1分钟）
  };
}

export interface CircuitBreakerSnapshot {
  modelId: string;
  provider: string;
  tier?: TierLevel;
  state: CircuitBreakerState;
  reason?: string;
  category?: ErrorCategory;
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  trippedAt?: number;
  cooldownUntil?: number;
  remainingCooldownMs: number;
  currentCooldownMs: number;
  halfOpenProbes: number;
}
