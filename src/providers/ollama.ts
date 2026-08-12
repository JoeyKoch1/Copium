import { ModelProvider, ChatMessage, StreamCallbacks } from './index';

const DEFAULT_ENDPOINT = 'http://localhost:11434';

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama (Local)';

  constructor(private endpoint: string = DEFAULT_ENDPOINT) {}

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

      const data = await response.json();
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
    preferredModel?: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const url = `${this.endpoint}/api/chat`;

    try {
      const models = await this.listModels();
      const model = preferredModel && models.includes(preferredModel)
        ? preferredModel
        : models[0] ?? '';

      if (!model) {
        callbacks.onError(new Error('No Ollama models available'));
        return;
      }
      const body = {
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        stream: true,
      };

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
            if (parsed?.done) {
              callbacks.onDone();
              return;
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
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        callbacks.onError(new Error('Ollama request timed out'));
        return;
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
