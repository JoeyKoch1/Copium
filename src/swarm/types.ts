export interface SwarmAgentRole {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
}

export interface SwarmTask {
  id: string;
  prompt: string;
  roles: SwarmAgentRole[];
  maxIterations: number;
  createdAt: number;
}

export interface SwarmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  agentId?: string;
  timestamp: number;
}

export interface MemoryEntry {
  id: string;
  sessionId: string;
  agentId?: string;
  messages: SwarmMessage[];
  summary?: string;
  tokensUsed: number;
  createdAt: number;
  compressedAt?: number;
}

export interface ContextSnapshot {
  sessionId: string;
  taskId?: string;
  messages: SwarmMessage[];
  memory: MemoryEntry[];
  createdAt: number;
}
