import type { PermissionLevel, ToolDefinition } from '../providers/types';
import type { ModelProvider } from '../providers/types';
import type { CopiumConfig } from '../config';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  workspaceRoot: string;
  permissionLevel: PermissionLevel;
  confirmAction: (message: string, toolName?: string) => Promise<boolean>;
  provider?: ModelProvider | null;
  config?: CopiumConfig;
}

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: ToolDefinition['parameters'];

  /** True if this tool mutates the workspace and is blocked in read-only mode. */
  protected isWrite: boolean = false;

  abstract execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return this.isWrite;
  }

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (context.permissionLevel === 'read-only' && this.isWrite) {
      return { success: false, error: 'Permission denied: write operations blocked in read-only mode' };
    }

    if (this.requiresConfirmation(args) && context.permissionLevel !== 'auto-execute') {
      const confirmed = await context.confirmAction(
        `Copium wants to ${this.description}. Allow?`,
        this.name,
      );
      if (!confirmed) {
        return { success: false, error: 'User denied permission' };
      }
    }

    return this.execute(context, args);
  }
}