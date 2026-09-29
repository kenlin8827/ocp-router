import { LLMProvider } from './base.js';
import { ModelRegistration } from '../config/types.js';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';
import { OpenCodeServiceConfig } from '../opencode/sync.js';

export class OpenCodeProxyProvider implements LLMProvider {
  public name = 'opencode-proxy';
  private config: OpenCodeServiceConfig;

  constructor(config: OpenCodeServiceConfig) {
    this.config = config;
  }

  public async createCompletion(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/api/experimental/generate`;

    // Flatten messages into conversational prompt
    let prompt = '';
    for (const msg of request.messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(p => p.text || '').join(' ')
          : '';
      prompt += `${msg.role.toUpperCase()}: ${content}\n\n`;
    }
    prompt += 'ASSISTANT:';

    const payload = {
      prompt: prompt.trim(),
      model: {
        providerID: model.provider,
        id: model.upstreamModel,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.config.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode Proxy failed [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as any;
    const text = data.data?.text || '';

    // Estimate tokens
    const promptTokens = Math.ceil(prompt.length / 3);
    const completionTokens = Math.ceil(text.length / 3);

    return {
      id: `opencode-cmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}
