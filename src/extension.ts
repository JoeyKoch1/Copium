import * as vscode from 'vscode';
import { registerChatParticipant } from './chat';
import { createProvider } from './settings';
import { CopiumWebviewProvider } from './webview/webviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  registerChatParticipant(context);

  const webviewProvider = new CopiumWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CopiumWebviewProvider.viewType, webviewProvider),
  );

  const disposable = vscode.commands.registerCommand('copium.startAgentTask', async () => {
    const provider = await createProvider();
    if (!provider) {
      vscode.window.showWarningMessage('Copium: No provider configured. Open Settings to set up a provider.');
      return;
    }
    const model = provider.id === 'openrouter' ? 'openrouter/free' : provider.id;
    vscode.window.showInformationMessage(`Copium agent active via ${provider.name} (${model})`);
  });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(copium)';
  statusBar.tooltip = 'Copium';
  statusBar.command = 'copium.startAgentTask';
  statusBar.show();

  context.subscriptions.push(disposable, statusBar);
}

export function deactivate(): void {
  // disposables are collected in ExtensionContext.subscriptions
}
