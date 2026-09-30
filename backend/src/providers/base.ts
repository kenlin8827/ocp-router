import { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';
import { ModelRegistration } from '../config/types.js';

export interface ProviderResponse {
  response: ChatCompletionResponse;
  rawUsage?: any;
}

export interface LLMProvider {
  name: string;
  createCompletion(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<ChatCompletionResponse>;

  createStream?(
    request: ChatCompletionRequest,
    model: ModelRegistration
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
}
