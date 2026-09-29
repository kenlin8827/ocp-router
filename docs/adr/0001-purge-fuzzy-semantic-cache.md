# ADR-0001: Complete Physical Removal of Local Fuzzy Semantic Caching

## Status
Accepted - 2026-09-29

## Context
During the initial design of the gateway, an in-memory local semantic caching layer (`src/cache/semantic-cache.ts`) was introduced with the goal of intercepting duplicate or near-duplicate requests to lower latency and API costs.

However, during integration and multi-client testing, a catastrophic failure mode emerged: **the gateway returned identical cached responses regardless of what the user asked**.

Root-cause analysis revealed three fundamental flaws:
1. **System Prompt Weight Dominance & Collapse**: Modern AI clients (OpenCode, Chatbox, Cursor, NextChat) prepend long global system prompts (typically 300 to 1000+ characters). When vector embeddings or N-gram bag-of-words are computed over the full prompt, the static system prompt accounts for over 90% of the vector mass. Consequently, completely unrelated queries (e.g., "calculate 25*4" vs. "what is the capital of France") yielded a cosine similarity of `0.9903`, blowing past the `0.95` threshold and causing disastrous response cross-contamination.
2. **Semantic Inversion Blindness in Lightweight Embeddings**: Lightweight similarity measures failed to detect critical semantic negations (e.g., "do not delete" vs. "delete immediately"), subtle numerical variations (`25*4` vs. `25*5`), and code diffs.
3. **Architectural Contamination**: Leaving unused cache abstractions behind a configuration flag (`enabled: false`) invites accidental reactivation, implicit coupling, and maintenance hazards.

## Decision
1. **Physical Deletion over Soft Configuration**:
   - Completely deleted the `src/cache/` directory (`semantic-cache.ts` and `prompt-cache.ts`).
   - Physically purged all local cache logic, state, and dependencies from `PipelineOrchestrator`, `Server`, `FinOpsTracker`, and domain types.
2. **Transition to Native Upstream Prompt Caching**:
   - Retain prefix normalization in `PromptOptimizer` to maximize upstream Provider KV Prompt Cache hit rates (Anthropic, DeepSeek, OpenAI).
   - Track upstream `cached_tokens` solely in `FinOpsTracker` without intercepting or synthesizing LLM responses locally.

## Consequences
- **Positive**:
  - Eliminates prompt cross-contamination; 100% of requests pass through cleanly to live upstream providers.
  - Simplifies the orchestration pipeline and eliminates memory leaks from vector indices.
  - Keeps the codebase transparent, predictable, and aligned with unix microservice philosophy.
- **Negative / Trade-offs**:
  - Identical repeated queries do not get 0ms synthetic hits; they must hit upstream providers (though discounted by upstream KV Cache).
