import { ChatCompletionRequest, ChatMessage } from '../types/openai.js';

export class PromptOptimizer {
  /**
   * Reorganize messages so system and static background prompts are placed deterministically
   * at index 0, ensuring maximum upstream KV prefix hits across requests.
   */
  public static normalizeMessages(request: ChatCompletionRequest): ChatMessage[] {
    const messages = [...request.messages];
    const systemMessages: ChatMessage[] = [];
    const otherMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        systemMessages.push({
          ...msg,
          content: typeof msg.content === 'string' ? msg.content.trim() : msg.content,
        });
      } else {
        otherMessages.push(msg);
      }
    }

    // Combine multiple system messages into a single canonical system prompt block if necessary
    if (systemMessages.length > 1) {
      const combined = systemMessages
        .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n\n');
      return [{ role: 'system', content: combined }, ...otherMessages];
    }

    return [...systemMessages, ...otherMessages];
  }

  /**
   * For Anthropic Claude requests, inject cache_control: {"type": "ephemeral"}
   * on the system prompt block or the largest prefix block (> 1024 tokens)
   */
  public static injectAnthropicCacheControl(systemPrompt: string | undefined): any[] {
    if (!systemPrompt || systemPrompt.length < 100) {
      return systemPrompt ? [{ type: 'text', text: systemPrompt }] : [];
    }

    return [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  /**
   * Extract upstream provider prompt tokens details
   */
  public static extractCachedTokens(usage?: any): number {
    if (!usage) return 0;
    if (usage.prompt_tokens_details?.cached_tokens) {
      return usage.prompt_tokens_details.cached_tokens;
    }
    if (usage.cache_read_input_tokens) {
      return usage.cache_read_input_tokens;
    }
    return 0;
  }
}
