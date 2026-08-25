/** A content part for multimodal messages (text or image). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain text, or an array of text/image parts for vision models. */
  content: string | ContentPart[];
  tool_call_id?: string;
  name?: string;
  /** Present on an assistant message that requested one or more tool calls. */
  tool_calls?: ToolCall[];
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
  sendChat(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ToolCall[] | null>;
}

export type PermissionLevel = 'read-only' | 'propose-edits' | 'auto-execute' | 'bypass';
