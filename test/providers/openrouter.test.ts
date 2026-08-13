import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenRouterProvider } from '../../src/providers/openrouter';

function createMockResponse(init: {
  ok?: boolean;
  json?: () => Promise<unknown>;
  body?: ReadableStream;
  text?: () => Promise<string>;
  status?: number;
}): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  const mock = {
    ok: init.ok ?? true,
    json: init.json ?? (() => Promise.resolve({})),
    body: init.body ?? null,
    text: init.text ?? (() => Promise.resolve('')),
    status,
    statusText: status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : 'Internal Server Error',
  } as unknown as Response;
  return mock;
}

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    provider = new OpenRouterProvider('test-api-key', 'openrouter/free');
  });

  it('returns model IDs from /models, preferred/free first', async () => {
    globalThis.fetch = mock(() =>
      createMockResponse({
        json: () =>
          Promise.resolve({
            data: [
              { id: 'openrouter/free' },
              { id: 'cohere/north-mini-code:free' },
              { id: 'meta-llama/llama-3.3-70b-instruct:free' },
              { id: 'deepseek/deepseek-chat' },
            ],
          }),
      }),
    ) as unknown as typeof fetch;

    const models = await provider.listModels();
    // preferred (constructor arg 'openrouter/free') first, then free models sorted, then the rest.
    expect(models).toEqual([
      'openrouter/free',
      'cohere/north-mini-code:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-chat',
    ]);
  });

  it('streams tokens correctly', async () => {
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

    globalThis.fetch = mock(() => createMockResponse({ ok: true, body: stream })) as unknown as typeof fetch;

    const callbacks = {
      onToken: mock(() => {}),
      onDone: mock(() => {}),
      onError: mock(() => {}),
    };

    const result = await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(3, '!');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
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

    const result = await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('listModels throws a helpful 401 error with a key hint', async () => {
    globalThis.fetch = mock(() =>
      createMockResponse({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":{"message":"No auth credentials found"}}'),
      }),
    ) as unknown as typeof fetch;

    const err = await provider.listModels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/missing or invalid/i);
    expect((err as Error).message).toMatch(/OPENROUTER_API_KEY/);
  });

  it('listModels throws when /models is rate limited', async () => {
    globalThis.fetch = mock(() =>
      createMockResponse({
        ok: false,
        status: 429,
        text: () => Promise.resolve('{"error":{"message":"rate limit"}}'),
      }),
    ) as unknown as typeof fetch;

    const err = await provider.listModels().catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/rate limit/i);
    expect((err as Error).message).toMatch(/wait a moment and retry/i);
  });
});
