import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ChatEngine } from '../../src/engine';
import { ToolRegistry } from '../../src/agent';
import { DEFAULT_CONFIG } from '../../src/config';
import type { ChatMessage, ModelProvider, StreamCallbacks, ToolCall, ToolDefinition } from '../../src/providers/types';

/**
 * A fake provider that returns one tool call on its first invocation, then
 * no tool calls on the second (as if the model was satisfied by the tool
 * result). Records every `messages` array it was called with so the test
 * can assert on exactly what history gets sent back to the "model".
 */
class ScriptedProvider implements ModelProvider {
  readonly id = 'scripted';
  readonly name = 'Scripted';
  calls: ChatMessage[][] = [];
  private turn = 0;

  async listModels(): Promise<string[]> {
    return [];
  }

  async sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    _tools?: ToolDefinition[],
  ): Promise<ToolCall[] | null> {
    this.calls.push(messages.map((m) => ({ ...m })));
    this.turn += 1;

    if (this.turn === 1) {
      callbacks.onDone();
      const toolCall: ToolCall = {
        id: 'call_1',
        type: 'function',
        function: { name: 'readFile', arguments: JSON.stringify({ path: 'README.md' }) },
      };
      return [toolCall];
    }

    callbacks.onToken('All done.');
    callbacks.onDone();
    return null;
  }
}

describe('ChatEngine tool-call turn handling', () => {
  let workspaceRoot: string;

  afterEach(async () => {
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('records exactly one assistant message per turn, with tool_calls attached', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'copium-engine-test-'));
    const provider = new ScriptedProvider();
    const registry = new ToolRegistry();

    const events: string[] = [];
    const engine = new ChatEngine(provider, DEFAULT_CONFIG, registry, workspaceRoot, {
      onToken: () => {},
      onStatus: () => {},
      onToolCall: (name) => events.push(`toolCall:${name}`),
      onToolResult: (name) => events.push(`toolResult:${name}`),
      onMessage: () => {},
      onDone: () => events.push('done'),
      onError: (err) => events.push(`error:${err.message}`),
      confirm: async () => true,
    });

    await engine.send('read the readme');

    expect(events).toContain('toolCall:readFile');
    expect(events).toContain('done');
    expect(events.some((e) => e.startsWith('error'))).toBe(false);

    // Two turns: the tool-call round, and the follow-up after the tool result.
    expect(provider.calls).toHaveLength(2);

    const secondTurnMessages = provider.calls[1]!;
    const assistantMessages = secondTurnMessages.filter((m) => m.role === 'assistant');

    // Regression check: previously the assistant message was pushed twice
    // per tool-calling turn (once conditionally, once unconditionally).
    expect(assistantMessages).toHaveLength(1);

    // Regression check: the assistant message must carry the tool_calls it
    // made, so the following 'tool' role message has a valid antecedent
    // per the OpenAI-compatible chat API contract.
    expect(assistantMessages[0]!.tool_calls).toBeDefined();
    expect(assistantMessages[0]!.tool_calls).toHaveLength(1);
    expect(assistantMessages[0]!.tool_calls![0]!.function.name).toBe('readFile');

    // The tool result message must immediately follow the assistant message
    // and reference the same tool_call_id.
    const assistantIdx = secondTurnMessages.indexOf(assistantMessages[0]!);
    const toolMsg = secondTurnMessages[assistantIdx + 1]!;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
  });
});
