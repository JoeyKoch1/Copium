import {
  BoxRenderable,
  CliRenderer,
  createCliRenderer,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  SyntaxStyle,
  TextRenderable,
  TextareaRenderable,
  type KeyEvent,
  type KeyBinding,
} from '@opentui/core';
import { CopiumConfig, describeProvider, saveConfig } from '../config';
import { ChatEngine } from '../engine';
import { ToolRegistry } from '../agent';
import { createProvider, ModelProvider } from '../providers';
import { PluginRegistry } from '../plugins/loader';
import type { BaseTool } from '../agent/baseTool';
import { buildCompactDiff } from './diff';
import {
  buildSyntaxStyle,
  getTheme,
  themeNames,
  loadCustomThemes,
  CopiumTheme,
} from './theme';
import {
  saveSession,
  loadSession,
  listSessions,
  deriveTitle,
  exportSession,
  importSession,
  StoredMessage,
} from '../session/store';

interface UiMessage {
  role: 'user' | 'assistant' | 'tool' | 'status';
  content: string;
  /** Queued messages render dimmed until they are actually sent. */
  queued?: boolean;
}

interface MessageCard {
  message: UiMessage;
  row: BoxRenderable;
  card: BoxRenderable;
  label: TextRenderable;
  body: MarkdownRenderable | TextRenderable;
}

const SYSTEM_WELCOME =
  '**Copium** — free coding agent for the terminal.\n\n' +
  'Type a message and press Enter to send (Shift+Enter for a new line). ' +
  'Type `/` for command autocomplete. `Escape` interrupts generation. `Ctrl+C` quits.\n';

/** Slash-command metadata for autocomplete. */
const SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/help', desc: 'show help' },
  { cmd: '/clear', desc: 'clear conversation' },
  { cmd: '/model', desc: 'pick a model' },
  { cmd: '/theme', desc: 'pick a color theme' },
  { cmd: '/permission', desc: 'set permission level' },
  { cmd: '/bypassperms', desc: 'toggle never-ask mode (/yolo)' },
  { cmd: '/tools', desc: 'list available tools' },
  { cmd: '/config', desc: 'show current config' },
  { cmd: '/aiauth', desc: 'set provider + API key (saved permanently)' },
  { cmd: '/stats', desc: 'session stats (tokens, tools, edits)' },
  { cmd: '/sessions', desc: 'resume a previous session' },
  { cmd: '/export', desc: 'export session as shareable folder' },
  { cmd: '/import', desc: 'import an exported session folder' },
  { cmd: '/skill', desc: 'list or arm skills for next message' },
  { cmd: '/plugins', desc: 'list discovered plugins and their commands' },
  { cmd: '/swarm', desc: 'run swarm agents on a task' },
  { cmd: '/version', desc: 'print version' },
];

/** Shown when the provider returns no models or can't be reached. */
const FALLBACK_MODELS = [
  'cohere/north-mini-code:free',
  'openrouter/free',
  'deepseek/deepseek-chat-v3-0324:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-3-flash:free',
  'qwen/qwen3-vl:free',
  'z-ai/glm-4.5-flash:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'stealth/ox-alpha',

];

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0]!;
  for (const s of strings.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/** One-line argument summary per tool, opencode-style. */
function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');
  const trunc = (t: string, n = 48) => (t.length > n ? t.slice(0, n) + '…' : t);
  switch (name) {
    case 'readFile':
    case 'readImage':
    case 'writeFile':
      return trunc(s(args.path));
    case 'applyEdit':
      return `${trunc(s(args.path))} · edit`;
    case 'listFiles':
    case 'searchFiles':
    case 'grepFiles':
      return `${trunc(s(args.pattern), 32)}${args.query ? ` · ${trunc(s(args.query), 24)}` : ''}`;
    case 'runCommand':
      return trunc(s(args.command), 64);
    case 'gitCommit':
      return trunc(s(args.message), 56);
    case 'gitStatus':
    case 'gitDiff':
      return '';
    case 'webFetch':
      return trunc(s(args.url), 56);
    case 'webSearch':
      return trunc(s(args.query), 48);
    case 'spawnSwarm':
      return trunc(s(args.task), 48);
    default:
      return trunc(Object.values(args).map(s).join(' '), 48);
  }
}

/** One-line result summary for a finished tool card. */
function summarizeResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as { success?: boolean; error?: string; data?: Record<string, unknown> };
  if (r.success === false) {
    const err = r.error ?? 'failed';
    return `· ${err.length > 64 ? err.slice(0, 64) + '…' : err}`;
  }
  const d = r.data ?? {};
  if (typeof d.totalLines === 'number') return `· ${d.totalLines} lines`;
  if (Array.isArray(d.files)) return `· ${d.files.length} files`;
  if (Array.isArray(d.matches)) return `· ${d.matches.length} matches`;
  if (typeof d.bytes === 'number') return `· ${d.bytes}B`;
  if (typeof d.output === 'string' && d.output.trim()) {
    const line = d.output.trim().split('\n')[0]!;
    return `· ${line.length > 48 ? line.slice(0, 48) + '…' : line}`;
  }
  return '';
}

