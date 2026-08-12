import * as vscode from 'vscode';
import { ChatMessage, StreamCallbacks } from '../providers';
import { createProvider, getPermissionLevel } from '../settings';
import { ToolRegistry } from '../agent/toolRegistry';

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('@copium', 'Copium');

  participant.onDidReceiveChatSendInvocation(async (invocation) => {
    const provider = await createProvider();
    if (!provider) {
      invocation.responseStream.write(
        'Copium needs a provider configured. Open Settings (Ctrl+,) and search for "Copium" to set up OpenRouter, BYOK, or Ollama.\n',
      );
      invocation.responseStream.end();
      return;
    }

    const toolRegistry = new ToolRegistry(getPermissionLevel());
    const tools = toolRegistry.getDefinitions();

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are Copium, a helpful coding agent. Use tools when needed. Always confirm destructive actions.' },
      { role: 'user', content: invocation.prompt },
    ];

    const callbacks: StreamCallbacks = {
      onToken: (token) => invocation.responseStream.write(token),
      onDone: () => invocation.responseStream.end(),
      onError: (error) => {
        invocation.responseStream.write(`\n\nError: ${error.message}`);
        invocation.responseStream.end();
      },
    };

    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
      const toolCalls = await provider.sendChat(messages, callbacks, tools);
      if (!toolCalls) {
        break;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: '',
      };
      messages.push(assistantMessage);

      for (const tc of toolCalls) {
        const result = await toolRegistry.execute(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
        messages.push({
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }

    callbacks.onDone();
  });

  context.subscriptions.push(participant);
}
