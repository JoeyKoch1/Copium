import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    provider = new OllamaProvider('http://localhost:11434');
  });

  it('returns models from /api/tags', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        json: () =>
          Promise.resolve({
            models: [
              { name: 'llama3.2:3b' },
              { name: 'codellama:7b' },
            ],
          }),
      }),
    );

    const models = await provider.listModels();
    expect(models).toEqual(['llama3.2:3b', 'codellama:7b']);
  });

  it('falls back to nested models array shape', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        json: () =>
          Promise.resolve({
            models: [{ name: 'phi3:mini' }],
          }),
      }),
    );

    const models = await provider.listModels();
    expect(models).toEqual(['phi3:mini']);
  });

  it('calls onError on connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
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

    global.fetch = vi.fn().mockImplementation((url: string) => {
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
    });

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks, 'llama3.2:3b');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(3, '!');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
  });
});
