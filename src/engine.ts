import * as path from 'node:path';
import { ChatMessage, ModelProvider, StreamCallbacks } from './providers/types';
import { CopiumConfig } from './config/types';
import { ToolRegistry } from './agent/toolRegistry';
import { ToolContext } from './agent/baseTool';
import { SwarmManager } from './swarm/swarmManager';
import { SwarmTask, SwarmMessage } from './swarm/types';
import { MemoryBank } from './swarm/memoryBank';
import { buildSystemPrompt } from './prompt';
import { loadSkills, selectAutoSkills, Skill } from './skills/loader';

export interface ChatCallbacks {
  onToken: (token: string) => void;
  onStatus: (status: string) => void;
  onToolCall: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult: (toolName: string, result: unknown) => void;
  onMessage: (role: 'assistant' | 'tool', content: string) => void;
  /** Structured file-edit event for diff rendering (applyEdit/writeFile). */
  onFileEdit?: (path: string, kind: 'write' | 'edit', before: string | null, after: string) => void;
  /** Optional plugin lifecycle hook emitter. */
  emitPluginEvent?: (event: 'turn-start' | 'turn-end' | 'tool-call', payload?: unknown) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  confirm: (message: string, toolName?: string) => Promise<boolean>;
}

/** Permission levels that never prompt. */
const BYPASS_LEVELS: Array<CopiumConfig['permissionLevel']> = ['auto-execute', 'bypass'];

export class ChatEngine {
  private messages: ChatMessage[] = [];
  private memoryBank: MemoryBank;
  private sessionId: string;
  private hasErrored = false;
  /** Aborts the in-flight provider stream when the user presses Escape. */
  private activeAbort?: AbortController;
  /** Set while a user interrupt is pending for the current stream. */
  private interrupted = false;

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

  /** Abort the in-flight provider stream. Partial output is kept in history. */
  interrupt(): void {
    if (this.activeAbort && !this.activeAbort.signal.aborted) {
      this.interrupted = true;
      this.activeAbort.abort();
    }
  }

  isBusy(): boolean {
    return this.activeAbort !== undefined;
  }

  /** Replace engine conversation history (session resume). */
  restoreMessages(messages: ChatMessage[]): void {
    this.messages = messages;
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

    this.callbacks.emitPluginEvent?.('turn-start', { prompt: trimmed });
    this.activeAbort = new AbortController();
    this.interrupted = false;

    try {
    const systemPrompt = buildSystemPrompt(
      this.config,
      this.workspaceRoot,
      this.toolRegistry.getDefinitions(),
      await this.buildSkillPrompt(trimmed),
    );

    const maxIterations = 25;
    let hitIterationCap = false;
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
        this.activeAbort.signal,
      );

      // User pressed Escape mid-stream — keep partial output and stop the turn.
      if (this.interrupted) {
        if (assistantContent.length > 0) {
          this.messages.push({ role: 'assistant', content: assistantContent });
          this.callbacks.onMessage('assistant', '_[interrupted]_');
        }
        return;
      }

      if (this.hasErrored) break;

      if (!toolCalls || toolCalls.length === 0) {
        if (assistantContent.length > 0) {
          this.messages.push({ role: 'assistant', content: assistantContent });
        } else if (!this.hasErrored) {
          // Stream completed cleanly but produced neither text nor tool calls.
          // Surface it instead of silently ending the turn.
          this.hasErrored = true;
          this.callbacks.onError(new Error('Provider returned an empty completion'));
        }
        break;
      }

      // Record the assistant's tool-call request once, with the tool_calls
      // it made attached, so the follow-up 'tool' role messages have a
      // valid preceding message to respond to.
      this.messages.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const args = safeParse(tc.function.arguments);
        this.callbacks.emitPluginEvent?.('tool-call', { tool: tc.function.name, args });
        this.callbacks.onToolCall(tc.function.name, args);
        const toolContext = this.buildToolContext();
        let result;
        try {
          // Capture pre-edit content for diff rendering.
          let beforeContent: string | null = null;
          const editPath = typeof args.path === 'string' ? args.path : '';
          if (
            (tc.function.name === 'writeFile' || tc.function.name === 'applyEdit') &&
            editPath
          ) {
            try {
              beforeContent = await import('node:fs/promises').then((f) =>
                f.readFile(this.resolveWorkspacePath(editPath), 'utf-8'),
              );
            } catch {
              beforeContent = null; // new file
            }
          }

          result = await this.toolRegistry.execute(tc.function.name, args, toolContext);

          if (result.success && (tc.function.name === 'writeFile' || tc.function.name === 'applyEdit')) {
            const after =
              tc.function.name === 'writeFile'
                ? typeof args.content === 'string'
                  ? args.content
                  : ''
                : await import('node:fs/promises')
                    .then((f) => f.readFile(this.resolveWorkspacePath(editPath), 'utf-8'))
                    .catch(() => '');
            this.callbacks.onFileEdit?.(editPath, tc.function.name as 'write' | 'edit', beforeContent, after);
          }
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

        // If a readImage result came back, append it as a user-visible image
        // part so vision models can actually see it on the next request.
        const imageDataUrl = extractImageDataUrl(result);
        if (imageDataUrl) {
          this.messages.push({
            role: 'user',
            content: [
              { type: 'text', text: '[Image attached from readImage — analyze it in context of the task]' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          });
        }

        this.callbacks.onToolResult(tc.function.name, result);
        this.callbacks.onMessage('tool', renderToolResult(result));
      }
      if (i === maxIterations - 1) hitIterationCap = true;
    }

    if (hitIterationCap) {
      this.messages.push({
        role: 'assistant',
        content: '_Stopped: reached the tool-round limit mid-task. Ask me to continue if the task is incomplete._',
      });
      this.callbacks.onMessage(
        'assistant',
        '**Stopped** after the maximum number of tool rounds — the task may be incomplete. Say "continue" to resume.',
      );
    }

    await this.persistMemory(trimmed);
    this.callbacks.onDone();
    this.callbacks.emitPluginEvent?.('turn-end', { prompt: trimmed });
    } finally {
      this.activeAbort = undefined;
      this.interrupted = false;
    }
  }

