import { ModelProvider, ChatMessage, StreamCallbacks } from '../providers/types';
import { SwarmAgentRole, SwarmTask, SwarmMessage } from './types';
import { MemoryBank } from './memoryBank';
import { ContextStore } from './contextStore';

export interface AgentLogger {
  log: (message: string) => void;
}

export class SwarmAgent {
  readonly id: string;
  readonly role: SwarmAgentRole;
  readonly provider: ModelProvider;

  constructor(
    role: SwarmAgentRole,
    provider: ModelProvider,
    private memoryBank: MemoryBank,
    private contextStore: ContextStore,
    private logger?: AgentLogger,
  ) {
    this.id = role.id;
    this.role = role;
    this.provider = provider;
  }

  async execute(task: SwarmTask): Promise<SwarmMessage[]> {
    const context = await this.contextStore.getContext(task.id, 60);
    const messages: SwarmMessage[] = [
      {
        role: 'system',
        content: this.role.systemPrompt,
        agentId: this.id,
        timestamp: Date.now(),
      },
      ...context,
    ];

    const responses: SwarmMessage[] = [];

    for (const msg of task.prompt.split('\n').filter((line) => line.trim().length > 0)) {
      messages.push({
        role: 'user',
        content: msg,
        agentId: this.id,
        timestamp: Date.now(),
      });

      const chatMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let fullResponse = '';
      const callbacks: StreamCallbacks = {
        onToken: (token) => {
          fullResponse += token;
        },
        onDone: () => {},
        onError: (error) => {
          this.logger?.log(`Agent ${this.id} error: ${error.message}`);
        },
      };

      await this.provider.sendChat(chatMessages, callbacks);

      const responseMessage: SwarmMessage = {
        role: 'assistant',
        content: fullResponse,
        agentId: this.id,
        timestamp: Date.now(),
      };

      messages.push(responseMessage);
      responses.push(responseMessage);
      await this.contextStore.addMessage(task.id, responseMessage);
    }

    await this.memoryBank.logInteraction(task.id, responses, this.id);

    return responses;
  }
}
