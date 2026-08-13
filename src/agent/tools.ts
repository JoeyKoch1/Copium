import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BaseTool } from './baseTool';
import type { ToolContext, ToolResult } from './baseTool';
import { SwarmManager } from '../swarm';
import { DEFAULT_SWARM_ROLES } from '../swarm/roles';
import type { ToolDefinition } from '../providers/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface SwarmToolContext extends ToolContext {}

function resolvePath(workspaceRoot: string, input: string): string {
  return path.isAbsolute(input) ? input : path.join(workspaceRoot, input);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ReadFileTool extends BaseTool {
  name = 'readFile';
  description = 'Read the contents of a file, optionally a line range.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file.' },
      startLine: { type: 'number', description: 'Optional starting line number (1-indexed).' },
      endLine: { type: 'number', description: 'Optional ending line number (1-indexed).' },
    },
    required: ['path'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const input = typeof args.path === 'string' ? args.path : '';
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;

    try {
      const filePath = resolvePath(context.workspaceRoot, input);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return { success: false, error: `Not a file: ${input}` };
      }

      let text = await fs.readFile(filePath, 'utf-8');
      const lines = text.split('\n');

      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
        text = lines.slice(start, end).join('\n');
      }

      return { success: true, data: { content: text, totalLines: lines.length } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class WriteFileTool extends BaseTool {
  name = 'writeFile';
  description = 'Write content to a file, overwriting existing content.';
  parameters: ToolDefinition['parameters'] = {
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
    const input = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';

    try {
      const filePath = resolvePath(context.workspaceRoot, input);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, data: { path: input, bytes: Buffer.byteLength(content, 'utf-8') } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class ListFilesTool extends BaseTool {
  name = 'listFiles';
  description = 'List files in the workspace by glob pattern, sorted by path.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.json".' },
      maxResults: { type: 'number', description: 'Maximum number of files to return (default 100).' },
    },
    required: ['pattern'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 100;

    if (!context.workspaceRoot) {
      return { success: false, error: 'No workspace root available. Run Copium inside a project.' };
    }

    try {
      const files: string[] = [];
      const glob = new Bun.Glob(pattern);
      for await (const match of glob.scan({ cwd: context.workspaceRoot, dot: false })) {
        const full = path.join(context.workspaceRoot, match);
        if (full.includes(`${path.sep}node_modules${path.sep}`)) continue;
        files.push(match);
        if (files.length >= maxResults) break;
      }
      files.sort();
      return { success: true, data: { files } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class GrepFilesTool extends BaseTool {
  name = 'grepFiles';
  description = 'Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern of files to search, e.g. "**/*.ts".' },
      query: { type: 'string', description: 'Regular expression to search for.' },
      maxResults: { type: 'number', description: 'Maximum number of matches to return (default 50).' },
    },
    required: ['pattern', 'query'],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const query = typeof args.query === 'string' ? args.query : '';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;

    if (!context.workspaceRoot) {
      return { success: false, error: 'No workspace root available. Run Copium inside a project.' };
    }

    let re: RegExp;
    try {
      re = new RegExp(query, 'i');
    } catch (err) {
      return { success: false, error: `Invalid regex: ${errorMessage(err)}` };
    }

    try {
      const files: string[] = [];
      const glob = new Bun.Glob(pattern);
      for await (const match of glob.scan({ cwd: context.workspaceRoot, dot: false })) {
        const full = path.join(context.workspaceRoot, match);
        if (full.includes(`${path.sep}node_modules${path.sep}`)) continue;
        files.push(full);
        if (files.length >= 500) break;
      }

      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (matches.length >= maxResults) break;
        try {
          const text = await fs.readFile(file, 'utf-8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            if (re.test(lines[i]!)) {
              matches.push({ path: file, line: i + 1, text: lines[i]!.slice(0, 200) });
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      return { success: true, data: { matches } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class ApplyEditTool extends BaseTool {
  name = 'applyEdit';
  description = 'Apply a targeted edit to a file by replacing an exact substring with new content.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file.' },
      oldString: { type: 'string', description: 'The exact existing text to replace.' },
      newString: { type: 'string', description: 'The replacement text.' },
    },
    required: ['path', 'oldString', 'newString'],
  };

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return true;
  }

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const input = typeof args.path === 'string' ? args.path : '';
    const oldString = typeof args.oldString === 'string' ? args.oldString : '';
    const newString = typeof args.newString === 'string' ? args.newString : '';

    if (!oldString) {
      return { success: false, error: 'oldString is required for applyEdit.' };
    }

    try {
      const filePath = resolvePath(context.workspaceRoot, input);
      const text = await fs.readFile(filePath, 'utf-8');
      if (!text.includes(oldString)) {
        return {
          success: false,
          error: 'oldString not found in file. Provide exact existing text.',
        };
      }
      const updated = text.replace(oldString, newString);
      await fs.writeFile(filePath, updated, 'utf-8');
      const bytes = Buffer.byteLength(updated, 'utf-8');
      return { success: true, data: { path: input, bytes } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class WebFetchTool extends BaseTool {
  name = 'webFetch';
  description = 'Fetch the content of a URL (documentation, README, web page). Returns text content.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch.' },
    },
    required: ['url'],
  };

  async execute(_context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const url = typeof args.url === 'string' ? args.url : '';
    if (!url) {
      return { success: false, error: 'url is required for webFetch.' };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
      }
      const text = await response.text();
      const clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        success: true,
        data: { url, content: clean.slice(0, 12000), contentType: response.headers.get('content-type') },
      };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class WebSearchTool extends BaseTool {
  name = 'webSearch';
  description = 'Search the web for information. Returns a list of result titles and URLs.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      maxResults: { type: 'number', description: 'Maximum number of results to return (default 5).' },
    },
    required: ['query'],
  };

  async execute(_context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof args.query === 'string' ? args.query : '';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 5;
    if (!query) {
      return { success: false, error: 'query is required for webSearch.' };
    }
    try {
      const results = await duckDuckGoSearch(query, maxResults);
      if (results.length === 0) {
        return { success: true, data: { query, results: [], note: 'No results found.' } };
      }
      return { success: true, data: { query, results } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

async function duckDuckGoSearch(query: string, maxResults: number): Promise<Array<{ title: string; url: string }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Copium/1.0)' },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (!response.ok) return [];
    const html = await response.text();
    const results: Array<{ title: string; url: string }> = [];
    const anchorRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(html)) !== null && results.length < maxResults) {
      const href = match[1]!;
      const title = match[2]!.replace(/<[^>]+>/g, '').trim();
      if (!href || !title) continue;
      const url = decodeDuckDuckGoUrl(href);
      if (url.startsWith('http')) {
        results.push({ title, url });
      }
    }
    return results;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function decodeDuckDuckGoUrl(href: string): string {
  try {
    const parsed = new URL(href);
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    // fall through
  }
  return href;
}

export class GitCommitTool extends BaseTool {
  name = 'gitCommit';
  description = 'Commit all staged and unstaged changes in the workspace with a message.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message.' },
    },
    required: ['message'],
  };

  protected requiresConfirmation(_args: Record<string, unknown>): boolean {
    return true;
  }

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const message = typeof args.message === 'string' ? args.message : '';
    if (!message) {
      return { success: false, error: 'Commit message is required.' };
    }
    try {
      // Use execFile with an argv array (not a shell string) so the commit
      // message can never be interpreted as shell syntax, even if it
      // contains characters like `$()`, backticks, or `;`.
      const add = await execFileAsync('git', ['add', '-A'], {
        cwd: context.workspaceRoot,
        timeout: 30000,
        windowsHide: true,
      });
      const commit = await execFileAsync('git', ['commit', '-m', message], {
        cwd: context.workspaceRoot,
        timeout: 30000,
        windowsHide: true,
      });
      const output = [add.stdout, add.stderr, commit.stdout, commit.stderr]
        .filter(Boolean)
        .join('\n');
      return { success: true, data: { output } };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const output = (e.stdout ?? '') + (e.stderr ? `\n${e.stderr}` : '');
      return {
        success: false,
        error: errorMessage(err),
        data: { output, exitCode: e.code },
      };
    }
  }
}

export class SearchFilesTool extends BaseTool {
  name = 'searchFiles';
  description = 'Search for files by pattern or content in the workspace.';
  parameters: ToolDefinition['parameters'] = {
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
      return { success: false, error: 'No workspace root available. Run Copium inside a project.' };
    }

    try {
      const files: string[] = [];
      const glob = new Bun.Glob(pattern);
      for await (const match of glob.scan({ cwd: context.workspaceRoot, dot: false })) {
        const full = path.join(context.workspaceRoot, match);
        if (full.includes(`${path.sep}node_modules${path.sep}`)) continue;
        files.push(full);
        if (files.length >= maxResults * 10) break;
      }

      if (!query) {
        return { success: true, data: { files: files.slice(0, maxResults) } };
      }

      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (matches.length >= maxResults) break;
        try {
          const text = await fs.readFile(file, 'utf-8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            if (lines[i]!.toLowerCase().includes(query.toLowerCase())) {
              matches.push({ path: file, line: i + 1, text: lines[i]! });
            }
          }
        } catch {
          // skip unreadable files
        }
      }

      return { success: true, data: { matches } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class RunCommandTool extends BaseTool {
  name = 'runCommand';
  description = 'Run a shell command in the workspace and capture its output.';
  parameters: ToolDefinition['parameters'] = {
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
    const cwdInput = typeof args.cwd === 'string' ? args.cwd : context.workspaceRoot;
    const cwd = path.isAbsolute(cwdInput) ? cwdInput : path.join(context.workspaceRoot, cwdInput);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
        windowsHide: true,
      });
      const output = stdout + (stderr ? `\n${stderr}` : '');
      return { success: true, data: { command, cwd, output } };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      const output = (e.stdout ?? '') + (e.stderr ? `\n${e.stderr}` : '');
      return {
        success: false,
        error: errorMessage(err),
        data: { command, cwd, output, exitCode: e.code },
      };
    }
  }
}

