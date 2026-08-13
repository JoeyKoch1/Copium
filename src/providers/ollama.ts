import type { ChatMessage, ModelProvider, StreamCallbacks, ToolCall, ToolDefinition } from './types';

const DEFAULT_ENDPOINT = 'http://localhost:11434';

/** Ollama expects tool call arguments as an object, not a JSON string. */
function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';

  constructor(
    private endpoint: string = DEFAULT_ENDPOINT,
    private preferredModel: string = '',
  ) {}

  async listModels(): Promise<string[]> {
    const url = `${this.endpoint}/api/tags`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      const models: string[] = [];
      const list = data?.models ?? data ?? [];

      if (Array.isArray(list)) {
        for (const item of list) {
          const name = typeof item === 'string' ? item : item?.name;
          if (typeof name === 'string' && name.length > 0) {
            models.push(name);
          }
        }
      }

      return models;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Ollama request timed out');
      }
      throw err;
    }
  }

  async sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    tools?: ToolDefinition[],
  ): Promise<ToolCall[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const url = `${this.endpoint}/api/chat`;

    try {
      const models = await this.listModels();
      const model =
        this.preferredModel && models.includes(this.preferredModel)
          ? this.preferredModel
          : (models[0] ?? '');

      if (!model) {
        callbacks.onError(new Error('No Ollama models available'));
        return null;
      }

      const body: Record<string, unknown> = {
        model,
        messages: messages.map(({ role, content, tool_call_id, name, tool_calls }) => ({
          role,
          content,
          ...(tool_call_id ? { tool_call_id } : {}),
          ...(name ? { name } : {}),
          ...(tool_calls
            ? {
                tool_calls: tool_calls.map((tc) => ({
                  id: tc.id,
                  type: tc.type,
                  function: {
                    name: tc.function.name,
                    arguments: safeJsonParse(tc.function.arguments),
                  },
                })),
              }
            : {}),
        })),
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
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Ollama response has no body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const toolCalls: ToolCall[] = [];

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const content = parsed?.message?.content;
            if (typeof content === 'string' && content.length > 0) {
              callbacks.onToken(content);
            }
            if (parsed?.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls as Array<{
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: unknown };
              }>) {
                toolCalls.push({
                  id: tc.id ?? `call_${Date.now()}_${toolCalls.length}`,
                  type: 'function',
                  function: {
                    name: tc.function?.name ?? '',
                    arguments:
                      typeof tc.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function?.arguments ?? {}),
                  },
                });
              }
            }
            if (parsed?.done) {
              callbacks.onDone();
              return toolCalls.length > 0 ? toolCalls : null;
            }
          } catch {
            // skip unparseable lines
          }
        }
      }

      if (buffer.trim().length > 0) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const content = parsed?.message?.content;
          if (typeof content === 'string' && content.length > 0) {
            callbacks.onToken(content);
          }
        } catch {
          // ignore
        }
      }

      callbacks.onDone();
      return toolCalls.length > 0 ? toolCalls : null;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        callbacks.onError(new Error('Ollama request timed out'));
        return null;
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }
}
