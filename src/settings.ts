import * as vscode from 'vscode';
import { OllamaProvider } from './ollama';
import { OpenRouterProvider } from './openrouter';
import { BYOKProvider } from './byok';

export type ProviderType = 'ollama' | 'openrouter' | 'byok' | 'vscodeLm';

export function getProviderType(): ProviderType {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('provider', 'openrouter');
  const valid: ProviderType[] = ['ollama', 'openrouter', 'byok', 'vscodeLm'];
  return valid.includes(raw as ProviderType) ? (raw as ProviderType) : 'openrouter';
}

export function getOpenRouterApiKey(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('openrouter.apiKey', '');
  return typeof raw === 'string' ? raw : '';
}

export function getOpenRouterModel(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('openrouter.model', 'openrouter/free');
  return typeof raw === 'string' ? raw : 'openrouter/free';
}

export function getBYOKEndpoint(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('byok.endpoint', 'https://api.deepseek.com/v1');
  return typeof raw === 'string' ? raw : 'https://api.deepseek.com/v1';
}

export function getBYOKApiKey(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('byok.apiKey', '');
  return typeof raw === 'string' ? raw : '';
}

export function getBYOKModel(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('byok.model', 'deepseek-chat');
  return typeof raw === 'string' ? raw : 'deepseek-chat';
}

export function getOllamaEndpoint(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('ollama.endpoint', 'http://localhost:11434');
  return typeof raw === 'string' ? raw : 'http://localhost:11434';
}

export function getOllamaModel(): string {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('ollama.model', '');
  return typeof raw === 'string' ? raw : '';
}

export function getTelemetryEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('copium');
  return config.get<boolean>('telemetry.enabled', false);
}

export function getPermissionLevel(): 'read-only' | 'propose-edits' | 'auto-execute' {
  const config = vscode.workspace.getConfiguration('copium');
  const raw = config.get<string>('permissionLevel', 'propose-edits');
  const valid = ['read-only', 'propose-edits', 'auto-execute'];
  return valid.includes(raw as string) ? (raw as 'read-only' | 'propose-edits' | 'auto-execute') : 'propose-edits';
}

export function setProviderType(provider: ProviderType): void {
  const config = vscode.workspace.getConfiguration('copium');
  config.update('provider', provider, vscode.ConfigurationTarget.Global);
}

export function setOpenRouterModel(model: string): void {
  const config = vscode.workspace.getConfiguration('copium');
  config.update('openrouter.model', model, vscode.ConfigurationTarget.Global);
}

export async function createProvider(): Promise<ModelProvider | null> {
  const type = getProviderType();

  switch (type) {
    case 'ollama': {
      const endpoint = getOllamaEndpoint();
      return new OllamaProvider(endpoint);
    }
    case 'openrouter': {
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) {
        vscode.window.showWarningMessage(
          'OpenRouter API key not set. Open Copium settings to add your key, or use the free auto-router.',
          'Open Settings',
          'Use Free Models',
        ).then((selection) => {
          if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'copium.openrouter.apiKey');
          } else if (selection === 'Use Free Models') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'copium.openrouter.model');
          }
        });
        return null;
      }
      const model = getOpenRouterModel();
      return new OpenRouterProvider(apiKey, model);
    }
    case 'byok': {
      const endpoint = getBYOKEndpoint();
      const apiKey = getBYOKApiKey();
      const model = getBYOKModel();
      if (!apiKey) {
        vscode.window.showWarningMessage('BYOK API key not set. Open Copium settings to add your key.');
        return null;
      }
      return new BYOKProvider(endpoint, apiKey, model);
    }
    case 'vscodeLm': {
      vscode.window.showInformationMessage('VS Code LM provider integration coming in v0.3.');
      return null;
    }
    default:
      return null;
  }
}
