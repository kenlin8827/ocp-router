import crypto from 'node:crypto';
import { ChatCompletionRequest } from '../types/openai.js';
import { RoutingDecision, TierLevel, TierModelConfig, TIER_RANK } from '../types/router.js';
import { SessionConfig } from '../config/types.js';

export interface ConversationSession {
  id: string;
  maxTier: TierLevel;
  pinnedModel: string;
  pinnedProvider: string;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
  historyTiers: TierLevel[];
}

export interface SessionResolveResult {
  sessionId: string;
  lookupType: 'explicit_header' | 'request_user' | 'prefix_chain' | 'root_anchor';
}

/**
 * Session Monotonic Ratchet Manager
 * 
 * Core Objectives:
 * 1. Eliminate mid-conversation model downgrades caused by short follow-up questions
 *    ("thanks", "fix this line") to prevent intellectual degradation.
 * 2. Protect upstream Provider KV Prompt Caching from being invalidated due to model thrashing,
 *    maximizing FinOps cost savings (80%-95%).
 * 3. Support zero-header session tracking via Prefix Chain Hash + Root Anchor for standard
 *    OpenAI clients without sticky session headers.
 */
export class SessionManager {
  private config: SessionConfig;
  private sessions = new Map<string, ConversationSession>();
  private prefixToSession = new Map<string, string>(); // prefixHash -> sessionId
  private readonly ttlMs: number;
  private readonly maxSessions: number;

  constructor(config?: SessionConfig) {
    this.config = {
      enabled: config?.enabled ?? true,
      strategy: config?.strategy ?? 'monotonic',
      ttlSeconds: config?.ttlSeconds ?? 3600,
      maxSessions: config?.maxSessions ?? 10000,
    };
    this.ttlMs = (this.config.ttlSeconds || 3600) * 1000;
    this.maxSessions = this.config.maxSessions || 10000;
  }

