import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MemoryEntry, SwarmMessage } from './types';

export class MemoryBank {
  private swarmDir: string;
  private memoryDir: string;
  private logsDir: string;

  constructor(baseDir: string) {
    this.swarmDir = path.join(baseDir, '.swarm');
    this.memoryDir = path.join(this.swarmDir, 'memory');
    this.logsDir = path.join(this.swarmDir, 'logs');
  }

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  async logInteraction(
    sessionId: string,
    messages: SwarmMessage[],
    agentId?: string,
  ): Promise<void> {
    await this.ensureDirectories();

    const entry: MemoryEntry = {
      id: this.generateId(),
      sessionId,
      agentId,
      messages,
      tokensUsed: this.estimateTokens(messages),
      createdAt: Date.now(),
    };

    const filePath = path.join(this.memoryDir, `${sessionId}.jsonl`);
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
    const filePath = path.join(this.memoryDir, `${sessionId}.jsonl`);

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

    const filePath = path.join(this.memoryDir, `${sessionId}.jsonl`);
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
      const files = await fs.readdir(this.memoryDir);
      return files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''));
    } catch {
      return [];
    }
  }

  /** Gathers the most recent memory across all sessions, newest last. */
  async getGlobalRecentContext(maxEntries = 40): Promise<SwarmMessage[]> {
    await this.ensureDirectories();
    const sessions = await this.getAllSessions();
    if (sessions.length === 0) return [];

    let all: Array<{ timestamp: number; message: SwarmMessage }> = [];
    for (const session of sessions) {
      const entries = await this.getSessionMemory(session);
      for (const entry of entries) {
        for (const message of entry.messages) {
          all.push({ timestamp: message.timestamp ?? entry.createdAt, message });
        }
      }
    }

    all.sort((a, b) => a.timestamp - b.timestamp);
    return all.slice(-maxEntries).map((m) => m.message);
  }

  private async summarize(messages: SwarmMessage[]): Promise<string> {
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const assistantMessages = messages.filter((m) => m.role === 'assistant').map((m) => m.content);

    return `Compressed session summary: ${userMessages.length} user messages, ${assistantMessages.length} assistant responses. Topics: ${userMessages.slice(-5).join('; ')}`;
  }

  private async writeLog(
    category: string,
    sessionId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.ensureDirectories();
    const logPath = path.join(this.logsDir, `${category}.jsonl`);
    await fs.appendFile(logPath, JSON.stringify({ sessionId, ...data }) + '\n', 'utf-8');
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private estimateTokens(messages: SwarmMessage[]): number {
    return messages.reduce((total, m) => total + Math.ceil(m.content.length / 4), 0);
  }
}
