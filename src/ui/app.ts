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
import { buildSyntaxStyle, DARK_THEME } from './theme';

interface UiMessage {
  role: 'user' | 'assistant' | 'tool' | 'status';
  content: string;
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
  'Use `/swarm <task>` to run a swarm of agents. `Ctrl+C` quits.\n';

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
];

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

  private messages: UiMessage[] = [];
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

  constructor(private config: CopiumConfig, private workspaceRoot: string) {}

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      clearOnShutdown: true,
      targetFps: 60,
    });
    this.renderer.setBackgroundColor(DARK_THEME.bg);

    const provider = createProvider(this.config) ?? this.buildFallbackProvider();
    if (!provider) {
      await this.showFatal(
        'No provider configured. Set COPIUM_PROVIDER or edit ~/.config/copium/config.json',
      );
      process.exit(1);
    }
    this.provider = provider;

    this.syntaxStyle = buildSyntaxStyle(DARK_THEME);
    this.engine = new ChatEngine(this.provider, this.config, new ToolRegistry(), this.workspaceRoot, {
      onToken: (token) => this.appendAssistantToken(token),
      onStatus: (status) => this.setStatus(status),
      onToolCall: (name, args) => this.pushMessage({ role: 'tool', content: `**Tool:** ${name}\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`` }),
      onToolResult: (name, result) => this.pushMessage({ role: 'tool', content: `**Tool result:** ${name}\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 3000)}\n\`\`\`` }),
      onMessage: (role, content) => this.pushMessage({ role, content }),
      onDone: () => this.finishTurn(),
      onError: (error) => {
        this.setStatus(`error: ${error.message}`);
        this.pushMessage({
          role: 'tool',
          content: `**Error:** ${error.message}\n\n_Check your provider config / API key and try again._`,
        });
        this.finishTurn();
      },
      confirm: (message) => this.promptConfirm(message),
    });

    this.buildLayout();
    this.bindKeys();
    this.renderer.start();
    this.input.focus();
    this.setStatus(`ready · ${describeProvider(this.config)}`);
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

    // Header
    const header = new BoxRenderable(this.renderer, {
      id: 'header',
      flexShrink: 0,
      flexDirection: 'row',
      border: true,
      borderStyle: 'rounded',
      borderColor: DARK_THEME.border,
      paddingX: 1,
      title: ' Copium ',
      titleColor: DARK_THEME.accent,
      backgroundColor: DARK_THEME.bg,
    });
    this.titleText = new TextRenderable(this.renderer, {
      id: 'title-text',
      content: describeProvider(this.config),
      fg: DARK_THEME.accent,
    });
    this.statusText = new TextRenderable(this.renderer, {
      id: 'status-text',
      content: 'starting...',
      fg: DARK_THEME.muted,
      flexGrow: 1,
      marginLeft: 2,
      wrapMode: 'none',
      truncate: true,
    });
    header.add(this.titleText);
    header.add(this.statusText);
    this.root.add(header);

    // Message area
    this.scrollBox = new ScrollBoxRenderable(this.renderer, {
      id: 'messages',
      flexGrow: 1,
      flexShrink: 1,
      border: true,
      borderStyle: 'rounded',
      borderColor: DARK_THEME.border,
      backgroundColor: DARK_THEME.bg,
      paddingX: 1,
      paddingY: 1,
      scrollY: true,
      scrollX: false,
    });
    this.scrollBox.stickyScroll = true;
    this.scrollBox.stickyStart = 'bottom';

    // Welcome card pinned at the top of the message area.
    this.welcomeText = new TextRenderable(this.renderer, {
      id: 'welcome',
      content: SYSTEM_WELCOME,
      fg: DARK_THEME.muted,
      bg: DARK_THEME.bg,
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
      borderColor: DARK_THEME.border,
      paddingX: 1,
      backgroundColor: DARK_THEME.inputBg,
    });

    this.input = new TextareaRenderable(this.renderer, {
      id: 'input',
      height: 3,
      width: '100%',
      backgroundColor: DARK_THEME.inputBg,
      textColor: DARK_THEME.fg,
      focusedBackgroundColor: DARK_THEME.inputBg,
      focusedTextColor: DARK_THEME.fg,
      placeholder: 'Ask Copium something... (Shift+Enter for newline)',
      placeholderColor: DARK_THEME.muted,
      keyBindings: this.inputKeyBindings(),
      onSubmit: () => this.handleSubmit(),
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
      borderColor: DARK_THEME.accent,
      backgroundColor: DARK_THEME.bg,
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
        '/permission  : read-only | propose-edits | auto-execute\n' +
        '/swarm <t>   : run swarm agents on a task\n' +
        '/tools       : list available tools\n' +
        '/config      : show current config\n' +
        '/clear       : clear conversation\n' +
        '/help        : show this help\n' +
        'Ctrl+L       : clear conversation\n' +
        'Ctrl+C       : quit',
      fg: DARK_THEME.fg,
    });
    this.helpBox.add(helpContent);
    this.renderer.root.add(this.helpBox);
  }

  private inputKeyBindings(): KeyBinding[] {
    // Enter submits; Shift+Enter inserts a newline.
    return [
      { name: 'return', action: 'submit' },
      { name: 'kpenter', action: 'submit' },
      { name: 'linefeed', action: 'submit' },
      { name: 'return', shift: true, action: 'newline' },
      { name: 'kpenter', shift: true, action: 'newline' },
      { name: 'linefeed', shift: true, action: 'newline' },
    ];
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
    if (this.busy || this.pendingConfirm) return;
    const value = this.input.plainText.trim();
    if (!value) return;
    this.input.setText('');
    this.input.blur();

    if (value.startsWith('/')) {
      await this.handleCommand(value);
      this.input.focus();
      return;
    }

    this.busy = true;
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
      case '/model':
        await this.promptModel();
        break;
      case '/models':
        await this.promptModel();
        break;
      case '/permission':
        await this.promptPermission(arg);
        break;
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
      default:
        this.pushMessage({ role: 'tool', content: `_Unknown command: ${name}. Type /help for available commands._` });
        break;
    }
  }

  private finishTurn(): void {
    this.busy = false;
    this.currentAssistantContent = '';
    this.stopThinking();
    this.setStatus(`ready · ${describeProvider(this.config)}`);
    this.input.focus();
    if (this.streamingMarkdown) {
      this.streamingMarkdown.streaming = false;
      this.streamingMarkdown = undefined;
    }
    this.rerender();
  }

  private pushMessage(message: UiMessage): void {
    this.messages.push(message);
    const card = this.buildCard(message);
    this.cards.push(card);
    this.scrollBox.add(card.row);
    this.rerender();
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

    const row = new BoxRenderable(this.renderer, {
      id: `msg-${this.cards.length}`,
      flexDirection: 'row',
      width: '100%',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start',
    });

    const card = new BoxRenderable(this.renderer, {
      id: `msg-card-${this.cards.length}`,
      flexDirection: 'column',
      maxWidth: isTool ? '100%' : '85%',
      flexShrink: 1,
      border: true,
      borderStyle: 'rounded',
      borderColor: isUser ? DARK_THEME.secondary : isTool ? DARK_THEME.borderSubtle : DARK_THEME.borderSubtle,
      backgroundColor: isUser ? DARK_THEME.userBubble : isTool ? DARK_THEME.bg : DARK_THEME.assistantBubble,
      paddingX: 1,
      paddingY: 1,
      marginBottom: 1,
    });

    const label = new TextRenderable(this.renderer, {
      id: `msg-label-${this.cards.length}`,
      content: isUser ? 'You' : isAssistant ? 'Copium' : isTool ? 'Tool' : 'Status',
      fg: isUser ? DARK_THEME.secondary : isAssistant ? DARK_THEME.primary : DARK_THEME.muted,
      marginBottom: 1,
    });

    let body: MarkdownRenderable | TextRenderable;
    if (isUser) {
      body = new TextRenderable(this.renderer, {
        id: `msg-body-${this.cards.length}`,
        content: message.content,
        fg: DARK_THEME.fg,
        wrapMode: 'word',
        width: '100%',
      });
    } else {
      body = new MarkdownRenderable(this.renderer, {
        id: `msg-body-${this.cards.length}`,
        content: message.content,
        syntaxStyle: this.syntaxStyle,
        fg: DARK_THEME.fg,
        bg: isTool ? DARK_THEME.bg : DARK_THEME.assistantBubble,
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

  private clearConversation(): void {
    this.messages = [];
    for (const card of this.cards) {
      this.scrollBox.remove(card.row);
    }
    this.cards = [];
    this.rerender();
    this.setStatus(`cleared · ${describeProvider(this.config)}`);
  }

  private promptConfirm(message: string): Promise<boolean> {
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
        borderColor: DARK_THEME.danger,
        backgroundColor: DARK_THEME.bg,
        title: ' Confirmation ',
        titleAlignment: 'center',
        padding: 1,
        zIndex: 200,
      });

      const msg = new TextRenderable(this.renderer, {
        id: 'confirm-message',
        content: message,
        fg: DARK_THEME.fg,
        wrapMode: 'word',
        width: '100%',
        height: 3,
      });
      box.add(msg);

      const select = new SelectRenderable(this.renderer, {
        id: 'confirm-select',
        options: [
          { name: 'Allow', description: '', value: true },
          { name: 'Deny', description: '', value: false },
        ],
        backgroundColor: DARK_THEME.bg,
        textColor: DARK_THEME.fg,
        focusedBackgroundColor: DARK_THEME.inputBg,
        focusedTextColor: DARK_THEME.accent,
        selectedBackgroundColor: DARK_THEME.accent,
        selectedTextColor: DARK_THEME.bg,
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
        resolve(option?.value === true);
      });
      select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
        // keep rendering in sync
      });

      this.pendingConfirm = { resolve, select, box };
      this.input.blur();
      select.focus();
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
        borderColor: DARK_THEME.accent,
        backgroundColor: DARK_THEME.bg,
        title: ` ${title} `,
        titleAlignment: 'center',
        padding: 1,
        zIndex: 200,
      });

      const select = new SelectRenderable(this.renderer, {
        id: 'picker-select',
        options,
        backgroundColor: DARK_THEME.bg,
        textColor: DARK_THEME.fg,
        focusedBackgroundColor: DARK_THEME.inputBg,
        focusedTextColor: DARK_THEME.accent,
        selectedBackgroundColor: DARK_THEME.accent,
        selectedTextColor: DARK_THEME.bg,
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
    this.renderer.setBackgroundColor(DARK_THEME.bg);
    const box = new BoxRenderable(this.renderer, {
      id: 'fatal',
      flexDirection: 'column',
      border: true,
      borderStyle: 'double',
      borderColor: DARK_THEME.danger,
      padding: 2,
      title: ' Copium Error ',
      titleColor: DARK_THEME.danger,
    });
    const text = new TextRenderable(this.renderer, {
      content: message,
      fg: DARK_THEME.fg,
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
