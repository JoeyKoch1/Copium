import * as vscode from 'vscode';
import { createProvider, getPermissionLevel } from '../settings';
import { ToolRegistry } from '../agent/toolRegistry';

export class CopiumWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copium.chatView';
  private _view?: vscode.WebviewView;
  private messageHistory: Array<{ role: string; content: string }> = [];

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

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case 'sendMessage': {
          const provider = await createProvider();
          if (!provider) {
            this.postMessage({ type: 'error', text: 'No provider configured. Open Copium settings.' });
            return;
          }

          const userMessage = data.text as string;
          this.messageHistory.push({ role: 'user', content: userMessage });
          this.postMessage({ type: 'userMessage', text: userMessage });

          const toolRegistry = new ToolRegistry(getPermissionLevel());
          const tools = toolRegistry.getDefinitions();

          const messages = [
            { role: 'system', content: 'You are Copium, a helpful coding agent.' },
            ...this.messageHistory,
          ];

          let fullResponse = '';
          const callbacks = {
            onToken: (token: string) => {
              fullResponse += token;
              this.postMessage({ type: 'token', text: token });
            },
            onDone: () => {
              this.messageHistory.push({ role: 'assistant', content: fullResponse });
              this.postMessage({ type: 'done' });
            },
            onError: (error: Error) => {
              this.postMessage({ type: 'error', text: error.message });
            },
          };

          const toolCalls = await provider.sendChat(messages, callbacks, tools);
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const result = await toolRegistry.execute(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
              const resultText = typeof result === 'string' ? result : JSON.stringify(result);
              this.messageHistory.push({ role: 'tool', content: resultText });
              this.postMessage({ type: 'toolResult', name: tc.function.name, text: resultText });
            }
          }
          break;
        }
        case 'clearHistory': {
          this.messageHistory = [];
          this.postMessage({ type: 'cleared' });
          break;
        }
      }
    });
  }

  private postMessage(message: Record<string, unknown>): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/webview/chat.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/webview/chat.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Copium Chat</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="title">Copium</span>
      <button id="clearBtn" class="icon-btn" title="Clear history">Clear</button>
    </div>
    <div id="messages" class="messages"></div>
    <div id="loading" class="loading">Copium is thinking...</div>
    <div class="input-area">
      <textarea id="input" rows="1" placeholder="Type a message..."></textarea>
      <button id="sendBtn" class="send-btn">Send</button>
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
