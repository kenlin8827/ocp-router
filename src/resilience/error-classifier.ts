import { ErrorCategory, ErrorDiagnosis, CircuitBreakerConfig } from './types.js';

export class UpstreamError extends Error {
  public status?: number;
  public errorBody?: string;
  public provider?: string;
  public modelId?: string;
  public retryAfterSeconds?: number;

  constructor(options: {
    message: string;
    status?: number;
    errorBody?: string;
    provider?: string;
    modelId?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = 'UpstreamError';
    this.status = options.status;
    this.errorBody = options.errorBody;
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ErrorClassifier {
  /**
   * Industrial-grade LLM upstream error classification & diagnosis engine.
   * Categorizes errors into actionable resilience decisions:
   * - Hard Trip (e.g. 402 Quota Exhausted / 401 Auth)
   * - Sliding window failure count (5xx / Connection timeout / 5h downtime)
   * - Transient backoff (429 Rate limit)
   * - Non-penalizing pass-through (400 Client error / context length exceeded)
   */
  public static classify(
    error: any,
    modelId: string,
    provider: string,
    config?: CircuitBreakerConfig
  ): ErrorDiagnosis {
    const quotaCooldown = config?.quotaCooldownMs || 12 * 3600 * 1000; // default: 12 hours
    const defaultInitialCooldown = config?.initialCooldownMs || 30 * 1000; // default: 30s

    // Extract status code
    let statusCode: number | undefined = undefined;
    if (error?.status && typeof error.status === 'number') {
      statusCode = error.status;
    } else if (error?.statusCode && typeof error.statusCode === 'number') {
      statusCode = error.statusCode;
    }

    // Extract raw text message / error body
    const rawMessage = (error?.message || '').toString();
    const rawBody = (error?.errorBody || error?.body || error?.responseBody || '').toString();
    const combinedText = `${rawMessage} ${rawBody}`.toLowerCase();

    // If status code not directly on error object, try parsing from status pattern in message
    if (!statusCode) {
      const match = combinedText.match(/\bstatus\s*[:=]?\s*(\d{3})\b/) ||
                    combinedText.match(/\b\[\s*(\d{3})\s*\]/) ||
                    combinedText.match(/\bcode\s*[:=]?\s*(\d{3})\b/);
      if (match) {
        statusCode = parseInt(match[1], 10);
      }
    }

    // Extract retry-after header if present
    let retryAfterSeconds: number | undefined = error?.retryAfterSeconds;
    if (!retryAfterSeconds && error?.headers) {
      const h = error.headers;
      const ra = typeof h.get === 'function' ? h.get('retry-after') : h['retry-after'];
      if (ra) {
        const parsed = parseInt(ra, 10);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterSeconds = parsed;
        }
      }
    }

    // -------------------------------------------------------------
    // 1. QUOTA_EXHAUSTED (余额不足 / 额度耗尽 / 欠费停机)
    // -------------------------------------------------------------
    const isQuotaPattern =
      statusCode === 402 ||
      combinedText.includes('insufficient_quota') ||
      combinedText.includes('quota_exceeded') ||
      combinedText.includes('exceeded_current_quota') ||
      combinedText.includes('credit_expired') ||
      combinedText.includes('billing_not_active') ||
      combinedText.includes('balance_exhausted') ||
      combinedText.includes('out_of_credits') ||
      combinedText.includes('has exceeded its quota') ||
      combinedText.includes('payment_required') ||
      combinedText.includes('account_deactivated') ||
      combinedText.includes('insufficient balance') ||
      combinedText.includes('insufficient credit') ||
      combinedText.includes('arrears');

    if (isQuotaPattern) {
      return {
        category: 'QUOTA_EXHAUSTED',
        statusCode: statusCode || 402,
        isRetriable: true, // Retriable by falling back to ANOTHER model in the pool!
        shouldTripBreaker: true,
        hardTrip: true, // Immediate circuit trip!
        suggestedCooldownMs: quotaCooldown,
        reason: `Quota or balance exhausted for model '${modelId}' (Provider: ${provider})`,
        rawError: error,
      };
    }

    // -------------------------------------------------------------
    // 2. AUTHENTICATION_ERROR (Key 无效 / 未授权)
    // -------------------------------------------------------------
    const isAuthPattern =
      statusCode === 401 ||
      combinedText.includes('invalid_api_key') ||
      combinedText.includes('incorrect api key') ||
      combinedText.includes('unauthorized') ||
      combinedText.includes('authentication_error');

    if (isAuthPattern) {
      return {
        category: 'AUTHENTICATION_ERROR',
        statusCode: 401,
        isRetriable: true, // Retriable by failing over to another provider/model
        shouldTripBreaker: true,
        hardTrip: true, // Immediate circuit trip!
        suggestedCooldownMs: quotaCooldown,
        reason: `Invalid API key or unauthorized for model '${modelId}' (Provider: ${provider})`,
        rawError: error,
      };
    }

    // -------------------------------------------------------------
    // 3. RATE_LIMITED (频控限流 429)
    // -------------------------------------------------------------
    const isRateLimitPattern =
      statusCode === 429 ||
      combinedText.includes('rate_limit') ||
      combinedText.includes('too many requests') ||
      combinedText.includes('tokens per minute') ||
      combinedText.includes('requests per minute') ||
      combinedText.includes('tpm') ||
      combinedText.includes('rpm');

    if (isRateLimitPattern) {
      const cooldownMs = retryAfterSeconds
        ? retryAfterSeconds * 1000
        : Math.min(60 * 1000, defaultInitialCooldown);

      return {
        category: 'RATE_LIMITED',
        statusCode: 429,
        isRetriable: true,
        shouldTripBreaker: true,
        hardTrip: false, // Standard trip or short backoff
        suggestedCooldownMs: cooldownMs,
        retryAfterSeconds,
        reason: `Rate limit (429) exceeded on model '${modelId}' (Cooldown: ${Math.round(cooldownMs / 1000)}s)`,
        rawError: error,
      };
    }

    // -------------------------------------------------------------
    // 4. CLIENT_ERROR (客户端传参错误 / 上下文超限 - 绝不惩罚模型健康度!)
    // -------------------------------------------------------------
    const isClientErrorPattern =
      (statusCode === 400 || statusCode === 422) &&
      (
        combinedText.includes('context_length_exceeded') ||
        combinedText.includes('maximum context length') ||
        combinedText.includes('content_filter') ||
        combinedText.includes('invalid_request_error') ||
        combinedText.includes('does not support') ||
        combinedText.includes('json_schema')
      );

    if (isClientErrorPattern) {
      return {
        category: 'CLIENT_ERROR',
        statusCode: statusCode || 400,
        isRetriable: false, // Client payload is fundamentally invalid
        shouldTripBreaker: false, // Never trip circuit breaker for client payload error!
        hardTrip: false,
        reason: `Client parameter or context length error: ${rawMessage.slice(0, 200)}`,
        rawError: error,
      };
    }

    // -------------------------------------------------------------
    // 5. SERVICE_UNAVAILABLE (上游服务宕机 / 5xx / 网络超时 / ETIMEDOUT)
    // -------------------------------------------------------------
    const isServerUnavailable =
      (statusCode !== undefined && statusCode >= 500 && statusCode < 600) ||
      combinedText.includes('etimedout') ||
      combinedText.includes('econnrefused') ||
      combinedText.includes('econnreset') ||
      combinedText.includes('fetch failed') ||
      combinedText.includes('aborted') ||
      combinedText.includes('network error') ||
      combinedText.includes('service unavailable') ||
      combinedText.includes('bad gateway') ||
      combinedText.includes('gateway timeout') ||
      combinedText.includes('overloaded');

    if (isServerUnavailable) {
      return {
        category: 'SERVICE_UNAVAILABLE',
        statusCode: statusCode || 503,
        isRetriable: true,
        shouldTripBreaker: true,
        hardTrip: false,
        suggestedCooldownMs: defaultInitialCooldown,
        reason: `Upstream service unavailable [${statusCode || 'NETWORK_ERROR'}]: ${rawMessage.slice(0, 150)}`,
        rawError: error,
      };
    }

    // -------------------------------------------------------------
    // 6. UNKNOWN / Generic Error
    // -------------------------------------------------------------
    return {
      category: 'UNKNOWN',
      statusCode,
      isRetriable: true,
      shouldTripBreaker: true,
      hardTrip: false,
      suggestedCooldownMs: defaultInitialCooldown,
      reason: `Unknown upstream error: ${rawMessage.slice(0, 150)}`,
      rawError: error,
    };
  }
}
