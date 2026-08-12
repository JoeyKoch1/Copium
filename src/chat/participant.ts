import * as vscode from 'vscode';
import { ChatMessage, StreamCallbacks } from '../providers';
import { createProvider, getPermissionLevel, getSwarmEnabled, getSwarmMaxAgents } from '../settings';
import { ToolRegistry } from '../agent/toolRegistry';
import { SwarmManager, SwarmTask, SwarmAgentRole } from '../swarm';

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant('@copium', (request, _context, response, _token) => {
    handleRequest(request, response);
  });

  context.subscriptions.push(participant);
}

async function handleRequest(request: vscode.ChatRequest, response: vscode.ChatResponseStream): Promise<void> {
  const provider = await createProvider();
  if (!provider) {
    response.write('Copium needs a provider configured. Open Settings (Ctrl+,) and search for "Copium" to set up OpenRouter, BYOK, or Ollama.\n');
    response.end();
    return;
  }

  const prompt = request.prompt.trim();
  const swarmEnabled = getSwarmEnabled();
  const maxAgents = getSwarmMaxAgents();

  if (swarmEnabled && prompt.startsWith('/swarm')) {
    await handleSwarmMode(provider, response, prompt.replace('/swarm', '').trim(), maxAgents);
    return;
  }

  const toolRegistry = new ToolRegistry(getPermissionLevel());
  const tools = toolRegistry.getDefinitions();

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are Copium, a helpful coding agent. Use tools when needed. Always confirm destructive actions. You have access to a spawnSwarm tool that launches multiple autonomous agents in parallel for complex tasks. Use it when the task requires parallel exploration, coding, and review.' },
    { role: 'user', content: prompt },
  ];

  const callbacks: StreamCallbacks = {
    onToken: (token) => response.write(token),
    onDone: () => response.end(),
    onError: (error) => {
      response.write(`\n\nError: ${error.message}`);
      response.end();
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
}

async function handleSwarmMode(
  provider: ModelProvider,
  stream: vscode.ChatResponseStream,
  prompt: string,
  maxAgents: number,
): Promise<void> {
  const swarm = new SwarmManager(provider);

  await swarm.registerAgent({
    id: 'explorer',
    name: 'Explorer',
    description: 'Scans codebase and gathers context',
    systemPrompt: 'You are an explorer agent. Your job is to scan the codebase, find relevant files, and gather context. Be thorough and report file paths and key findings.',
  });

  await swarm.registerAgent({
    id: 'coder',
    name: 'Coder',
    description: 'Implements changes',
    systemPrompt: 'You are a coder agent. Your job is to implement changes based on the gathered context. Write clean, working code.',
  });

  await swarm.registerAgent({
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews changes for correctness',
    systemPrompt: 'You are a reviewer agent. Your job is to review code changes for correctness, security, and best practices. Report issues clearly.',
  });

  const registeredRoles: SwarmAgentRole[] = [];
  for (const [, agent] of swarm['agents']) {
    registeredRoles.push(agent.role);
  }

  const task: SwarmTask = {
    id: `swarm_${Date.now()}`,
    prompt,
    roles: registeredRoles.slice(0, maxAgents),
    maxIterations: 3,
    createdAt: Date.now(),
  };

  stream.write(`[Swarm] Starting ${task.roles.length} agents...\n`);

  try {
    const results = await swarm.spawnTask(task);
    for (const [agentId, messages] of results) {
      stream.write(`\n[Swarm/${agentId}] ${messages.map((m) => m.content).join('\n')}\n`);
    }
    stream.write('\n[Swarm] Task complete.\n');
  } catch (error) {
    stream.write(`\n[Swarm] Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  }

  stream.end();
}