export class GitStatusTool extends BaseTool {
  name = 'gitStatus';
  description = 'Get the git status of the workspace.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {},
    required: [],
  };

  async execute(context: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { stdout } = await execAsync('git status --porcelain --branch', {
        cwd: context.workspaceRoot,
        timeout: 30000,
        windowsHide: true,
      });
      return { success: true, data: { status: stdout } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class GitDiffTool extends BaseTool {
  name = 'gitDiff';
  description = 'Get the git diff for the workspace.';
  parameters: ToolDefinition['parameters'] = {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'If true, show staged changes.' },
    },
    required: [],
  };

  async execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const staged = typeof args.staged === 'boolean' ? args.staged : false;
      const { stdout } = await execAsync(staged ? 'git diff --staged' : 'git diff', {
        cwd: context.workspaceRoot,
        timeout: 30000,
        windowsHide: true,
      });
      return { success: true, data: { diff: stdout } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}

export class SpawnSwarmTool extends BaseTool {
  name = 'spawnSwarm';
  description = 'Spawn multiple autonomous agents in parallel with shared memory.';
  parameters: ToolDefinition['parameters'] = {
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

  async execute(context: SwarmToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const task = typeof args.task === 'string' ? args.task : '';
    const maxAgents = typeof args.maxAgents === 'number' ? args.maxAgents : 3;

    if (!task) {
      return { success: false, error: 'Task description is required for swarm mode.' };
    }

    try {
      const provider = context.provider;
      if (!provider) {
        return { success: false, error: 'No provider configured. Cannot spawn swarm agents.' };
      }

      const swarm = new SwarmManager(provider, context.workspaceRoot);

      for (const role of DEFAULT_SWARM_ROLES) {
        await swarm.registerAgent(role);
      }

      const roles = DEFAULT_SWARM_ROLES.slice(0, Math.min(maxAgents, DEFAULT_SWARM_ROLES.length));

      const results = await swarm.spawnTask({
        id: 'swarm_' + Date.now(),
        prompt: task,
        roles,
        maxIterations: 3,
        createdAt: Date.now(),
      });

      const summaries: string[] = [];
      for (const [agentId, messages] of results) {
        const agent = roles.find((a) => a.id === agentId);
        const agentName = agent ? agent.name : agentId;
        summaries.push('[' + agentName + '] ' + messages.map((m) => m.content).join('\n'));
      }

      return { success: true, data: { result: summaries.join('\n\n') } };
    } catch (err) {
      return { success: false, error: errorMessage(err) };
    }
  }
}