  private resolveWorkspacePath(input: string): string {
    return path.isAbsolute(input) ? input : path.join(this.workspaceRoot, input);
  }

  /** Skills explicitly invoked for the next turn (via /skill <name>). */
  private forcedSkills: string[] = [];

  /** Queue a manual skill to be injected on the next send(). */
  queueManualSkill(name: string): void {
    this.forcedSkills.push(name);
  }

  /**
   * Build the skills section of the system prompt: auto-triggered skills whose
   * keywords match the user prompt, plus any manually-queued skill.
   */
  private async buildSkillPrompt(userPrompt: string): Promise<string> {
    let skills: Skill[] = [];
    try {
      skills = await loadSkills(this.workspaceRoot);
    } catch {
      return '';
    }
    if (skills.length === 0) return '';

    const auto = selectAutoSkills(skills, userPrompt);
    const forced: Skill[] = [];
    for (const name of this.forcedSkills.splice(0)) {
      const s = skills.find((x) => x.name === name);
      if (s) forced.push(s);
    }

    const active = [...new Map([...auto, ...forced].map((s) => [s.name, s])).values()];
    if (active.length === 0) return '';

    const sections = active
      .map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`)
      .join('\n\n');
    return `\n\n# Active Skills\n\nThe following project/user skills are ACTIVE for this request. Follow their instructions:\n\n${sections}`;
  }

  private buildToolContext(): ToolContext {
    return {
      workspaceRoot: this.workspaceRoot,
      permissionLevel: this.config.permissionLevel,
      confirmAction: (message: string, toolName?: string) =>
        BYPASS_LEVELS.includes(this.config.permissionLevel)
          ? Promise.resolve(true)
          : this.callbacks.confirm(message, toolName),
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

    const roles = swarm.getRegisteredRoles();

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

  /** Cached memory context — loaded once per session, not on every message. */
  private memoryContextCache?: ChatMessage[];

  private async loadMemoryContext(): Promise<ChatMessage[]> {
    if (this.memoryContextCache) return this.memoryContextCache;
    const messages = await this.memoryBank.getGlobalRecentContext(40);
    if (messages.length === 0) return [];
    const summary = messages.map((m) => m.content).join('\n').slice(0, 2000);
    this.memoryContextCache = [
      {
        role: 'system',
        content: `Previous Copium session context:\n${summary}`,
      },
    ];
    return this.memoryContextCache;
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
      .find((m) => m.role === 'assistant' && messageText(m).length > 0);
    if (assistant) {
      messages.push({
        role: 'assistant',
        content: messageText(assistant),
        timestamp: Date.now(),
      });
    }
    await this.memoryBank.logInteraction(this.sessionId, messages);
  }
}

/** Extract an image data URL from a readImage tool result, if present. */
function extractImageDataUrl(result: unknown): string | null {
  if (
    result &&
    typeof result === 'object' &&
    'data' in result &&
    result.data &&
    typeof result.data === 'object' &&
    'imageDataUrl' in result.data &&
    typeof (result.data as { imageDataUrl?: unknown }).imageDataUrl === 'string'
  ) {
    return (result.data as { imageDataUrl: string }).imageDataUrl;
  }
  return null;
}

/** Extract plain text from a message whose content may include image parts. */
function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content
    .map((p) => (p.type === 'text' ? p.text : '[image]'))
    .join('\n');
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
