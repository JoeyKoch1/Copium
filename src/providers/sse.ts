import { StreamCallbacks, ToolCall } from './types';

/**
 * Shared SSE streaming parser for OpenAI-compatible /chat/completions endpoints.
 * Handles `data: {...}` lines, the `[DONE]` sentinel, tool-call delta
 * aggregation, and a trailing partial-buffer flush.
 */
export async function streamChatCompletions(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  callbacks: StreamCallbacks,
  timeoutMs = 120000,
  idleTimeoutMs = 60000,
  signal?: AbortSignal,
): Promise<ToolCall[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // Propagate an external interrupt (user pressed Escape) to the request.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      const hint =
        response.status === 401
          ? ' (API key missing or invalid — check OPENROUTER_API_KEY / config)'
          : response.status === 429
            ? ' (rate limited — wait and retry)'
            : '';
      throw new Error(`Provider error ${response.status} from ${url}${hint}: ${errText.slice(0, 300)}`);
    }

    if (!response.body) {
      throw new Error('Provider response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sawFinishReason = false;
    let buffer = '';
    const toolCalls: ToolCall[] = [];

    // Idle timeout: reset on every chunk so a stalled mid-stream connection
    // (common with free-tier providers) errors out instead of hanging forever.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    };

    try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      resetIdleTimer();
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

        const result = parseSseLine(data, toolCalls, callbacks);
        if (result === 'finish-reason-seen') {
          sawFinishReason = true;
        }
        if (result === 'tool-calls-done') {
          return toolCalls;
        }
      }
    }

    // Flush any trailing content that arrived without a newline.
    const tail = buffer.trim();
    if (tail.length > 0 && tail !== '[DONE]') {
      try {
        const parsed = JSON.parse(tail);
        const choice = parsed?.choices?.[0];
        if (choice?.delta?.content) {
          callbacks.onToken(choice.delta.content);
        }
      } catch {
        // ignore
      }
    }

    // Stream ended without [DONE] or a finish_reason — the connection was
    // cut prematurely. Surface it rather than treating truncation as success.
    if (!sawFinishReason) {
      callbacks.onError(new Error('Stream ended prematurely (connection closed before completion)'));
      return toolCalls.length > 0 ? toolCalls : null;
    }

    callbacks.onDone();
    return toolCalls.length > 0 ? toolCalls : null;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      if (signal?.aborted) {
        // User interrupt — not an error, just stop streaming quietly.
        return null;
      }
      callbacks.onError(new Error('Provider request timed out'));
      return null;
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

function parseSseLine(
  data: string,
  toolCalls: ToolCall[],
  callbacks: StreamCallbacks,
): void | 'finish-reason-seen' | 'tool-calls-done' {
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  const choice = parsed?.choices?.[0];
  if (!choice) return;

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
      // Only the first chunk of a streamed tool call includes `type`/`id`;
      // continuation chunks that carry the rest of the arguments omit them.
      // Only reject a chunk that *explicitly* declares a non-function type.
      if (tc.type && tc.type !== 'function') continue;
      const idx = tc.index ?? 0;
      if (!toolCalls[idx]) {
        toolCalls[idx] = {
          id: tc.id ?? `call_${Date.now()}_${idx}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
      }
      const entry = toolCalls[idx]!;
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.function.name += tc.function.name;
      if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
    }
  }

  if (choice.finish_reason === 'tool_calls' && toolCalls.length > 0) {
    return 'tool-calls-done';
  }
  if (choice.finish_reason) {
    return 'finish-reason-seen';
  }
}
