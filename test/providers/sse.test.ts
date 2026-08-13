import { describe, it, expect, mock } from 'bun:test';
import { streamChatCompletions } from '../../src/providers/sse';

function sseStream(chunks: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(`data: ${chunk}\n`));
      }
      controller.close();
    },
  });
}

function mockResponse(body: ReadableStream): Response {
  return { ok: true, body, status: 200, statusText: 'OK' } as unknown as Response;
}

describe('streamChatCompletions tool-call aggregation', () => {
  it('aggregates tool call arguments split across multiple delta chunks', async () => {
    // Mirrors real OpenAI-compatible streaming: only the FIRST delta chunk
    // for a tool call carries `type`/`id`/`function.name`. Every following
    // chunk that streams the rest of the JSON arguments omits them.
    const chunks = [
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'writeFile', arguments: '' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt","content":"hi"}' } }] }, finish_reason: 'tool_calls' },
        ],
      }),
    ];

    globalThis.fetch = mock(() => Promise.resolve(mockResponse(sseStream(chunks)))) as unknown as typeof fetch;

    const callbacks = { onToken: mock(() => {}), onDone: mock(() => {}), onError: mock(() => {}) };
    const result = await streamChatCompletions('https://example.com/chat', {}, {}, callbacks);

    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.function.name).toBe('writeFile');
    expect(result![0]!.function.arguments).toBe('{"path":"a.txt","content":"hi"}');
    expect(JSON.parse(result![0]!.function.arguments)).toEqual({ path: 'a.txt', content: 'hi' });
  });

  it('still rejects deltas that explicitly declare a non-function tool type', async () => {
    const chunks = [
      JSON.stringify({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'retrieval', function: { name: 'x', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    ];

    globalThis.fetch = mock(() => Promise.resolve(mockResponse(sseStream(chunks)))) as unknown as typeof fetch;

    const callbacks = { onToken: mock(() => {}), onDone: mock(() => {}), onError: mock(() => {}) };
    const result = await streamChatCompletions('https://example.com/chat', {}, {}, callbacks);

    expect(result).toBeNull();
  });
});
