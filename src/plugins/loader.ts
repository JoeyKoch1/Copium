import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import type { BaseTool } from '../agent/baseTool';
import type { CopiumTheme } from '../ui/theme';

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  entry?: string; // default "main.ts"
}

/** What a plugin's default export receives. */
export interface PluginContext {
  /** Register an additional tool (becomes available to the model). */
  registerTool(tool: BaseTool): void;
  /** Register a slash command: /name [args...]. */
  registerCommand(name: string, desc: string, run: (arg: string) => void | Promise<void>): void;
  /** Register a custom theme (partial palettes allowed). */
  registerTheme(theme: Partial<CopiumTheme> & { name: string }): void;
  /** Subscribe to lifecycle events. */
  on(event: PluginEvent, handler: (payload: any) => void): void;
}

export type PluginEvent = 'turn-start' | 'turn-end' | 'tool-call';

interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  handlers: Partial<Record<PluginEvent, Array<(payload: any) => void>>>;
  counts: { tools: number; commands: number; themes: number };
}

export interface LoadedPluginInfo {
  name: string;
  version: string;
  description: string;
  dir: string;
  tools: number;
  commands: number;
  themes: number;
}

type CommandHandler = { desc: string; run: (arg: string) => void | Promise<void> };

/**
 * Plugin registry. Plugins are folders containing plugin.json + an entry
 * module whose default export is (ctx: PluginContext) => void.
 *
 * Discovery order (later layers override by name for enable/disable state):
 *   user:    ~/.config/copium/plugins/<folder>
 *   project: <workspace>/.copium/plugins/<folder>
 */
export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();
  private commands = new Map<string, CommandHandler & { source: string }>();
  private customThemes: Array<Partial<CopiumTheme> & { name: string }> = [];
  private toolFactory: ((tool: BaseTool) => void) | null = null;
  private enabledState: Record<string, boolean>;

  /** Set the sink for registerTool calls made during loadAll. */
  setToolRegistrar(fn: (tool: BaseTool) => void): void {
    this.toolFactory = fn;
  }

  constructor(enabledState: Record<string, boolean> = {}) {
    // Default: newly discovered plugins are enabled unless explicitly disabled.
    this.enabledState = enabledState;
  }

  isEnabled(name: string): boolean {
    return this.enabledState[name] !== false;
  }

  setEnabled(name: string, enabled: boolean): void {
    this.enabledState[name] = enabled;
  }

  getEnabledState(): Record<string, boolean> {
    return this.enabledState;
  }

  listCommands(): Array<{ name: string; desc: string; source: string }> {
    return Array.from(this.commands.entries()).map(([name, c]) => ({
      name,
      desc: c.desc,
      source: c.source,
    }));
  }

  runCommand(name: string, arg: string): Promise<void> | void | undefined {
    const cmd = this.commands.get(name);
    if (!cmd) return undefined;
    return cmd.run(arg);
  }

  getCustomThemes(): Array<Partial<CopiumTheme> & { name: string }> {
    return this.customThemes;
  }

  emit(event: PluginEvent, payload: unknown): void {
    for (const plugin of this.plugins.values()) {
      if (!this.isEnabled(plugin.manifest.name)) continue;
      for (const h of plugin.handlers[event] ?? []) {
        try {
          h(payload);
        } catch {
          // a broken hook must not kill the app
        }
      }
    }
  }

  /** Discover and load all plugins from user + project layers. */
  async loadAll(workspaceRoot?: string): Promise<{ loaded: LoadedPluginInfo[]; errors: string[] }> {
    const dirs: Array<{ base: string; source: string }> = [
      { base: path.join(homedir(), '.config', 'copium', 'plugins'), source: 'user' },
    ];
    if (workspaceRoot) {
      dirs.push({ base: path.join(workspaceRoot, '.copium', 'plugins'), source: 'project' });
    }

    const loaded: LoadedPluginInfo[] = [];
    const errors: string[] = [];

    for (const layer of dirs) {
      let entries: string[];
      try {
        entries = await fs.readdir(layer.base);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const dir = path.join(layer.base, entry);
        try {
          const info = await this.loadOne(dir);
          if (info) loaded.push(info);
        } catch (err) {
          errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return { loaded, errors };
  }

  private async loadOne(dir: string): Promise<LoadedPluginInfo | null> {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) return null;

    const manifestRaw = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf-8'));
    const manifest: PluginManifest = {
      entry: 'main.ts',
      ...manifestRaw,
      name: String(manifestRaw.name ?? path.basename(dir)),
    };
    if (!manifest.name) throw new Error('plugin.json missing "name"');

    const handlers: LoadedPlugin['handlers'] = {};
    const counts = { tools: 0, commands: 0, themes: 0 };
    const ctx: PluginContext = {
      registerTool: (tool) => {
        this.toolFactory?.(tool);
        counts.tools++;
      },
      registerCommand: (name, desc, run) => {
        this.commands.set(name, { desc, run, source: manifest.name });
        counts.commands++;
      },
      registerTheme: (theme) => {
        this.customThemes.push(theme);
        counts.themes++;
      },
      on: (event, handler) => {
        (handlers[event] ??= []).push(handler);
      },
    };

    // Only load if enabled — but still record it so /plugins can toggle later.
    if (this.isEnabled(manifest.name)) {
      const mod = await import(path.join(dir, manifest.entry!));
      const init = mod.default ?? mod;
      if (typeof init === 'function') {
        await init(ctx);
      }
    }

    this.plugins.set(manifest.name, { manifest, dir, handlers, counts });
    return {
      name: manifest.name,
      version: manifest.version ?? '0.0.0',
      description: manifest.description ?? '',
      dir,
      tools: counts.tools,
      commands: counts.commands,
      themes: counts.themes,
    };
  }
}
