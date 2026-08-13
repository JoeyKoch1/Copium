import type { CopiumConfig } from '../config';
import type { ModelProvider } from './types';
import { OllamaProvider } from './ollama';
import { OpenRouterProvider } from './openrouter';
import { BYOKProvider } from './byok';

export function createProvider(config: CopiumConfig): ModelProvider | null {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider(config.ollama.endpoint, config.ollama.model);
    case 'openrouter':
      // OpenRouter allows browsing models without a key; chat fails with a
      // clear 401 only if a key is actually missing.
      return new OpenRouterProvider(config.openrouter.apiKey, config.openrouter.model);
    case 'byok': {
      const apiKey = config.byok.apiKey;
      if (!apiKey) {
        return null;
      }
      return new BYOKProvider(config.byok.endpoint, apiKey, config.byok.model);
    }
    default:
      return null;
  }
}

export type { ChatMessage, ModelProvider, StreamCallbacks, ToolCall, ToolDefinition } from './types';
