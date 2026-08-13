import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OllamaProvider } from '../../src/providers/ollama';

function createMockResponse(init: {
  ok?: boolean;
  json?: () => Promise<unknown>;
  body?: ReadableStream;
}): Response {
  const mock = {
    ok: init.ok ?? true,
    json: init.json ?? (() => Promise.resolve({})),
    body: init.body ?? null,
    status: init.ok === false ? 500 : 200,
    statusText: init.ok === false ? 'Internal Server Error' : 'OK',
  } as unknown as Response;
  return mock;
}

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434', 'llama3.2:3b');
  });

  it('returns models from /api/tags', async () => {
    globalThis.fetch = mock(() =>
      createMockResponse({
        json: () =>
          Promise.resolve({
            models: [{ name: 'llama3.2:3b' }, { name: 'codellama:7b' }],
          }),
      }),
    ) as unknown as typeof fetch;

    const models = await provider.listModels();
    expect(models).toEqual(['llama3.2:3b', 'codellama:7b']);
  });

  it('calls onError on connection failure', async () => {
    globalThis.fetch = mock(() => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const callbacks = {
      onToken: mock(() => {}),
      onDone: mock(() => {}),
      onError: mock(() => {}),
    };

    await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  it('streams NDJSON chunks to onToken', async () => {
    const chunks = [
      '{"message":{"content":"Hello"},"done":false}',
      '{"message":{"content":" world"},"done":false}',
      '{"message":{"content":"!"},"done":true}',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk + '\n'));
        }
        controller.close();
      },
    });

    globalThis.fetch = mock((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve(
          createMockResponse({
            json: () => Promise.resolve({ models: [{ name: 'llama3.2:3b' }] }),
          }),
        );
      }
      if (url.includes('/api/chat')) {
        return Promise.resolve(
          createMockResponse({
            ok: true,
            body: stream,
          }),
        );
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as unknown as typeof fetch;

    const callbacks = {
      onToken: mock(() => {}),
      onDone: mock(() => {}),
      onError: mock(() => {}),
    };

    await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(3, '!');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  });
});
