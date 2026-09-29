import { LLMProvider } from './base.js';
import { ModelRegistration, ProviderConfig } from '../config/types.js';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';

export class AnthropicProvider implements LLMProvider {
  public name: string;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  public async createCompletion(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      ...this.config.headers,
    };

    // Separate system messages and convert messages to Anthropic format
    let systemPrompt: any = undefined;
    const anthropicMessages: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // Prompt caching block for Anthropic
        systemPrompt = [
          {
            type: 'text',
            text,
            cache_control: { type: 'ephemeral' },
          },
        ];
      } else {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        anthropicMessages.push({ role, content });
      }
    }

    const payload: any = {
      model: model.upstreamModel,
      max_tokens: request.max_tokens || request.max_completion_tokens || 4096,
      messages: anthropicMessages,
      system: systemPrompt,
      temperature: request.temperature,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 60000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Anthropic error [${res.status}]: ${errorText}`);
      }

      const data = (await res.json()) as any;

      // Extract text content from Anthropic content blocks
      let textContent = '';
      if (Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'text') {
            textContent += block.text;
          }
        }
      }

      const cachedTokens = data.usage?.cache_read_input_tokens || 0;
      const uncachedInput = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;

      // Convert to OpenAI standard ChatCompletionResponse
      const response: ChatCompletionResponse = {
        id: data.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model.id,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: textContent,
            },
            finish_reason: data.stop_reason === 'max_tokens' ? 'length' : 'stop',
          },
        ],
        usage: {
          prompt_tokens: uncachedInput + cachedTokens,
          completion_tokens: outputTokens,
          total_tokens: uncachedInput + cachedTokens + outputTokens,
          prompt_tokens_details: {
            cached_tokens: cachedTokens,
          },
        },
      };

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
