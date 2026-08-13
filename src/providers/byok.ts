import type { ChatMessage, ModelProvider, StreamCallbacks, ToolCall, ToolDefinition } from './types';
import { streamChatCompletions } from './sse';

export class BYOKProvider implements ModelProvider {
  readonly id = 'byok';
  readonly name = 'Bring Your Own Key';

  constructor(
    private endpoint: string,
    private apiKey: string,
    private model: string,
  ) {}

  async listModels(): Promise<string[]> {
    return [this.model];
  }

  async sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    tools?: ToolDefinition[],
  ): Promise<ToolCall[] | null> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    return streamChatCompletions(
      `${this.endpoint}/chat/completions`,
      body,
      {
        Authorization: `Bearer ${this.apiKey}`,
      },
      callbacks,
    );
  }
}