function maskKey(key: string): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export class CopiumApp {
  private renderer!: CliRenderer;
  private root!: BoxRenderable;
  private titleText!: TextRenderable;
  private statusText!: TextRenderable;
  private scrollBox!: ScrollBoxRenderable;
  private welcomeText!: TextRenderable;
  private cards: MessageCard[] = [];
  private streamingMarkdown?: MarkdownRenderable;
  private input!: TextareaRenderable;
  private syntaxStyle!: SyntaxStyle;
  private helpBox?: BoxRenderable;
  private autoCompleteBox?: BoxRenderable;
  private autoCompleteText?: TextRenderable;

  /** Messages typed while the agent is working; flushed on finishTurn. */
  private messageQueue: string[] = [];
  /** Previously submitted prompts for ↑/↓ recall. */
  private promptHistory: string[] = [];
  /** Position in history recall; -1 = not navigating. */
  private historyIndex = -1;
  /** Counters for /stats. */
  private stats = { turns: 0, toolCalls: 0, filesEdited: 0, errors: 0 };
  /** Session persistence id. */
  private sessionId = `s_${Date.now().toString(36)}`;
  private pluginRegistry!: PluginRegistry;
  /** The in-flight tool card being updated live (opencode-style). */
  private pendingToolCard?: { name: string; label: TextRenderable; body: TextRenderable };
  private messages: UiMessage[] = [];
  /** Rough cumulative token usage for the session (prompt + completion estimate). */
  private tokensIn = 0;
  private tokensOut = 0;
  private engine!: ChatEngine;
  private provider!: ModelProvider;
  private busy = false;
  private currentAssistantContent = '';
  private thinkingTimer?: ReturnType<typeof setInterval>;
  private pendingConfirm?: {
    resolve: (value: boolean) => void;
    select: SelectRenderable;
    box: BoxRenderable;
  };
  private keyHandler?: (key: KeyEvent) => void;
  private theme: CopiumTheme;

  constructor(private config: CopiumConfig, private workspaceRoot: string) {
    this.theme = getTheme(config.theme);
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      clearOnShutdown: true,
      targetFps: 60,
    });
    this.renderer.setBackgroundColor(this.theme.bg);

    const provider = createProvider(this.config) ?? this.buildFallbackProvider();
    if (!provider) {
      await this.showFatal(
        'No provider configured. Set COPIUM_PROVIDER or edit ~/.config/copium/config.json',
      );
      process.exit(1);
    }
    this.provider = provider;

    // Load user/project plugins before the engine so registered tools exist.
    this.pluginRegistry = new PluginRegistry(this.config.plugins ?? {});
    this.pluginRegistry.setToolRegistrar((tool) => {
      // Registered later once the registry exists — see start() below.
      pendingPluginTools.push(tool);
    });
    const pendingPluginTools: BaseTool[] = [];
    let pluginReport = '';
    try {
      const { loaded, errors } = await this.pluginRegistry.loadAll(this.workspaceRoot);
      if (loaded.length > 0) {
        pluginReport = loaded
          .map((p) => `  · ${p.name} v${p.version}${p.tools ? ` (${p.tools} tools)` : ''}${p.commands ? ` (${p.commands} commands)` : ''}`)
          .join('\n');
      }
      for (const e of errors) pluginReport += `\n  ! plugin error: ${e}`;
    } catch {
      // plugin loading must never block startup
    }

    this.syntaxStyle = buildSyntaxStyle(this.theme);
    const toolRegistryInstance = new ToolRegistry();
    for (const tool of pendingPluginTools) {
      toolRegistryInstance.register(tool);
    }
    this.engine = new ChatEngine(this.provider, this.config, toolRegistryInstance, this.workspaceRoot, {
      onToken: (token) => {
        this.tokensOut += Math.ceil(token.length / 4);
        this.appendAssistantToken(token);
      },
      onStatus: (status) => this.setStatus(status),
      onToolCall: (name, args) => {
        this.stats.toolCalls++;
        // Compact opencode-style card: one line, expandable details kept short.
        this.pendingToolCard = this.pushToolCard(name, summarizeArgs(name, args), 'running');
      },
      onToolResult: (name, result) => {
        this.completeToolCard(name, result);
      },
      onMessage: (role, content) => this.pushMessage({ role, content }),
      onFileEdit: (filePath, kind, before, after) => {
        this.stats.filesEdited++;
        this.pushDiffCard(filePath, kind, before, after);
      },
      emitPluginEvent: (event, payload) => this.pluginRegistry.emit(event, payload),
      onDone: () => this.finishTurn(),
      onError: (error) => {
        this.stats.errors++;
        this.setStatus(`error: ${error.message}`);
        this.pushMessage({
          role: 'tool',
          content: `**Error:** ${error.message}\n\n_Check your provider config / API key and try again._`,
        });
        this.finishTurn();
      },
      confirm: (message, toolName) => this.promptConfirm(message, toolName),
    });

    this.buildLayout();
    this.bindKeys();
    this.renderer.start();
    this.input.focus();
    this.setStatus(`ready · ${describeProvider(this.config)}${pluginReport ? ' · plugins loaded' : ''}`);
    if (pluginReport) {
      this.pushMessage({ role: 'tool', content: `**Plugins:**\n${pluginReport}` });
    }
  }

  private buildFallbackProvider(): ModelProvider | null {
    return null;
  }

  private buildLayout(): void {
    this.root = new BoxRenderable(this.renderer, {
      id: 'app-root',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      padding: 1,
    });
    this.renderer.root.add(this.root);

    // Header — minimal single-line bar (opencode style): no border box,
    // just accent logo, model, and status on one row.
    const header = new BoxRenderable(this.renderer, {
      id: 'header',
      flexShrink: 0,
      flexDirection: 'row',
      paddingX: 1,
      backgroundColor: this.theme.bg,
    });
    this.titleText = new TextRenderable(this.renderer, {
      id: 'title-text',
      content: `◆ ${describeProvider(this.config)}`,
      fg: this.theme.accent,
    });
    this.statusText = new TextRenderable(this.renderer, {
      id: 'status-text',
      content: 'starting...',
      fg: this.theme.muted,
      flexGrow: 1,
      marginLeft: 2,
      wrapMode: 'none',
      truncate: true,
    });
    header.add(this.titleText);
    header.add(this.statusText);
    this.root.add(header);

    // Message area — borderless, flush with the terminal (opencode style).
    this.scrollBox = new ScrollBoxRenderable(this.renderer, {
      id: 'messages',
      flexGrow: 1,
      flexShrink: 1,
      backgroundColor: this.theme.bg,
      paddingX: 2,
      paddingTop: 1,
      scrollY: true,
      scrollX: false,
    });
    this.scrollBox.stickyScroll = true;
    this.scrollBox.stickyStart = 'bottom';

    // Welcome card pinned at the top of the message area.
    this.welcomeText = new TextRenderable(this.renderer, {
      id: 'welcome',
      content: SYSTEM_WELCOME,
      fg: this.theme.muted,
      bg: this.theme.bg,
      marginBottom: 1,
    });
    this.scrollBox.add(this.welcomeText);
    this.root.add(this.scrollBox);

    // Input area
    const inputBox = new BoxRenderable(this.renderer, {
      id: 'input-area',
      flexShrink: 0,
      border: true,
      borderStyle: 'rounded',
      borderColor: this.theme.border,
      paddingX: 1,
      backgroundColor: this.theme.inputBg,
    });

    this.input = new TextareaRenderable(this.renderer, {
      id: 'input',
      height: 2,
      width: '100%',
      backgroundColor: this.theme.inputBg,
      textColor: this.theme.fg,
      focusedBackgroundColor: this.theme.inputBg,
      focusedTextColor: this.theme.fg,
      placeholder: 'Ask Copium something... (/ for commands)',
      placeholderColor: this.theme.muted,
      keyBindings: this.inputKeyBindings(),
      onSubmit: () => this.handleSubmit(),
      onContentChange: () => this.updateAutocomplete(),
    });
    inputBox.add(this.input);
    this.root.add(inputBox);

    // Help overlay (hidden)
    this.helpBox = new BoxRenderable(this.renderer, {
      id: 'help-box',
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: 64,
      height: 19,
      marginLeft: -32,
      marginTop: -10,
      border: true,
      borderStyle: 'double',
      borderColor: this.theme.accent,
      backgroundColor: this.theme.bg,
      title: ' Copium Help ',
      titleAlignment: 'center',
      padding: 1,
      zIndex: 100,
      visible: false,
    });
    const helpContent = new TextRenderable(this.renderer, {
      id: 'help-content',
      content:
        'Enter        : send message\n' +
        'Shift+Enter  : new line\n' +
        '/model       : pick a model\n' +
        '/permission  : read-only | propose-edits | auto-execute | bypass\n' +
        '/theme       : pick a color theme\n' +
        '/bypassperms : toggle never-ask permission mode (/yolo)\n' +
        '/swarm <t>   : run swarm agents on a task\n' +
        '/tools       : list available tools\n' +
        '/config      : show current config\n' +
        '/aiauth      : set provider + API key (saved permanently)\n' +
        '/stats       : session stats (tokens, tools, edits)\n' +
        '/sessions    : resume a previous session\n' +
        '/clear       : clear conversation\n' +
        '/help        : show this help\n' +
        'Ctrl+L       : clear conversation\n' +
        'Ctrl+Y       : copy last response\n' +
        'Up/Down      : recall previous prompts\n' +
        'Escape       : interrupt generation\n' +
        'Ctrl+C       : quit',
      fg: this.theme.fg,
    });
    this.helpBox.add(helpContent);
    this.renderer.root.add(this.helpBox);

    // Slash-command autocomplete popup (hidden until input starts with "/").
    this.autoCompleteBox = new BoxRenderable(this.renderer, {
      id: 'autocomplete-box',
      position: 'absolute',
      left: 1,
      bottom: 7,
      width: 60,
      height: 8,
      border: true,
      borderStyle: 'rounded',
      borderColor: this.theme.border,
      backgroundColor: this.theme.bg,
      paddingX: 1,
      zIndex: 150,
      visible: false,
    });
    this.autoCompleteText = new TextRenderable(this.renderer, {
      id: 'autocomplete-text',
      content: '',
      fg: this.theme.fg,
      height: '100%',
      wrapMode: 'none',
    });
    this.autoCompleteBox.add(this.autoCompleteText);
    this.renderer.root.add(this.autoCompleteBox);
  }

  private inputKeyBindings(): KeyBinding[] {
    // Enter submits; Shift+Enter inserts a newline; emacs/readline motions.
    return [
      { name: 'return', action: 'submit' },
      { name: 'kpenter', action: 'submit' },
      { name: 'linefeed', action: 'submit' },
      { name: 'return', shift: true, action: 'newline' },
      { name: 'kpenter', shift: true, action: 'newline' },
      { name: 'linefeed', shift: true, action: 'newline' },
      // Line motion (readline style)
      { name: 'a', ctrl: true, action: 'line-home' },
      { name: 'e', ctrl: true, action: 'line-end' },
      // Kill / delete
      { name: 'k', ctrl: true, action: 'delete-to-line-end' },
      { name: 'u', ctrl: true, action: 'delete-to-line-start' },
      { name: 'w', ctrl: true, action: 'delete-word-backward' },
    ];
  }

  /** Show/hide and fill the slash-command popup based on current input. */
  private updateAutocomplete(): void {
    if (!this.autoCompleteBox || !this.autoCompleteText) return;
    const text = this.input.plainText;
    if (!text.startsWith('/') || text.includes('\n')) {
      this.autoCompleteBox.visible = false;
      return;
    }
    const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase()));
    const pluginCmds = this.pluginRegistry?.listCommands?.() ?? [];
    const pluginMatches = pluginCmds
      .filter((c) => `/${c.name}`.startsWith(text.toLowerCase()))
      .map((c) => ({ cmd: `/${c.name}`, desc: `${c.desc} (plugin)` }));
    const all = [...matches, ...pluginMatches];
    if (all.length === 0) {
      this.autoCompleteBox.visible = false;
      return;
    }
    const lines = all
      .slice(0, 6)
      .map((c) => `${c.cmd.padEnd(14)} ${c.desc}`)
      .join('\n');
    this.autoCompleteText.content =
      lines + (all.length > 6 ? `\n…+${all.length - 6} more` : '') + '\n\nTab: complete';
    const h = Math.min(all.length, 6) + 3;
    this.autoCompleteBox.height = h;
    this.autoCompleteBox.visible = true;
  }

  /** Complete the current input to the single/first matching command. */
  private completeCommand(): boolean {
    const text = this.input.plainText;
    if (!text.startsWith('/')) return false;
    const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase()));
    if (matches.length === 0) return false;
    // Unique prefix match completes fully; otherwise extend to common prefix.
    const target =
      matches.length === 1
        ? matches[0]!.cmd
        : longestCommonPrefix(matches.map((m) => m.cmd));
    if (target.length <= text.length) return false;
    this.input.setText(target);
    this.updateAutocomplete();
    return true;
  }

  private bindKeys(): void {
    this.keyHandler = (key) => {
      if (this.helpBox?.visible) {
        if (key.name === 'escape' || key.name === '?') {
          this.helpBox.visible = false;
          this.input.focus();
        }
        return;
      }
      // Escape while generating interrupts the stream (opencode-style).
      if (key.name === 'escape' && this.busy) {
        this.engine.interrupt();
        return;
      }
      // Tab completes the slash command under the cursor.
      if (key.name === 'tab' && !this.busy) {
        if (this.completeCommand()) return;
      }
      // Hide autocomplete on Escape when idle.
      if (key.name === 'escape' && this.autoCompleteBox?.visible) {
        this.autoCompleteBox.visible = false;
        return;
      }
      // Up/Down recall of previously sent prompts (only at single-line input).
      if (key.name === 'up' && this.input.plainText === '') {
        if (this.historyIndex < this.promptHistory.length - 1) {
          this.historyIndex++;
          this.input.setText(this.promptHistory[this.promptHistory.length - 1 - this.historyIndex] ?? '');
          return;
        }
      }
      if (key.name === 'down' && this.historyIndex >= 0) {
        this.historyIndex--;
        const next = this.historyIndex < 0 ? '' : this.promptHistory[this.promptHistory.length - 1 - this.historyIndex]!;
        this.input.setText(next);
        return;
      }
      // ctrl+y copies the last assistant response to the clipboard.
      if (key.name === 'y' && key.ctrl) {
        void this.copyLastResponse();
        return;
      }
      if (key.name === 'l' && key.ctrl) {
        this.clearConversation();
      } else if (key.raw === '?') {
        this.helpBox!.visible = true;
        this.input.blur();
      }
    };
    this.renderer.keyInput.on('keypress', this.keyHandler);
  }

  private async handleSubmit(): Promise<void> {
    if (this.pendingConfirm) return;
    const value = this.input.plainText.trim();
    if (!value) return;
    this.input.setText('');
    this.input.blur();

    if (value.startsWith('/')) {
      await this.handleCommand(value);
      this.input.focus();
      return;
    }

    // Queue the message while the agent is working (opencode-style).
    if (this.busy) {
      this.messageQueue.push(value);
      this.setStatus(`queued (${this.messageQueue.length}) · will send when ready`);
      this.pushMessage({ role: 'user', content: value, queued: true });
      this.input.focus();
      return;
    }

    this.busy = true;
    this.historyIndex = -1;
    if (this.promptHistory[this.promptHistory.length - 1] !== value) {
      this.promptHistory.push(value);
    }
    this.stats.turns++;
    // Rough prompt-size accounting: whole history is re-sent each turn.
    this.tokensIn += Math.ceil(value.length / 4) + this.estimateHistoryTokens();
    this.pushMessage({ role: 'user', content: value });
    this.currentAssistantContent = '';
    this.startThinking('thinking...');

    try {
      await this.engine.send(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`error: ${msg}`);
      this.pushMessage({ role: 'tool', content: `**Error:** ${msg}` });
      this.finishTurn();
    }
  }

  private async handleCommand(input: string): Promise<void> {
    const [name, ...rest] = input.split(/\s+/);
    const arg = rest.join(' ').trim();

    switch (name) {
      case '/help':
        this.helpBox!.visible = true;
        this.input.blur();
        break;
      case '/clear':
        this.clearConversation();
        break;
      case '/sessions': {
        const metas = await listSessions();
        if (metas.length === 0) {
          this.pushMessage({ role: 'tool', content: '_No saved sessions yet._' });
          break;
        }
        const choice = await this.promptSelect(
          'Resume Session',
          metas.map((m) => ({
            name: new Date(m.updatedAt).toLocaleString(),
            description: m.title,
            value: m.id,
          })),
        );
        if (typeof choice === 'string' && choice) {
          await this.resumeSession(choice);
        }
        break;
      }
      case '/model':
        await this.promptModel();
        break;
      case '/models':
        await this.promptModel();
        break;
      case '/theme': {
        const custom = await loadCustomThemes(this.workspaceRoot);
        const pluginThemes = this.pluginRegistry.getCustomThemes().map((t) => ({
          ...getTheme('copium-dark'),
          ...t,
          styles: {},
        })) as CopiumTheme[];
        const allNames = [...themeNames(), ...custom.map((c) => c.name), ...pluginThemes.map((p) => p.name)];
        const allCustoms = [...custom, ...pluginThemes];
        const choice = await this.promptSelect(
          'Theme',
          allNames.map((t) => ({
            name: t,
            description:
              (t === this.theme.name ? '(current)' : '') +
              (allCustoms.some((c) => c.name === t) ? ' (custom)' : ''),
            value: t,
          })),
        );
        if (typeof choice === 'string' && choice) {
          const picked = allCustoms.find((c) => c.name === choice);
          this.applyTheme(choice, picked);
          await this.persistConfig();
          this.pushMessage({ role: 'tool', content: `_Theme: \`${choice}\`_` });
        }
        break;
      }
      case '/permission':
        await this.promptPermission(arg);
        break;
      case '/bypassperms':
      case '/yolo': {
        this.config.permissionLevel =
          this.config.permissionLevel === 'bypass' ? 'propose-edits' : 'bypass';
        await this.persistConfig();
        const on = this.config.permissionLevel === 'bypass';
        this.setStatus(`permission: ${this.config.permissionLevel}`);
        this.pushMessage({
          role: 'tool',
          content: on
            ? '**Permission bypass ON** — all tool calls run without asking. The destructive-command guard stays active. `/bypassperms` again to turn off.'
            : '_Permission bypass OFF — back to prompting._',
        });
        break;
      }
      case '/tools':
        this.pushMessage({
          role: 'tool',
          content: '**Available tools:**\n\n' + this.engine.getToolList().map((t) => `- \`${t}\``).join('\n'),
        });
        break;
      case '/config':
        this.pushMessage({
          role: 'tool',
          content:
            '**Config:**\n\n' +
            `- provider: \`${this.config.provider}\`\n` +
            `- model: \`${describeProvider(this.config)}\`\n` +
            `- permission: \`${this.config.permissionLevel}\`\n` +
            `- swarm: \`${this.config.swarm.enabled}\` (max ${this.config.swarm.maxAgents})\n` +
            `- api key: \`${maskKey(this.activeApiKey())}\`\n`,
        });
        break;
      case '/aiauth': {
        // Pick provider, paste key, saved to config permanently.
        const providerChoice = await this.promptSelect(
          'AI Provider',
          [
            { name: 'openrouter', description: 'OpenRouter (free models available)', value: 'openrouter' },
            { name: 'byok', description: 'Any OpenAI-compatible endpoint', value: 'byok' },
            { name: 'ollama', description: 'Local models (no key needed)', value: 'ollama' },
          ],
        );
        if (typeof providerChoice !== 'string') break;

        let endpoint: string | undefined;
        if (providerChoice === 'byok') {
          endpoint = await this.promptText('BYOK Endpoint', 'https://api.deepseek.com/v1');
          if (!endpoint) break;
        }

        let apiKey: string | undefined;
        if (providerChoice !== 'ollama') {
          apiKey = await this.promptText(`Paste your ${providerChoice} API key`, '', true);
          if (!apiKey) {
            this.pushMessage({ role: 'tool', content: '_Auth cancelled._' });
            break;
          }
        }

        // Apply to config and hot-swap the provider.
        this.config.provider = providerChoice as CopiumConfig['provider'];
        if (providerChoice === 'openrouter') {
          this.config.openrouter.apiKey = apiKey!;
        } else if (providerChoice === 'byok') {
          this.config.byok.apiKey = apiKey ?? '';
          this.config.byok.endpoint = endpoint || this.config.byok.endpoint;
        }
        const rebuilt = createProvider(this.config);
        if (rebuilt) {
          this.engine.setProvider(rebuilt);
          this.provider = rebuilt;
        }
        await this.persistConfig();
        this.titleText.content = describeProvider(this.config);
        this.setStatus(`authenticated · ${describeProvider(this.config)}`);
        this.pushMessage({
          role: 'tool',
          content: `**Authenticated** with \`${providerChoice}\`${apiKey ? ` (${maskKey(apiKey)})` : ''}. Saved to config — you won't need to do this again.`,
        });
        break;
      }
      case '/swarm':
        if (!arg) {
          this.pushMessage({ role: 'tool', content: '_Usage: /swarm <task>_ e.g. /swarm implement auth with JWT' });
          return;
        }
        this.busy = true;
        this.startThinking('running swarm agents...');
        try {
          await this.engine.send(input);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.pushMessage({ role: 'tool', content: `**Error:** ${msg}` });
        }
        this.finishTurn();
        break;
      case '/version':
        this.pushMessage({ role: 'tool', content: 'Copium 1.0.0' });
        break;
      case '/plugins': {
        const { loaded, errors } = await this.pluginRegistry.loadAll(this.workspaceRoot);
        void loaded; // already loaded at startup; refresh state only
        const cmds = this.pluginRegistry.listCommands();
        const enabled = this.pluginRegistry.getEnabledState();
        const lines = Object.entries(enabled).map(([name, on]) => `- ${on ? '✅' : '❌'} ${name}`);
        const cmdLines = cmds.map((c) => `- \`/${c.name}\` — ${c.desc} _(plugin: ${c.source})_`);
        this.pushMessage({
          role: 'tool',
          content:
            '**Plugins:**\n\n' +
            (lines.length ? lines.join('\n') : '_none discovered_\n') +
            (errors.length ? `\n**Errors:**\n${errors.map((e) => `- ${e}`).join('\n')}\n` : '') +
            (cmdLines.length ? `\n**Plugin commands:**\n${cmdLines.join('\n')}` : ''),
        });
        break;
      }
      case '/skill': {
        const { loadSkills } = await import('../skills/loader');
        const skills = await loadSkills(this.workspaceRoot);
        if (skills.length === 0) {
          this.pushMessage({
            role: 'tool',
            content: '_No skills found. Add `.md` files to `~/.config/copium/skills/` or `.copium/skills/` in this project._',
          });
          break;
        }
        // /skill <name> queues it for the next message; bare /skill lists.
        if (arg) {
          const found = skills.find((s) => s.name === arg.trim());
          if (found) {
            this.engine.queueManualSkill(found.name);
            this.pushMessage({
              role: 'tool',
              content: `_Skill \`${found.name}\` armed — it will apply to your next message._`,
            });
          } else {
            this.pushMessage({ role: 'tool', content: `_Unknown skill: ${arg}_` });
          }
          break;
        }
        const lines = skills
          .map((s) => `- \`${s.name}\` (${s.trigger})${s.description ? ` — ${s.description}` : ''}`)
          .join('\n');
        this.pushMessage({
          role: 'tool',
          content: `**Skills** (use \`/skill <name>\` to arm one):\n\n${lines}`,
        });
        break;
      }
      case '/export': {
        const [idArg, destArg] = arg.split(/\s+/);
        const id = idArg || this.sessionId;
        try {
          const res = await exportSession(id, destArg);
          this.pushMessage({
            role: 'tool',
            content: `**Exported** ${res.messageCount} messages → \`${res.folderPath}\`\n\nHand this folder to whoever you want to share with — they run \`/import <folder>\`.`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.pushMessage({ role: 'tool', content: `_Export failed: ${msg}_` });
        }
        break;
      }
      case '/import': {
        if (!arg) {
          this.pushMessage({ role: 'tool', content: '_Usage: /import <path-to-exported-folder>_' });
          break;
        }
        try {
          const res = await importSession(arg.trim());
          this.pushMessage({
            role: 'tool',
            content: `**Imported** "${res.title}" (${res.messageCount} messages) as session \`${res.id}\`. Use /sessions to resume it.`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.pushMessage({ role: 'tool', content: `_Import failed: ${msg}_` });
        }
        break;
      }
      case '/stats': {
        const s = this.stats;
        this.pushMessage({
          role: 'tool',
          content:
            '**Session stats:**\n\n' +
            `- turns: ${s.turns}\n` +
            `- tool calls: ${s.toolCalls}\n` +
            `- files edited: ${s.filesEdited}\n` +
            `- errors: ${s.errors}\n` +
            `- tokens: ↑${this.tokensIn} ↓${this.tokensOut}\n` +
            `- context estimate: ~${Math.round(this.contextPercent())}%\n`,
        });
        break;
      }
      default: {
        // Try plugin-registered commands before giving up.
        const pluginCmd = this.pluginRegistry.runCommand((name ?? '').replace(/^\//, ''), arg);
        if (pluginCmd !== undefined) {
          await Promise.resolve(pluginCmd);
          break;
        }
        this.pushMessage({ role: 'tool', content: `_Unknown command: ${name}. Type /help for available commands._` });
        break;
      }
    }
  }

  private estimateHistoryTokens(): number {
    return this.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }

  /** Rough share of a 128k context window the transcript would occupy. */
  private contextPercent(): number {
    const CONTEXT_TOKENS = 128_000;
    return Math.min(100, ((this.tokensIn + this.tokensOut) / CONTEXT_TOKENS) * 100);
  }

  /** Copy the most recent assistant response to the clipboard. */
  private async copyLastResponse(): Promise<void> {
    const last = [...this.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return;
    try {
      if (process.platform === 'win32') {
        const proc = Bun.spawn(
          ['powershell', '-NoProfile', '-Command', '$input | Set-Clipboard'],
          { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' },
        );
        proc.stdin?.write(last.content);
        proc.stdin?.end();
        await proc.exited;
      } else if (process.platform === 'darwin') {
        const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
        proc.stdin?.write(last.content);
        proc.stdin?.end();
        await proc.exited;
      } else {
        const proc = Bun.spawn(['xclip', '-selection', 'clipboard'], {
          stdin: 'pipe',
          stdout: 'ignore',
          stderr: 'ignore',
        });
        proc.stdin?.write(last.content);
        proc.stdin?.end();
        await proc.exited;
      }
      this.setStatus('copied last response');
    } catch {
      this.setStatus('copy failed');
    }
  }

  /** Header title shows provider/model; status suffix shows usage + context. */
  private usageSuffix(): string {
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return ` · ↑${fmt(this.tokensIn)} ↓${fmt(this.tokensOut)} · ctx ${Math.round(this.contextPercent())}%`;
  }

  private finishTurn(): void {
    this.busy = false;
    this.currentAssistantContent = '';
    this.stopThinking();
    if (this.streamingMarkdown) {
      this.streamingMarkdown.streaming = false;
      this.streamingMarkdown = undefined;
    }
    // Send any messages that were queued while the agent was working.
    const next = this.messageQueue.shift();
    if (next !== undefined) {
      // Mark the queued card as sent (un-dim) by re-pushing it as a real message.
      void this.sendQueued(next);
      return;
    }
    this.setStatus(`ready · ${describeProvider(this.config)}${this.usageSuffix()}`);
    this.input.focus();
    this.rerender();
  }

  /** Sends a previously-queued message once the current turn finishes. */
  private async sendQueued(value: string): Promise<void> {
    // The queued card is already in the transcript; just run the engine turn.
    this.busy = true;
    this.tokensIn += Math.ceil(value.length / 4) + this.estimateHistoryTokens();
    this.startThinking('thinking...');
    try {
      await this.engine.send(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(`error: ${msg}`);
      this.pushMessage({ role: 'tool', content: `**Error:** ${msg}` });
      this.finishTurn();
    }
  }

  private pushMessage(message: UiMessage): void {
    this.messages.push(message);
    const card = this.buildCard(message);
    this.cards.push(card);
    this.scrollBox.add(card.row);
    this.rerender();
    // Auto-save the transcript on every message (fire and forget).
    const toStore: StoredMessage[] = this.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    void saveSession(this.sessionId, deriveTitle(toStore), toStore).catch(() => {});
  }

  private appendAssistantToken(token: string): void {
    if (!this.messages.length || this.messages[this.messages.length - 1]!.role !== 'assistant') {
      this.pushMessage({ role: 'assistant', content: '' });
    }
    const last = this.messages[this.messages.length - 1]!;
    last.content += token;
    const card = this.cards[this.cards.length - 1];
    if (card?.body instanceof MarkdownRenderable) {
      this.streamingMarkdown = card.body;
      card.body.content = last.content;
      card.body.streaming = true;
    }
    this.rerender();
  }

  private setStatus(status: string): void {
    this.statusText.content = status;
  }

  private startThinking(message: string): void {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    this.stopThinking();
    this.thinkingTimer = setInterval(() => {
      i = (i + 1) % frames.length;
      this.statusText.content = `${frames[i]} ${message}`;
    }, 80);
    this.statusText.content = `⠋ ${message}`;
  }

  private stopThinking(): void {
    if (this.thinkingTimer) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = undefined;
    }
  }

  private rerender(): void {
    // Cards are kept in sync incrementally in pushMessage/appendAssistantToken;
    // here we only re-pin the scroll to the latest content.
    this.scrollBox.scrollTop = this.scrollBox.scrollHeight;
  }

  private buildCard(message: UiMessage): MessageCard {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const isTool = message.role === 'tool' || message.role === 'status';

    // Compact layout: tool output has no bubble/border at all — just dimmed
    // text. User/assistant cards keep a thin border but tight padding.
    const row = new BoxRenderable(this.renderer, {
      id: `msg-${this.cards.length}`,
      flexDirection: 'row',
      width: '100%',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start',
    });

    const labelText = isUser
      ? (message.queued ? 'You (queued)' : 'You')
      : isAssistant ? 'Copium' : 'Tool';

    const card = new BoxRenderable(this.renderer, {
      id: `msg-card-${this.cards.length}`,
      flexDirection: 'column',
      maxWidth: isUser ? '85%' : isAssistant ? '92%' : '100%',
      flexShrink: 1,
      border: !isTool,
      borderStyle: 'rounded',
      borderColor: isUser ? this.theme.secondary : this.theme.borderSubtle,
      backgroundColor: isUser ? this.theme.userBubble : this.theme.bg,
      paddingX: isTool ? 0 : 1,
      paddingY: 0,
      marginBottom: isTool ? 0 : 1,
    });

    const label = new TextRenderable(this.renderer, {
      id: `msg-label-${this.cards.length}`,
      content: isTool ? '' : labelText,
      fg: isUser ? (message.queued ? this.theme.muted : this.theme.secondary) : isAssistant ? this.theme.primary : this.theme.muted,
      marginBottom: isTool ? 0 : 0,
    });

    let body: MarkdownRenderable | TextRenderable;
    if (isUser) {
      body = new TextRenderable(this.renderer, {
        id: `msg-body-${this.cards.length}`,
        content: message.content,
        fg: this.theme.fg,
        wrapMode: 'word',
        width: '100%',
      });
    } else {
      body = new MarkdownRenderable(this.renderer, {
        id: `msg-body-${this.cards.length}`,
        content: message.content,
        syntaxStyle: this.syntaxStyle,
        fg: isTool ? this.theme.muted : this.theme.fg,
        bg: isTool ? this.theme.bg : this.theme.assistantBubble,
        conceal: true,
        internalBlockMode: 'top-level',
        width: '100%',
      });
    }

    card.add(label);
    card.add(body);
    row.add(card);
    return { message, row, card, label, body };
  }

  /** Re-apply a theme to all existing renderables, live. */
  private applyTheme(name: string, customTheme?: CopiumTheme): void {
    this.theme = customTheme ?? getTheme(name);
    this.config.theme = name;
    this.syntaxStyle = buildSyntaxStyle(this.theme);
    this.renderer.setBackgroundColor(this.theme.bg);
    // Existing cards keep their old colors until rebuilt; restyle them cheaply.
    for (const card of this.cards) {
      this.scrollBox.remove(card.row);
      card.row.destroy();
    }
    const messages = [...this.messages];
    this.messages = [];
    this.cards = [];
    for (const m of messages) {
      this.pushMessage(m);
    }
  }

  /** Compact unified diff card for file edits (opencode-style). */
  private pushDiffCard(
    filePath: string,
    kind: 'write' | 'edit',
    before: string | null,
    after: string,
  ): void {
    const lines = buildCompactDiff(before, after);
    const plus = lines.filter((l) => l.startsWith('+')).length;
    const minus = lines.filter((l) => l.startsWith('−')).length;
    const header =
      (before === null ? '**New file** · ' : kind === 'write' ? '**Rewritten** · ' : '') +
      `\`${filePath}\`  ${this.theme.success}+${plus}§${this.theme.danger} -${minus}§`;
    this.pushMessage({
      role: 'tool',
      content: `${header}\n\`\`\`diff\n${lines.join('\n')}\n\`\`\``,
    });
  }

  /** Load a saved transcript into the view and engine context. */
  private async resumeSession(id: string): Promise<void> {
    const stored = await loadSession(id);
    if (!stored || stored.length === 0) {
      this.pushMessage({ role: 'tool', content: `_Could not load session ${id}._` });
      return;
    }
    this.sessionId = id;
    // Clear current view.
    for (const card of this.cards) {
      this.scrollBox.remove(card.row);
    }
    this.cards = [];
    this.messages = [];
    // Re-render stored messages and rebuild engine history.
    for (const m of stored) {
      this.pushMessage(m);
    }
    const chatMsgs = stored
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant' | 'tool', content: m.content }));
    this.engine.restoreMessages(chatMsgs);
    this.setStatus(`resumed · ${describeProvider(this.config)}`);
    this.pushMessage({ role: 'tool', content: '_Session restored._' });
  }

  /**
   * Compact opencode-style tool card: `⏺ ToolName key: value` on one line,
   * updated in place to ✻/✱ done state with a short result summary.
   */
  private pushToolCard(name: string, detail: string, state: 'running'): { name: string; label: TextRenderable; body: TextRenderable } {
    const row = new BoxRenderable(this.renderer, {
      id: `toolcard-${this.stats.toolCalls}`,
      flexDirection: 'column',
      width: '100%',
      paddingX: 2,
    });
    const label = new TextRenderable(this.renderer, {
      id: `toolcard-label-${this.stats.toolCalls}`,
      content: `⏺ ${name} ${detail}`,
      fg: this.theme.warning,
    });
    const body = new TextRenderable(this.renderer, {
      id: `toolcard-body-${this.stats.toolCalls}`,
      content: '',
      fg: this.theme.muted,
      visible: false,
    });
    row.add(label);
    row.add(body);
    this.scrollBox.add(row);
    const msg: UiMessage = { role: 'tool', content: `${name} ${detail}` };
    this.messages.push(msg);
    // Not registered in this.cards (custom card); rerender only.
    this.rerender();
    return { name, label, body };
  }

  /** Update the running tool card with its final state and result summary. */
  private completeToolCard(name: string, result: unknown): void {
    const card = this.pendingToolCard;
    this.pendingToolCard = undefined;
    if (!card || card.name !== name) return;
    const ok =
      !!result && typeof result === 'object' && 'success' in result
        ? (result as { success: boolean }).success
        : true;
    const summary = summarizeResult(result);
    card.label.content = `${ok ? '✻' : '✗'} ${name}${summary ? `  ${summary}` : ''}`;
    card.label.fg = ok ? this.theme.success : this.theme.danger;
  }

  /**
   * Compact opencode-style tool card helpers.
   */
  private clearConversation(): void {
    this.messages = [];
    for (const card of this.cards) {
      this.scrollBox.remove(card.row);
    }
    this.cards = [];
    this.rerender();
    this.setStatus(`cleared · ${describeProvider(this.config)}`);
  }

  /** Tool names the user chose "always allow" for, this session. */
  private alwaysAllowed = new Set<string>();

  private promptConfirm(message: string, toolName?: string): Promise<boolean> {
    // Session-level "always allow" for this tool, or bypass permission level.
    if (toolName && this.alwaysAllowed.has(toolName)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const box = new BoxRenderable(this.renderer, {
        id: 'confirm-box',
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 70,
        height: 8,
        marginLeft: -35,
        marginTop: -4,
        border: true,
        borderStyle: 'double',
        borderColor: this.theme.danger,
        backgroundColor: this.theme.bg,
        title: ' Confirmation ',
        titleAlignment: 'center',
        padding: 1,
        zIndex: 200,
      });

      const msg = new TextRenderable(this.renderer, {
        id: 'confirm-message',
        content: message,
        fg: this.theme.fg,
        wrapMode: 'word',
        width: '100%',
        height: 3,
      });
      box.add(msg);

      const select = new SelectRenderable(this.renderer, {
        id: 'confirm-select',
        options: [
          { name: 'Allow', description: 'approve this action', value: 'allow' },
          { name: 'Always allow this tool this session', description: 'no more prompts for it', value: 'always' },
          { name: 'Deny', description: 'reject this action', value: 'deny' },
        ],
        backgroundColor: this.theme.bg,
        textColor: this.theme.fg,
        focusedBackgroundColor: this.theme.inputBg,
        focusedTextColor: this.theme.accent,
        selectedBackgroundColor: this.theme.accent,
        selectedTextColor: this.theme.bg,
        showDescription: false,
        wrapSelection: true,
        flexGrow: 1,
        height: '100%',
      });
      box.add(select);
      this.renderer.root.add(box);

      const cleanup = () => {
        this.renderer.root.remove(box);
        box.destroy();
        this.pendingConfirm = undefined;
        this.input.focus();
      };

      select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
        const option = select.getSelectedOption();
        cleanup();
        if (option?.value === 'always' && toolName) {
          this.alwaysAllowed.add(toolName);
          resolve(true);
          return;
        }
        resolve(option?.value === 'allow' || option?.value === 'always');
      });
      select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
        // keep rendering in sync
      });

      this.pendingConfirm = { resolve, select, box };
      this.input.blur();
      select.focus();
    });
  }

  /**
   * Modal single-line text input. Enter submits, Escape cancels (undefined).
   * `masked` shows dots instead of characters — for API keys.
   */
  private promptText(title: string, placeholder: string, masked = false): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const box = new BoxRenderable(this.renderer, {
        id: 'text-prompt-box',
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 72,
        height: 7,
        marginLeft: -36,
        marginTop: -3,
        border: true,
        borderStyle: 'double',
        borderColor: this.theme.accent,
        backgroundColor: this.theme.bg,
        title: ` ${title} `,
        titleAlignment: 'center',
        padding: 1,
        zIndex: 200,
      });

      const input = new TextareaRenderable(this.renderer, {
        id: 'text-prompt-input',
        height: 1,
        width: '100%',
        backgroundColor: this.theme.bg,
        textColor: this.theme.fg,
        focusedBackgroundColor: this.theme.bg,
        focusedTextColor: this.theme.fg,
        placeholder,
        placeholderColor: this.theme.muted,
      });
      box.add(input);
      const hint = new TextRenderable(this.renderer, {
        id: 'text-prompt-hint',
        content: masked ? 'Enter: save · Escape: cancel · input is hidden' : 'Enter: save · Escape: cancel',
        fg: this.theme.muted,
      });
      box.add(hint);
      this.renderer.root.add(box);

      const cleanup = () => {
        const value = input.plainText.trim();
        this.renderer.root.remove(box);
        box.destroy();
        this.pendingConfirm = undefined;
        this.input.focus();
        resolve(value || undefined);
      };
      const cancel = () => {
        this.renderer.root.remove(box);
        box.destroy();
        this.pendingConfirm = undefined;
        this.input.focus();
        resolve(undefined);
      };

      const keyHandler = (key: KeyEvent) => {
        if (key.name === 'escape') {
          this.renderer.keyInput.removeListener?.('keypress', keyHandler);
          cancel();
        }
      };
      this.renderer.keyInput.on('keypress', keyHandler);

      input.onSubmit = () => {
        this.renderer.keyInput.removeListener?.('keypress', keyHandler);
        cleanup();
      };

      this.pendingConfirm = { resolve: () => {}, select: input as unknown as SelectRenderable, box };
      this.input.blur();
      input.focus();
    });
  }

  private promptSelect(
    title: string,
    options: Array<{ name: string; description: string; value: unknown }>,
  ): Promise<unknown | undefined> {
    return new Promise<unknown | undefined>((resolve) => {
      const boxHeight = title.startsWith('Select Model') ? 20 : Math.min(options.length + 4, 14);
      const box = new BoxRenderable(this.renderer, {
        id: 'picker-box',
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 72,
        height: boxHeight,
        marginLeft: -36,
        marginTop: -Math.floor(boxHeight / 2),
        border: true,
        borderStyle: 'double',
        borderColor: this.theme.accent,
        backgroundColor: this.theme.bg,
        title: ` ${title} `,
        titleAlignment: 'center',
        padding: 1,
        zIndex: 200,
      });

      const select = new SelectRenderable(this.renderer, {
        id: 'picker-select',
        options,
        backgroundColor: this.theme.bg,
        textColor: this.theme.fg,
        focusedBackgroundColor: this.theme.inputBg,
        focusedTextColor: this.theme.accent,
        selectedBackgroundColor: this.theme.accent,
        selectedTextColor: this.theme.bg,
        showDescription: true,
        wrapSelection: true,
        flexGrow: 1,
        height: '100%',
      });
      box.add(select);
      this.renderer.root.add(box);

      const cleanup = () => {
        this.renderer.root.remove(box);
        box.destroy();
        this.pendingConfirm = undefined;
        this.input.focus();
      };

      const onSelect = () => {
        const option = select.getSelectedOption();
        cleanup();
        resolve(option?.value);
      };

      select.on(SelectRenderableEvents.ITEM_SELECTED, onSelect);
      select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {});

      this.pendingConfirm = { resolve: () => {}, select, box };
      this.input.blur();
      select.focus();
    });
  }

  private async promptModel(): Promise<void> {
    const provider = this.engine.getProvider();
    this.startThinking('loading models...');

    let models: string[] = [];
    try {
      models = await provider.listModels();
    } catch (err) {
      this.stopThinking();
      const msg = err instanceof Error ? err.message : String(err);
      this.pushMessage({
        role: 'tool',
        content:
          `_Failed to list models: ${msg}_\n\n` +
          '_You can retry with `/model` again, or set a model manually in the config file._',
      });
      this.setStatus(`error: ${msg}`);
      return;
    }

    if (models.length === 0) {
      models = FALLBACK_MODELS;
      this.pushMessage({
        role: 'tool',
        content: '_Provider returned no models — showing default free models instead._',
      });
    }

    const current = this.currentModelId();
    const choice = await this.promptSelect(
      'Select Model',
      models.map((m) => ({
        name: m,
        description: m === current ? ' (current)' : '',
        value: m,
      })),
    );

    if (typeof choice === 'string' && choice) {
      const config = this.engine.getConfig();
      switch (config.provider) {
        case 'openrouter':
          config.openrouter.model = choice;
          break;
        case 'byok':
          config.byok.model = choice;
          break;
        case 'ollama':
          config.ollama.model = choice;
          break;
      }
      const rebuilt = createProvider(config);
      if (rebuilt) {
        this.engine.setProvider(rebuilt);
        this.provider = rebuilt;
      }
      await this.persistConfig();
      this.setStatus(`model: ${choice}`);
      this.titleText.content = describeProvider(config);
      this.pushMessage({ role: 'tool', content: `_Model switched to \`${choice}\`_` });
    }
  }

  private currentModelId(): string {
    switch (this.config.provider) {
      case 'openrouter':
        return this.config.openrouter.model;
      case 'byok':
        return this.config.byok.model;
      case 'ollama':
        return this.config.ollama.model;
      default:
        return '';
    }
  }

  private activeApiKey(): string {
    switch (this.config.provider) {
      case 'openrouter':
        return this.config.openrouter.apiKey;
      case 'byok':
        return this.config.byok.apiKey;
      default:
        return '';
    }
  }

  private async promptPermission(arg: string): Promise<void> {
    const levels = ['read-only', 'propose-edits', 'auto-execute'] as const;
    const wanted = levels.find((l) => l === arg.toLowerCase());

    if (wanted) {
      this.config.permissionLevel = wanted;
      await this.persistConfig();
      this.setStatus(`permission: ${wanted}`);
      this.pushMessage({ role: 'tool', content: `_Permission level set to \`${wanted}\`_` });
      return;
    }

    const choice = await this.promptSelect(
      'Permission Level',
      levels.map((l) => ({
        name: l,
        description: l === this.config.permissionLevel ? '(current)' : '',
        value: l,
      })),
    );

    if (typeof choice === 'string' && choice) {
      this.config.permissionLevel = choice as CopiumConfig['permissionLevel'];
      await this.persistConfig();
      this.setStatus(`permission: ${choice}`);
      this.pushMessage({ role: 'tool', content: `_Permission level set to \`${choice}\`_` });
    }
  }

  /** Best-effort save of runtime config changes (/model, /permission) to disk. */
  private async persistConfig(): Promise<void> {
    try {
      await saveConfig(this.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.pushMessage({ role: 'tool', content: `_Warning: failed to save config: ${msg}_` });
    }
  }

  private async showFatal(message: string): Promise<void> {
    this.renderer.setBackgroundColor(this.theme.bg);
    const box = new BoxRenderable(this.renderer, {
      id: 'fatal',
      flexDirection: 'column',
      border: true,
      borderStyle: 'double',
      borderColor: this.theme.danger,
      padding: 2,
      title: ' Copium Error ',
      titleColor: this.theme.danger,
    });
    const text = new TextRenderable(this.renderer, {
      content: message,
      fg: this.theme.fg,
      wrapMode: 'word',
      width: '100%',
    });
    box.add(text);
    this.renderer.root.add(box);
    this.renderer.start();
    await new Promise((r) => setTimeout(r, 4000));
    this.renderer.destroy();
  }
}
