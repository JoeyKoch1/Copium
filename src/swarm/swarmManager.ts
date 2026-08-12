import * as vscode from 'vscode';
import { ModelProvider } from '../providers';
import { SwarmAgent } from './agent';
import { MemoryBank } from './memoryBank';
import { ContextStore } from './contextStore';
import { SwarmAgentRole, SwarmTask } from './types';

export class SwarmManager {
  private agents = new Map<string, SwarmAgent>();
  private activeTasks = new Map<string, SwarmTask>();
  private memoryBank: MemoryBank;
  private contextStore: ContextStore;

  constructor(private provider: ModelProvider) {
    this.memoryBank = new MemoryBank();
    this.contextStore = new ContextStore();
  }

  async registerAgent(role: SwarmAgentRole): Promise<void> {
    const agent = new SwarmAgent(role, this.provider, this.memoryBank, this.contextStore);
    this.agents.set(role.id, agent);
  }

  async spawnTask(task: SwarmTask): Promise<Map<string, SwarmMessage[]>> {
    this.activeTasks.set(task.id, task);
    await this.contextStore.initialize(task.id);

    const results = new Map<string, SwarmMessage[]>();

    for (const role of task.roles) {
      const agent = this.agents.get(role.id);
      if (!agent) {
        vscode.window.showWarningMessage(`Swarm agent ${role.id} not registered`);
        continue;
      }

      const responses = await agent.execute(task);
      results.set(role.id, responses);
    }

    const allMessages = Array.from(results.values()).flat();
    await this.memoryBank.logInteraction(task.id, allMessages);

    this.activeTasks.delete(task.id);
    return results;
  }

  async getAgentStatus(agentId: string): Promise<{
    agentId: string;
    taskCount: number;
    lastActive: number;
  } | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    return {
      agentId,
      taskCount: this.activeTasks.size,
      lastActive: Date.now(),
    };
  }

  async getSharedFacts(): Promise<Record<string, string>> {
    return this.contextStore.getAllSharedFacts();
  }

  async compressCurrentMemory(sessionId: string): Promise<void> {
    await this.memoryBank.compressMemory(sessionId);
  }
}
