import type { PermissionLevel, ToolDefinition } from '../providers/types';
import type { BaseTool, ToolContext, ToolResult } from './baseTool';
import {
  ReadFileTool,
  ReadImageTool,
  WriteFileTool,
  SearchFilesTool,
  ListFilesTool,
  GrepFilesTool,
  ApplyEditTool,
  WebFetchTool,
  WebSearchTool,
  RunCommandTool,
  GitStatusTool,
  GitDiffTool,
  GitCommitTool,
  SpawnSwarmTool,
} from './tools';
import type { SwarmToolContext } from './tools';

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.register(new ReadFileTool());
    this.register(new ReadImageTool());
    this.register(new WriteFileTool());
    this.register(new ListFilesTool());
    this.register(new SearchFilesTool());
    this.register(new GrepFilesTool());
    this.register(new ApplyEditTool());
    this.register(new WebFetchTool());
    this.register(new WebSearchTool());
    this.register(new RunCommandTool());
    this.register(new GitStatusTool());
    this.register(new GitDiffTool());
    this.register(new GitCommitTool());
    this.register(new SpawnSwarmTool());
  }

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return Promise.resolve({ success: false, error: `Unknown tool: ${name}` });
    }
    return tool.run(context, args);
  }
}

export type { SwarmToolContext };
export { BaseTool } from './baseTool';
export type { ToolContext, ToolResult } from './baseTool';
export type { PermissionLevel } from '../providers/types';
