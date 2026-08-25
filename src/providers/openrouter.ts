import type { ChatMessage, ModelProvider, StreamCallbacks, ToolCall, ToolDefinition } from './types';
import { streamChatCompletions } from './sse';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements ModelProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';

  constructor(
    private apiKey: string,
    private preferredModel: string = 'cohere/north-mini-code:free',
  ) {}

  async listModels(): Promise<string[]> {
    const url = `${OPENROUTER_BASE}/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: this.apiKey ? `Bearer ${this.apiKey}` : '',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, 300);
        } catch {
          // ignore body read failure
        }
        const hint =
          response.status === 401
            ? 'Your OpenRouter API key is missing or invalid. Set OPENROUTER_API_KEY or add openrouter.apiKey to the config file.'
            : response.status === 429
              ? 'OpenRouter rate limit hit. Wait a moment and retry.'
              : `HTTP ${response.status}`;
        throw new Error(`Failed to list models from OpenRouter (${hint})${detail ? `: ${detail}` : ''}`);
      }

      const data: any = await response.json();
      const models: string[] = [];

      if (Array.isArray(data?.data)) {
        for (const m of data.data) {
          if (typeof m?.id === 'string' && m.id.length > 0) {
            models.push(m.id);
          }
        }
      }

      // Filter out :batch/:json variants that aren't chat models, keep things tidy.
      const chatModels = models.filter((id) => !id.includes(':batch'));
      return sortModels(chatModels, this.preferredModel);
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Timed out listing models from OpenRouter.');
      }
      throw err;
    }
  }

  async sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ToolCall[] | null> {
    const body: Record<string, unknown> = {
      model: this.preferredModel,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    return streamChatCompletions(
      `${OPENROUTER_BASE}/chat/completions`,
      body,
      {
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://copium.dev',
        'X-OpenRouter-Title': 'Copium',
      },
      callbacks,
      undefined,
      undefined,
      signal,
    );
  }
}

/**
 * Sort models so the preferred model is first, then free models, then the
 * rest alphabetically. Keeps the picker useful instead of dumping 400 random
 * entries.
 */
function sortModels(models: string[], preferredModel: string): string[] {
  const preferred = preferredModel && models.includes(preferredModel) ? [preferredModel] : [];
  const free = models
    .filter((m) => m !== preferredModel && (m.endsWith(':free') || m.endsWith('free')))
    .sort();
  const rest = models
    .filter((m) => m !== preferredModel && !(m.endsWith(':free') || m.endsWith('free')))
    .sort();
  return [...preferred, ...free, ...rest];
}
