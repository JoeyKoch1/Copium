import * as vscode from 'vscode';
import { createProvider, getPermissionLevel } from '../settings';
import { ToolRegistry } from '../agent/toolRegistry';
import { SwarmManager } from '../swarm';

export class CopiumWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copium.chatView';
  private _view?: vscode.WebviewView;
  private messageHistory: Array<{ role: string; content: string }> = [];
  private tokenCount = 0;
  private toolCallCount = 0;
  private startTime = Date.now();
  private tokenHistory: number[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('copium')) {
        this.postMessage({ type: 'settingsChanged' });
      }
    });

    webviewView.onDidDispose(() => {
      disposable.dispose();
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      try {
        switch (data.command) {
        case 'sendMessage': {
          const text = (data.text || '').trim();
          if (text.startsWith('/swarm')) {
            await handleSwarmFromWebview(text.replace('/swarm', '').trim());
            return;
          }

          const provider = await createProvider();
          if (!provider) {
            this.postMessage({ type: 'error', text: 'No provider configured. Open Copium settings.' });
            return;
          }

          const userMessage = text;
          this.messageHistory.push({ role: 'user', content: userMessage });
          this.postMessage({ type: 'userMessage', text: userMessage });

          const toolRegistry = new ToolRegistry(getPermissionLevel());
          const tools = toolRegistry.getDefinitions();

          const messages = [
            { role: 'system', content: 'You are Copium, a helpful coding agent. Use tools when needed. Always confirm destructive actions. You have access to a spawnSwarm tool that launches multiple autonomous agents in parallel for complex tasks. Use it when the task requires parallel exploration, coding, and review.' },
            ...this.messageHistory,
          ];

          let fullResponse = '';
          let didError = false;
          const callbacks = {
            onToken: (token: string) => {
              fullResponse += token;
              this.tokenCount += token.length;
              this.tokenHistory.push(this.tokenCount);
              this.postMessage({ type: 'token', text: token, tokenCount: this.tokenCount });
            },
            onDone: () => {
              this.messageHistory.push({ role: 'assistant', content: fullResponse });
              this.postMessage({ type: 'done', tokenCount: this.tokenCount });
            },
            onError: (error: Error) => {
              didError = true;
              this.postMessage({ type: 'error', text: error.message });
            },
          };

          try {
            const toolCalls = await provider.sendChat(messages, callbacks, tools);
            if (toolCalls && toolCalls.length > 0) {
              this.postMessage({ type: 'status', state: 'tool', text: 'Using tool: ' + toolCalls[0].function.name });
              for (const tc of toolCalls) {
                this.toolCallCount++;
                const result = await toolRegistry.execute(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
                const resultText = typeof result === 'string' ? result : JSON.stringify(result);
                this.messageHistory.push({ role: 'tool', content: resultText });
                this.postMessage({ type: 'toolResult', name: tc.function.name, text: resultText, toolCount: this.toolCallCount });
              }
            }
            if (!didError) {
              this.postMessage({ type: 'stats', tokenCount: this.tokenCount, toolCount: this.toolCallCount, messageCount: this.messageHistory.length });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error occurred';
            this.postMessage({ type: 'error', text: message });
          }
          break;
        }
        case 'clearHistory': {
          this.messageHistory = [];
          this.tokenCount = 0;
          this.toolCallCount = 0;
          this.startTime = Date.now();
          this.tokenHistory = [];
          this.postMessage({ type: 'cleared', tokenCount: 0, toolCount: 0, messageCount: 0 });
          break;
        }
        case 'getStats': {
          this.postMessage({
            type: 'stats',
            tokenCount: this.tokenCount,
            toolCount: this.toolCallCount,
            messageCount: this.messageHistory.length,
            tokenHistory: this.tokenHistory,
          });
          break;
        }
        case 'saveSettings': {
          const settings = data.settings as Record<string, unknown>;
          vscode.workspace.getConfiguration('copium').update('provider', settings.provider, vscode.ConfigurationTarget.Global);
          vscode.workspace.getConfiguration('copium').update('openrouter.model', settings.model, vscode.ConfigurationTarget.Global);
          vscode.workspace.getConfiguration('copium').update('permissionLevel', settings.permission, vscode.ConfigurationTarget.Global);
          vscode.workspace.getConfiguration('copium').update('swarm.enabled', settings.swarmEnabled, vscode.ConfigurationTarget.Global);
          vscode.workspace.getConfiguration('copium').update('swarm.maxAgents', settings.maxAgents, vscode.ConfigurationTarget.Global);
          this.postMessage({ type: 'settingsSaved' });
          break;
        }
        case 'getSettings': {
          const config = vscode.workspace.getConfiguration('copium');
          this.postMessage({
            type: 'settings',
            provider: config.get<string>('provider', 'openrouter'),
            model: config.get<string>('openrouter.model', 'openrouter/free'),
            permission: config.get<string>('permissionLevel', 'propose-edits'),
            swarmEnabled: config.get<boolean>('swarm.enabled', false),
            maxAgents: config.get<number>('swarm.maxAgents', 3),
          });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown extension error';
      this.postMessage({ type: 'error', text: 'Extension error: ' + message });
    }
    });
  }

  private postMessage(message: Record<string, unknown>): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private async handleSwarmFromWebview(prompt: string): Promise<void> {
    const provider = await createProvider();
    if (!provider) {
      this.postMessage({ type: 'error', text: 'No provider configured. Open Copium settings.' });
      return;
    }

    const maxAgents = 3;
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
    ].slice(0, maxAgents);

    this.postMessage({ type: 'swarmStart', agents });
    this.messageHistory.push({ role: 'user', content: '/swarm ' + prompt });
    this.postMessage({ type: 'userMessage', text: '/swarm ' + prompt });

    const results = await swarm.spawnTask({
      id: 'swarm_' + Date.now(),
      prompt,
      roles: agents,
      maxIterations: 3,
      createdAt: Date.now(),
    });

    for (const [agentId, messages] of results) {
      const agent = agents.find((a) => a.id === agentId);
      const agentName = agent ? agent.name : agentId;
      this.postMessage({ type: 'swarmAgentUpdate', agentId, agentName, status: 'completed' });
      const content = messages.map((m) => m.content).join('\n');
      this.postMessage({ type: 'assistant', text: '[' + agentName + '] ' + content });
    }

    this.postMessage({ type: 'swarmEnd' });
    this.postMessage({ type: 'done' });
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/webview/chat.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/webview/chat.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copium</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="app">
    <nav class="tabs">
      <button class="tab active" data-tab="chat">Chat</button>
      <button class="tab" data-tab="dashboard">Dashboard</button>
      <button class="tab" data-tab="settings">Settings</button>
    </nav>

    <main class="tab-content" id="tab-chat">
      <div class="chat-header">
        <div class="chat-title">
          <span class="logo">C</span>
          <span>Copium Chat</span>
        </div>
        <button id="clearBtn" class="icon-btn" title="Clear history">Clear</button>
      </div>
      <div id="messages" class="messages"></div>
      <div class="input-area">
        <textarea id="input" rows="1" placeholder="Type a message..." autofocus></textarea>
        <button id="sendBtn" class="send-btn" title="Send message">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14.5 2L7 9L14.5 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 16L7.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div id="statusBar" class="status-bar">
        <div id="statusIndicator" class="status-indicator ready"></div>
        <span id="statusText" class="status-text">Ready</span>
        <div id="statusIcons" class="status-icons"></div>
      </div>
    </main>

    <main class="tab-content hidden" id="tab-dashboard">
      <div class="dashboard-header">
        <h2>Dashboard</h2>
        <span class="badge" id="providerBadge">OpenRouter</span>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Messages</div>
          <div class="stat-value" id="statMessages">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Tokens</div>
          <div class="stat-value" id="statTokens">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Tools Used</div>
          <div class="stat-value" id="statTools">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Session Time</div>
          <div class="stat-value" id="statTime">0m</div>
        </div>
      </div>
      <div class="dashboard-section">
        <h3>Token Usage</h3>
        <div class="token-chart" id="tokenChart"></div>
      </div>
      <div class="dashboard-section">
        <h3>Recent Activity</h3>
        <div id="activityLog" class="activity-log"></div>
      </div>
    </main>

    <main class="tab-content hidden" id="tab-settings">
      <div class="settings-header">
        <h2>Settings</h2>
      </div>
      <div class="settings-group">
        <h3>Provider</h3>
        <div class="setting-item">
          <label for="settingProvider">Provider</label>
          <select id="settingProvider">
            <option value="openrouter">OpenRouter</option>
            <option value="byok">Bring Your Own Key</option>
            <option value="ollama">Ollama</option>
            <option value="vscodeLm">VS Code LM</option>
          </select>
        </div>
        <div class="setting-item">
          <label for="settingModel">Model</label>
          <input type="text" id="settingModel" value="openrouter/free" placeholder="e.g. openrouter/free">
        </div>
      </div>
      <div class="settings-group">
        <h3>Behavior</h3>
        <div class="setting-item">
          <label for="settingPermission">Permission Level</label>
          <select id="settingPermission">
            <option value="propose-edits">Propose Edits</option>
            <option value="read-only">Read Only</option>
            <option value="auto-execute">Auto Execute</option>
          </select>
        </div>
        <div class="setting-item">
          <label for="settingSwarm">Enable Swarm Mode</label>
          <input type="checkbox" id="settingSwarm">
        </div>
        <div class="setting-item">
          <label for="settingMaxAgents">Max Swarm Agents</label>
          <input type="number" id="settingMaxAgents" value="3" min="1" max="10">
        </div>
      </div>
      <button id="saveSettings" class="primary-btn">Save Settings</button>
    </main>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
