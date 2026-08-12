import * as vscode from 'vscode';
import { ToolDefinition, PermissionLevel } from '../providers';
import { BaseTool, ToolContext, ToolResult } from './baseTool';
import {
  ReadFileTool,
  WriteFileTool,
  SearchFilesTool,
  RunCommandTool,
  GetDiagnosticsTool,
  GitStatusTool,
  GitDiffTool,
  GetDocumentSymbolsTool,
} from './tools';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new SearchFilesTool());
    this.register(new RunCommandTool());
    this.register(new GetDiagnosticsTool());
    this.register(new GitStatusTool());
    this.register(new GitDiffTool());
    this.register(new GetDocumentSymbolsTool());
  }

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    const context: ToolContext = {
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      permissionLevel: vscode.workspace.getConfiguration('copium').get<string>('permissionLevel', 'propose-edits') as PermissionLevel,
      confirmAction: async (message: string) => {
        const choice = await vscode.window.showWarningMessage(message, 'Allow', 'Deny');
        return choice === 'Allow';
      },
    };

    return tool.run(context, args);
  }
}
