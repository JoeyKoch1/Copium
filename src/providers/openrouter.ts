import { ModelProvider, ChatMessage, StreamCallbacks, ToolDefinition, ToolCall } from './index';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements ModelProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';

  constructor(
    private apiKey: string,
    private preferredModel: string = 'openrouter/free',
  ) {}

  async listModels(): Promise<string[]> {
    const url = `${OPENROUTER_BASE}/models`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models fetch failed: ${response.status}`);
    }

    const data = await response.json();
    const models: string[] = [];

    if (Array.isArray(data?.data)) {
      for (const m of data.data) {
        if (typeof m?.id === 'string' && m.id.length > 0) {
          models.push(m.id);
        }
      }
    }

    return models.sort();
  }

  async sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    tools?: ToolDefinition[],
  ): Promise<ToolCall[] | null> {
    const url = `${OPENROUTER_BASE}/chat/completions`;
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://copium.dev',
          'X-OpenRouter-Title': 'Copium',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${errText}`);
      }

      if (!response.body) {
        throw new Error('OpenRouter response has no body');
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
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            callbacks.onDone();
            return toolCalls.length > 0 ? toolCalls : null;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed?.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) {
              callbacks.onToken(delta.content);
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls as Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>) {
                if (tc.type !== 'function') continue;
                const idx = tc.index ?? 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id ?? `call_${Date.now()}_${idx}`, type: 'function', function: { name: '', arguments: '' } };
                }
                const entry = toolCalls[idx];
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.function.name += tc.function.name;
                if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
              }
            }

            if (choice.finish_reason === 'tool_calls' && toolCalls.length > 0) {
              return toolCalls;
            }
          } catch {
            // skip unparseable SSE lines
          }
        }
      }

      if (buffer.trim().length > 0 && buffer.trim() !== '[DONE]') {
        try {
          const parsed = JSON.parse(buffer.trim());
          const choice = parsed?.choices?.[0];
          if (choice?.delta?.content) {
            callbacks.onToken(choice.delta.content);
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
        callbacks.onError(new Error('OpenRouter request timed out'));
        return null;
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }
}
