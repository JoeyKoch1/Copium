export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  listModels(): Promise<string[]>;
  sendChat(messages: ChatMessage[], callbacks: StreamCallbacks, tools?: ToolDefinition[]): Promise<ToolCall[] | null>;
}

export type PermissionLevel = 'read-only' | 'propose-edits' | 'auto-execute';
