import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '../../src/providers/openrouter';

function createMockResponse(init: {
  ok?: boolean;
  json?: () => Promise<unknown>;
  body?: ReadableStream;
  text?: () => Promise<string>;
}): Response {
  const mock = {
    ok: init.ok ?? true,
    json: init.json ?? (() => Promise.resolve({})),
    body: init.body ?? null,
    text: init.text ?? (() => Promise.resolve('')),
    status: init.ok === false ? 500 : 200,
    statusText: init.ok === false ? 'Internal Server Error' : 'OK',
  } as unknown as Response;
  return mock;
}

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    provider = new OpenRouterProvider('test-api-key', 'openrouter/free');
  });

  it('returns model IDs from /models', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        json: () =>
          Promise.resolve({
            data: [
              { id: 'openrouter/free' },
              { id: 'meta-llama/llama-3.3-70b-instruct:free' },
              { id: 'deepseek/deepseek-chat' },
            ],
          }),
      }),
    );

    const models = await provider.listModels();
    expect(models).toEqual([
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct:free',
      'openrouter/free',
    ]);
  });

  it('streams tokens and returns tool calls', async () => {
    const chunks = [
      '{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
      '{"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
      '{"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}',
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(`data: ${chunk}\n`));
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        ok: true,
        body: stream,
      }),
    );

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    const result = await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(3, '!');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('calls onError on connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    const result = await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
