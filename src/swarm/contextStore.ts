import { ContextSnapshot, SwarmMessage } from './types';

export class ContextStore {
  private contexts = new Map<string, ContextSnapshot>();
  private sharedFacts = new Map<string, { value: string; updatedAt: number }>();

  async initialize(taskId: string): Promise<ContextSnapshot> {
    const snapshot: ContextSnapshot = {
      sessionId: taskId,
      taskId,
      messages: [],
      memory: [],
      createdAt: Date.now(),
    };

    this.contexts.set(taskId, snapshot);
    return snapshot;
  }

  async addMessage(taskId: string, message: SwarmMessage): Promise<void> {
    const snapshot = this.contexts.get(taskId);
    if (!snapshot) return;

    snapshot.messages.push(message);

    if (snapshot.messages.length > 200) {
      snapshot.messages = snapshot.messages.slice(-100);
    }
  }

  async getContext(taskId: string, maxMessages = 40): Promise<SwarmMessage[]> {
    const snapshot = this.contexts.get(taskId);
    if (!snapshot) return [];

    const recent = snapshot.messages.slice(-maxMessages);
    const injected: SwarmMessage[] = [];

    for (const [key, fact] of this.sharedFacts) {
      injected.push({
        role: 'system',
        content: `[Shared Fact] ${key}: ${fact.value}`,
        timestamp: fact.updatedAt,
      });
    }

    return [...injected, ...recent];
  }

  async setSharedFact(key: string, value: string): Promise<void> {
    this.sharedFacts.set(key, { value, updatedAt: Date.now() });
  }

  async getSharedFact(key: string): Promise<string | null> {
    return this.sharedFacts.get(key)?.value ?? null;
  }

  async getAllSharedFacts(): Promise<Record<string, string>> {
    const facts: Record<string, string> = {};
    for (const [key, fact] of this.sharedFacts) {
      facts[key] = fact.value;
    }
    return facts;
  }
}
