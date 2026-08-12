import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryEntry, SwarmMessage } from './types';

const SWARM_DIR = '.swarm';
const MEMORY_DIR = path.join(SWARM_DIR, 'memory');
const LOGS_DIR = path.join(SWARM_DIR, 'logs');

export class MemoryBank {
  async ensureDirectories(): Promise<void> {
    await fs.mkdir(SWARM_DIR, { recursive: true });
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });
  }

  async logInteraction(sessionId: string, messages: SwarmMessage[], agentId?: string): Promise<void> {
    await this.ensureDirectories();

    const entry: MemoryEntry = {
      id: this.generateId(),
      sessionId,
      agentId,
      messages,
      tokensUsed: this.estimateTokens(messages),
      createdAt: Date.now(),
    };

    const filePath = path.join(MEMORY_DIR, `${sessionId}.jsonl`);
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');

    await this.writeLog('interactions', sessionId, {
      type: 'interaction',
      entryId: entry.id,
      messageCount: messages.length,
      timestamp: entry.createdAt,
    });
  }

  async getSessionMemory(sessionId: string): Promise<MemoryEntry[]> {
    await this.ensureDirectories();
    const filePath = path.join(MEMORY_DIR, `${sessionId}.jsonl`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      const entries: MemoryEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as MemoryEntry);
        } catch {
          // skip corrupted lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  async compressMemory(sessionId: string): Promise<MemoryEntry | null> {
    const entries = await this.getSessionMemory(sessionId);
    if (entries.length === 0) return null;

    const allMessages = entries.flatMap((e) => e.messages);
    const summary = await this.summarize(allMessages);

    const compressed: MemoryEntry = {
      id: this.generateId(),
      sessionId,
      messages: allMessages.slice(-20),
      summary,
      tokensUsed: this.estimateTokens(allMessages),
      createdAt: Date.now(),
      compressedAt: Date.now(),
    };

    const filePath = path.join(MEMORY_DIR, `${sessionId}.jsonl`);
    await fs.writeFile(filePath, JSON.stringify(compressed) + '\n', 'utf-8');

    await this.writeLog('compression', sessionId, {
      type: 'compression',
      originalEntries: entries.length,
      compressedId: compressed.id,
      timestamp: Date.now(),
    });

    return compressed;
  }

  async getRecentContext(sessionId: string, maxMessages = 40): Promise<SwarmMessage[]> {
    const entries = await this.getSessionMemory(sessionId);
    const allMessages = entries.flatMap((e) => e.messages);
    return allMessages.slice(-maxMessages);
  }

  async getAllSessions(): Promise<string[]> {
    await this.ensureDirectories();
    try {
      const files = await fs.readdir(MEMORY_DIR);
      return files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''));
    } catch {
      return [];
    }
  }

  private async summarize(messages: SwarmMessage[]): Promise<string> {
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const assistantMessages = messages.filter((m) => m.role === 'assistant').map((m) => m.content);

    return `Compressed session summary: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses. Topics: ${userMessages.slice(-5).join('; ')}`;
  }

  private async writeLog(category: string, sessionId: string, data: Record<string, unknown>): Promise<void> {
    await this.ensureDirectories();
    const logPath = path.join(LOGS_DIR, `${category}.jsonl`);
    await fs.appendFile(logPath, JSON.stringify({ sessionId, ...data }) + '\n', 'utf-8');
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private estimateTokens(messages: SwarmMessage[]): number {
    return messages.reduce((total, m) => total + Math.ceil(m.content.length / 4), 0);
  }
}
