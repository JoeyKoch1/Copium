import * as path from 'node:path';
import { ChatMessage, ModelProvider, StreamCallbacks } from './providers/types';
import { CopiumConfig } from './config/types';
import { ToolRegistry } from './agent/toolRegistry';
import { ToolContext } from './agent/baseTool';
import { SwarmManager } from './swarm/swarmManager';
import { SwarmAgentRole, SwarmTask, SwarmMessage } from './swarm/types';
import { MemoryBank } from './swarm/memoryBank';
import { buildSystemPrompt } from './prompt';

export interface ChatCallbacks {
  onToken: (token: string) => void;
  onStatus: (status: string) => void;
  onToolCall: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult: (toolName: string, result: unknown) => void;
  onMessage: (role: 'assistant' | 'tool', content: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  confirm: (message: string) => Promise<boolean>;
}

export class ChatEngine {
  private messages: ChatMessage[] = [];
  private memoryBank: MemoryBank;
  private sessionId: string;
  private hasErrored = false;

  constructor(
    private provider: ModelProvider,
    private config: CopiumConfig,
    private toolRegistry: ToolRegistry,
    private workspaceRoot: string,
    private callbacks: ChatCallbacks,
  ) {
    this.sessionId = `chat_${Date.now()}`;
    this.memoryBank = new MemoryBank(workspaceRoot);
  }

  setProvider(provider: ModelProvider): void {
    this.provider = provider;
  }

  getProvider(): ModelProvider {
    return this.provider;
  }

  getConfig(): CopiumConfig {
    return this.config;
  }

  getToolList(): string[] {
    return this.toolRegistry.listTools();
  }

  async send(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    this.callbacks.onStatus('thinking...');
    this.hasErrored = false;

    // Load any recent memory from previous sessions to give the model context.
    const recentContext = await this.loadMemoryContext();

    if (trimmed.startsWith('/swarm')) {
      await this.handleSwarm(trimmed.replace('/swarm', '').trim(), this.config.swarm.maxAgents);
      return;
    }

    this.messages.push({ role: 'user', content: trimmed });

    const systemPrompt = buildSystemPrompt(
      this.config,
      this.workspaceRoot,
      this.toolRegistry.getDefinitions(),
    );

    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
      let assistantContent = '';
      const callbacks: StreamCallbacks = {
        onToken: (token) => {
          assistantContent += token;
          this.callbacks.onToken(token);
        },
        onDone: () => {},
        onError: (error) => {
          this.hasErrored = true;
          this.callbacks.onError(error);
        },
      };

      const toolCalls = await this.provider.sendChat(
        [...recentContext, { role: 'system', content: systemPrompt }, ...this.messages],
        callbacks,
        this.toolRegistry.getDefinitions(),
      );

      if (this.hasErrored) break;

      if (assistantContent.length > 0) {
        this.messages.push({ role: 'assistant', content: assistantContent });
      }

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      this.messages.push({ role: 'assistant', content: assistantContent });

      for (const tc of toolCalls) {
        this.callbacks.onToolCall(tc.function.name, safeParse(tc.function.arguments));
        const toolContext = this.buildToolContext();
        let result;
        try {
          result = await this.toolRegistry.execute(
            tc.function.name,
            safeParse(tc.function.arguments),
            toolContext,
          );
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        const content = JSON.stringify(result);
        this.messages.push({
          role: 'tool',
          content,
          tool_call_id: tc.id,
          name: tc.function.name,
        });

        this.callbacks.onToolResult(tc.function.name, result);
        this.callbacks.onMessage('tool', renderToolResult(result));
      }
    }

    await this.persistMemory(trimmed);
    this.callbacks.onDone();
  }

  private buildToolContext(): ToolContext {
    return {
      workspaceRoot: this.workspaceRoot,
      permissionLevel: this.config.permissionLevel,
      confirmAction: (message: string) => this.callbacks.confirm(message),
      provider: this.provider,
      config: this.config,
    };
  }

  private async handleSwarm(prompt: string, maxAgents: number): Promise<void> {
    this.callbacks.onStatus(`[Swarm] starting ${maxAgents} agents...`);

    const swarm = new SwarmManager(this.provider, this.workspaceRoot, {
      log: (message) => this.callbacks.onStatus(`[Swarm] ${message}`),
    });

    await swarm.registerAgent({
      id: 'explorer',
      name: 'Explorer',
      description: 'Scans codebase and gathers context',
      systemPrompt:
        'You are an explorer agent. Your job is to scan the codebase, find relevant files, and gather context. Be thorough and report file paths and key findings.',
    });

    await swarm.registerAgent({
      id: 'coder',
      name: 'Coder',
      description: 'Implements changes',
      systemPrompt:
        'You are a coder agent. Your job is to implement changes based on the gathered context. Write clean, working code.',
    });

    await swarm.registerAgent({
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Reviews changes for correctness',
      systemPrompt:
        'You are a reviewer agent. Your job is to review code changes for correctness, security, and best practices. Report issues clearly.',
    });

    const roles: SwarmAgentRole[] = [];
    for (const [, agent] of (swarm as any)['agents']) {
      roles.push(agent.role);
    }

    const task: SwarmTask = {
      id: `swarm_${Date.now()}`,
      prompt,
      roles: roles.slice(0, maxAgents),
      maxIterations: 3,
      createdAt: Date.now(),
    };

    try {
      const results = await swarm.spawnTask(task);
      for (const [agentId, messages] of results) {
        this.callbacks.onMessage(
          'assistant',
          `[Swarm/${agentId}]\n${messages.map((m) => m.content).join('\n')}`,
        );
      }
      this.callbacks.onStatus('[Swarm] task complete.');
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async loadMemoryContext(): Promise<ChatMessage[]> {
    const messages = await this.memoryBank.getGlobalRecentContext(40);
    if (messages.length === 0) return [];
    const summary = messages.map((m) => m.content).join('\n').slice(0, 2000);
    return [
      {
        role: 'system',
        content: `Previous Copium session context:\n${summary}`,
      },
    ];
  }

  private async persistMemory(prompt: string): Promise<void> {
    const messages: SwarmMessage[] = [
      {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      },
    ];
    // Capture the last assistant text for context.
    const assistant = [...this.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.content.length > 0);
    if (assistant) {
      messages.push({
        role: 'assistant',
        content: assistant.content,
        timestamp: Date.now(),
      });
    }
    await this.memoryBank.logInteraction(this.sessionId, messages);
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function renderToolResult(result: { success: boolean; data?: unknown; error?: string }): string {
  if (!result.success) {
    return `Tool failed: ${result.error}`;
  }
  try {
    return JSON.stringify(result.data ?? {}, null, 2);
  } catch {
    return String(result.data ?? '');
  }
}