  /**
   * Generates a compact SHA-256 fingerprint for a sequence of messages.
   */
  public static hashMessages(messages: any[]): string {
    const serialized = messages
      .map(m => {
        const role = m.role || 'user';
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p: any) => p.text || '').join(' ')
            : JSON.stringify(m.content || '');
        return `${role}:${content}`;
      })
      .join('\n---\n');

    return crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 20);
  }

  /**
   * Seamless Session Resolver:
   * Priority 1: Explicit Header (x-session-id / x-conversation-id)
   * Priority 2: OpenAI native request.user field
   * Priority 3: Prefix Chain Hash -> For turn 2+, hashes all history excluding newest user prompt
   * Priority 4: Root Anchor -> For turn 1 cold start, hashes client IP + first user message
   */
  public resolveSessionId(
    request: ChatCompletionRequest,
    clientIp = '127.0.0.1',
    headers?: Record<string, string | string[] | undefined>
  ): SessionResolveResult {
    // 1. Explicit Header Probe
    const explicitHeader =
      headers?.['x-session-id'] ||
      headers?.['x-conversation-id'] ||
      headers?.['session-id'] ||
      headers?.['conversation-id'];

    if (explicitHeader) {
      const id = Array.isArray(explicitHeader) ? explicitHeader[0] : explicitHeader;
      return { sessionId: id.trim(), lookupType: 'explicit_header' };
    }

    // 2. OpenAI Native request.user Probe
    if (request.user && typeof request.user === 'string' && request.user.trim()) {
      return { sessionId: request.user.trim(), lookupType: 'request_user' };
    }

    // Explicit router_options.session_id
    if (request.router_options?.session_id) {
      return { sessionId: request.router_options.session_id.trim(), lookupType: 'explicit_header' };
    }

    const messages = request.messages || [];

    // 3. Prefix Chain Hash Probe (Turn 2+, messages.length >= 2)
    // Exclude current turn's prompt; history contains prior assistant response (globally collision-free)
    if (messages.length >= 2) {
      const priorHistory = messages.slice(0, -1);
      const prefixHash = SessionManager.hashMessages(priorHistory);
      const matchedSessionId = this.prefixToSession.get(prefixHash);
      if (matchedSessionId) {
        return { sessionId: matchedSessionId, lookupType: 'prefix_chain' };
      }
    }

    // 4. Root Anchor Probe (Turn 1 cold start)
    const firstUserMsg = messages.find(m => m.role === 'user');
    const rootContent = firstUserMsg
      ? (typeof firstUserMsg.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg.content))
      : 'empty_root';
    
    const rootCombined = `${clientIp}:${rootContent.slice(0, 500)}`;
    const rootHash = 'sess_' + crypto.createHash('sha256').update(rootCombined).digest('hex').slice(0, 16);

    return { sessionId: rootHash, lookupType: 'root_anchor' };
  }

  /**
   * Applies the Monotonic Session Ratchet policy.
   * 
   * - Upgrade (T_proposed > T_session): Allowed. Upgrades tier and pins new model instance.
   * - Downgrade (T_proposed <= T_session): Blocked. Enforces historical peak tier and reuses pinned model.
   */
  public applyRatchet(
    sessionId: string,
    proposedDecision: RoutingDecision,
    resolveModelForTier: (tier: TierLevel) => TierModelConfig
  ): {
    finalDecision: RoutingDecision;
    session: ConversationSession;
    ratchetApplied: boolean;
  } {
    this.cleanupExpiredSessions();

    if (!this.config.enabled || this.config.strategy === 'stateless') {
      const dummyModel = resolveModelForTier(proposedDecision.targetTier);
      return {
        finalDecision: proposedDecision,
        session: {
          id: sessionId,
          maxTier: proposedDecision.targetTier,
          pinnedModel: dummyModel.id,
          pinnedProvider: dummyModel.provider,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          turnCount: 1,
          historyTiers: [proposedDecision.targetTier],
        },
        ratchetApplied: false,
      };
    }

    const now = Date.now();
    let session = this.sessions.get(sessionId);

    // 1. Initialize new session
    if (!session) {
      const initialModel = resolveModelForTier(proposedDecision.targetTier);
      session = {
        id: sessionId,
        maxTier: proposedDecision.targetTier,
        pinnedModel: initialModel.id,
        pinnedProvider: initialModel.provider,
        createdAt: now,
        lastActiveAt: now,
        turnCount: 1,
        historyTiers: [proposedDecision.targetTier],
      };
      this.sessions.set(sessionId, session);

      return {
        finalDecision: proposedDecision,
        session,
        ratchetApplied: false,
      };
    }

    // 2. Existing session handling
    const currentMaxRank = TIER_RANK[session.maxTier] || 2;
    const proposedRank = TIER_RANK[proposedDecision.targetTier] || 2;

    if (this.config.strategy === 'sticky') {
      session.turnCount++;
      session.lastActiveAt = now;
      session.historyTiers.push(session.maxTier);

      return {
        finalDecision: {
          ...proposedDecision,
          targetTier: session.maxTier,
          reason: `[Session Sticky Locked] Maintained at ${session.maxTier} (Model: ${session.pinnedModel})`,
        },
        session,
        ratchetApplied: proposedDecision.targetTier !== session.maxTier,
      };
    }

    // 3. Monotonic Ratchet strategy
    if (proposedRank > currentMaxRank) {
      // 3A. Escalation triggered (e.g. fast -> flagship or flagship -> reasoning)
      const oldTier = session.maxTier;
      session.maxTier = proposedDecision.targetTier;
      const upgradedModel = resolveModelForTier(session.maxTier);
      session.pinnedModel = upgradedModel.id;
      session.pinnedProvider = upgradedModel.provider;
      session.turnCount++;
      session.lastActiveAt = now;
      session.historyTiers.push(session.maxTier);

      return {
        finalDecision: {
          ...proposedDecision,
          reason: `${proposedDecision.reason} [Session Escalated: ${oldTier} -> ${session.maxTier}]`,
        },
        session,
        ratchetApplied: true,
      };
    } else {
      // 3B. Downgrade intercepted
      const isDowngradeAttempt = proposedRank < currentMaxRank;
      session.turnCount++;
      session.lastActiveAt = now;
      session.historyTiers.push(session.maxTier);

      const ratchetReason = isDowngradeAttempt
        ? `[Session Monotonic Ratchet] Downgrade intercepted, preserved peak ${session.maxTier} (Pinned model: ${session.pinnedModel}, KV cache preserved); Single turn proposed ${proposedDecision.targetTier} (${proposedDecision.reason})`
        : `[Session Preserved] Maintained ${session.maxTier} (Pinned model: ${session.pinnedModel})`;

      return {
        finalDecision: {
          ...proposedDecision,
          targetTier: session.maxTier,
          reason: ratchetReason,
        },
        session,
        ratchetApplied: isDowngradeAttempt,
      };
    }
  }

  /**
   * Post-turn registration:
   * Hashes the full conversation chain including assistant response as index for next turn.
   */
  public registerCompletedTurn(
    sessionId: string,
    requestMessages: any[],
    assistantResponseContent: string
  ): void {
    if (!this.config.enabled || this.config.strategy === 'stateless') return;

    try {
      const completedHistory = [
        ...requestMessages,
        { role: 'assistant', content: assistantResponseContent },
      ];
      const prefixHash = SessionManager.hashMessages(completedHistory);
      this.prefixToSession.set(prefixHash, sessionId);

      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastActiveAt = Date.now();
      }
    } catch {
      // Graceful error handling
    }
  }

  public getSession(sessionId: string): ConversationSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): ConversationSession[] {
    return Array.from(this.sessions.values());
  }

  public deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    for (const [hash, sessId] of this.prefixToSession.entries()) {
      if (sessId === sessionId) {
        this.prefixToSession.delete(hash);
      }
    }
    return existed;
  }

  /**
   * Dynamically re-pins a session to a healthy model instance when the previous
   * pinned model has been tripped by circuit breaker (Session Self-Healing).
   */
  public repinModel(sessionId: string, newModel: TierModelConfig): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pinnedModel = newModel.id;
    session.pinnedProvider = newModel.provider;
    return true;
  }

  public clear(): void {
    this.sessions.clear();
    this.prefixToSession.clear();
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    if (this.sessions.size < this.maxSessions) return;

    // 1. Evict expired sessions
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.deleteSession(id);
      }
    }

    // 2. If still at or exceeding capacity, evict oldest by lastActiveAt (LRU)
    if (this.sessions.size >= this.maxSessions) {
      const sorted = Array.from(this.sessions.values()).sort(
        (a, b) => a.lastActiveAt - b.lastActiveAt
      );
      const overflowCount = this.sessions.size - this.maxSessions + 1;
      const toRemove = sorted.slice(0, Math.max(1, overflowCount));
      for (const s of toRemove) {
        this.deleteSession(s.id);
      }
    }
  }
}
