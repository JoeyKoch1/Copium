import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BYOKProvider } from '../../src/providers/byok';

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
    statusText: status === 401 ? 'Unauthorized' : 'Internal Server Error',
  } as unknown as Response;
  return mock;
}

describe('BYOKProvider', () => {
  let provider: BYOKProvider;

  beforeEach(() => {
    provider = new BYOKProvider('https://api.deepseek.com/v1', 'test-key', 'deepseek-chat');
  });

  it('returns its single model', async () => {
    const models = await provider.listModels();
    expect(models).toEqual(['deepseek-chat']);
  });

  it('streams tokens correctly', async () => {
    const chunks = [
      '{"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}',
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
    expect(callbacks.onToken).toHaveBeenNthCalledWith(1, 'Hi');
    expect(callbacks.onToken).toHaveBeenNthCalledWith(2, '!');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('calls onError on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      createMockResponse({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }),
    );

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    const result = await provider.sendChat([{ role: 'user', content: 'hi' }], callbacks);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('401'),
    }));
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
