import * as vscode from 'vscode';
import { BaseTool, ToolContext, ToolResult } from './baseTool';
import { SwarmManager } from '../swarm';

export class ReadFileTool extends BaseTool {
  name = 'readFile';
  description = 'Read the contents of a file.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file.' },
      startLine: { type: 'number', description: 'Optional starting line number (1-indexed).' },
      endLine: { type: 'number', description: 'Optional ending line number (1-indexed).' },
    },
    required: ['path'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof args.path === 'string' ? args.path : '';
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;

    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(context.workspaceRoot), path);
      const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
      if (!exists) {
        return { success: false, error: `File not found: ${path}` };
      }

      let text = await vscode.workspace.fs.readFile(uri).then((buf) => Buffer.from(buf).toString('utf-8'));
      const lines = text.split('\n');

      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
        text = lines.slice(start, end).join('\n');
      }

      return { success: true, data: { content: text, totalLines: lines.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class WriteFileTool extends BaseTool {
  name = 'writeFile';
  description = 'Write content to a file, overwriting existing content.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file.' },
      content: { type: 'string', description: 'File content to write.' },
    },
    required: ['path', 'content'],
  };

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return true;
  }

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';

    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(context.workspaceRoot), path);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      return { success: true, data: { path, bytes: Buffer.byteLength(content, 'utf-8') } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class SearchFilesTool extends BaseTool {
  name = 'searchFiles';
  description = 'Search for files by pattern or content in the workspace.';
  parameters = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.json".' },
      query: { type: 'string', description: 'Optional text to search within files.' },
      maxResults: { type: 'number', description: 'Maximum number of results to return.' },
    },
    required: ['pattern'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const query = typeof args.query === 'string' ? args.query : '';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;

    if (!context.workspaceRoot) {
      return { success: false, error: 'No workspace folder available. Open a folder in VS Code to use search.' };
    }

    try {
      const baseUri = vscode.Uri.file(context.workspaceRoot);
      const relativePattern = new vscode.RelativePattern(baseUri, pattern);
      const files = await vscode.workspace.findFiles(
        relativePattern,
        '**/node_modules/**',
        maxResults,
      );

      if (!query) {
        return { success: true, data: { files: files.map((u) => u.fsPath) } };
      }

      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const uri of files.slice(0, maxResults)) {
        try {
          const text = await vscode.workspace.fs.readFile(uri).then((buf) => Buffer.from(buf).toString('utf-8'));
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              matches.push({ path: uri.fsPath, line: i + 1, text: lines[i] });
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      return { success: true, data: { matches } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class RunCommandTool extends BaseTool {
  name = 'runCommand';
  description = 'Run a shell command in the workspace terminal with user confirmation.';
  parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
      cwd: { type: 'string', description: 'Optional working directory.' },
    },
    required: ['command'],
  };

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return true;
  }

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const command = typeof args.command === 'string' ? args.command : '';
    const cwd = typeof args.cwd === 'string' ? args.cwd : context.workspaceRoot;

    try {
      const terminal = vscode.window.createTerminal({
        name: 'Copium',
        cwd,
        shellPath: process.platform === 'win32' ? 'powershell.exe' : undefined,
      });
      terminal.sendText(command);
      terminal.show();
      return { success: true, data: { command, cwd } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class GetDiagnosticsTool extends BaseTool {
  name = 'getDiagnostics';
  description = 'Get diagnostics (errors/warnings) for a file or the whole workspace.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional file path. If omitted, returns workspace diagnostics.' },
      maxResults: { type: 'number', description: 'Maximum number of diagnostics to return.' },
    },
    required: [],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof args.path === 'string' ? args.path : undefined;
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 100;

    try {
      let diagnostics: vscode.Diagnostic[];
      if (path) {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(context.workspaceRoot), path);
        diagnostics = vscode.languages.getDiagnostics(uri);
      } else {
        const all: vscode.Diagnostic[] = [];
        for (const [, diags] of vscode.languages.getDiagnostics()) {
          all.push(...diags);
        }
        diagnostics = all;
      }

      const items = diagnostics
        .slice(0, maxResults)
        .map((d) => ({
          severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info',
          message: d.message,
          source: d.source,
          range: { start: d.range.start, end: d.range.end },
        }));

      return { success: true, data: { diagnostics: items, total: diagnostics.length } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class GitStatusTool extends BaseTool {
  name = 'gitStatus';
  description = 'Get the git status of the workspace.';
  parameters = {
    type: 'object',
    properties: {},
    required: [],
  };

  async execute(context: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const repos = await vscode.workspace.getWorkspaceFolder(vscode.Uri.file(context.workspaceRoot));
      if (!repos) {
        return { success: false, error: 'No workspace folder found' };
      }

      const rootUri = repos.uri;
      const result = await vscode.commands.executeCommand('git.status', rootUri);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class GitDiffTool extends BaseTool {
  name = 'gitDiff';
  description = 'Get the git diff for the workspace.';
  parameters = {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'If true, show staged changes.' },
    },
    required: [],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const repos = await vscode.workspace.getWorkspaceFolder(vscode.Uri.file(context.workspaceRoot));
      if (!repos) {
        return { success: false, error: 'No workspace folder found' };
      }

      const rootUri = repos.uri;
      const staged = typeof args.staged === 'boolean' ? args.staged : false;
      const result = await vscode.commands.executeCommand('git.diff', rootUri, staged ? '--staged' : undefined);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class GetDocumentSymbolsTool extends BaseTool {
  name = 'getDocumentSymbols';
  description = 'Get the symbol outline (functions, classes, etc.) for a file.';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file.' },
    },
    required: ['path'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const path = typeof args.path === 'string' ? args.path : '';
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(context.workspaceRoot), path);
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
      if (!symbols) {
        return { success: true, data: { symbols: [] } };
      }

      const flatten = (syms: vscode.DocumentSymbol[]): Array<{ name: string; kind: string; range: { start: { line: number }; end: { line: number } } }> => {
        const out: Array<{ name: string; kind: string; range: { start: { line: number }; end: { line: number } } }> = [];
        for (const s of syms) {
          out.push({
            name: s.name,
            kind: vscode.SymbolKind[s.symbol.kind] || String(s.kind),
            range: { start: s.range.start, end: s.range.end },
          });
          out.push(...flatten(s.children));
        }
        return out;
      };

      return { success: true, data: { symbols: flatten(symbols) } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class SpawnSwarmTool extends BaseTool {
  name = 'spawnSwarm';
  description = 'Spawn multiple autonomous agents in parallel with shared memory.';
  parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task for the swarm to accomplish.' },
      maxAgents: { type: 'number', description: 'Maximum number of agents to spawn.' },
    },
    required: ['task'],
  };

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return true;
  }

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const task = typeof args.task === 'string' ? args.task : '';
    const maxAgents = typeof args.maxAgents === 'number' ? args.maxAgents : 3;

    if (!task) {
      return { success: false, error: 'Task description is required for swarm mode.' };
    }

    try {
      const provider = await (await import('../settings')).createProvider();
      if (!provider) {
        return { success: false, error: 'No provider configured. Cannot spawn swarm agents.' };
      }

      const swarm = new SwarmManager(provider);

      await swarm.registerAgent({
        id: 'explorer',
        name: 'Explorer',
        description: 'Scans codebase and gathers context',
        systemPrompt: 'You are an explorer agent. Your job is to scan the codebase, find relevant files, and gather context. Be thorough and report file paths and key findings.',
      });

      await swarm.registerAgent({
        id: 'coder',
        name: 'Coder',
        description: 'Implements changes',
        systemPrompt: 'You are a coder agent. Your job is to implement changes based on the gathered context. Write clean, working code.',
      });

      await swarm.registerAgent({
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Reviews changes for correctness',
        systemPrompt: 'You are a reviewer agent. Your job is to review code changes for correctness, security, and best practices. Report issues clearly.',
      });

      const agents = [
        { id: 'explorer', name: 'Explorer' },
        { id: 'coder', name: 'Coder' },
        { id: 'reviewer', name: 'Reviewer' },
      ].slice(0, Math.min(maxAgents, 3));

      const results = await swarm.spawnTask({
        id: 'swarm_' + Date.now(),
        task,
        roles: agents,
        maxIterations: 3,
        createdAt: Date.now(),
      });

      const summaries: string[] = [];
      for (const [agentId, messages] of results) {
        const agent = agents.find((a) => a.id === agentId);
        const agentName = agent ? agent.name : agentId;
        summaries.push('[' + agentName + '] ' + messages.map((m) => m.content).join('\n'));
      }

      return { success: true, data: { result: summaries.join('\n\n') } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
