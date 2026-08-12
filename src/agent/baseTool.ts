import { ToolDefinition, PermissionLevel } from '../providers';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  workspaceRoot: string;
  permissionLevel: PermissionLevel;
  confirmAction: (message: string) => Promise<boolean>;
}

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: ToolDefinition['parameters'];

  abstract execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return false;
  }

  async run(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (context.permissionLevel === 'read-only' && this.isWriteOperation(args)) {
      return { success: false, error: 'Permission denied: write operations blocked in read-only mode' };
    }

    if (this.requiresConfirmation(args) && context.permissionLevel !== 'auto-execute') {
      const confirmed = await context.confirmAction(
        `Copium wants to ${this.description}. Allow?`,
      );
      if (!confirmed) {
        return { success: false, error: 'User denied permission' };
      }
    }

    return this.execute(context, args);
  }

  private isWriteOperation(_args: Record<string, unknown>): boolean {
    return this.name === 'writeFile' || this.name === 'runCommand' || this.name === 'gitCommit';
  }
}
