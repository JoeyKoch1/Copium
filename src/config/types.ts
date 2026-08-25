export type ProviderType = 'ollama' | 'openrouter' | 'byok';

export type PermissionLevel = 'read-only' | 'propose-edits' | 'auto-execute' | 'bypass';

export interface CopiumConfig {
  provider: ProviderType;
  openrouter: {
    apiKey: string;
    model: string;
  };
  byok: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
  ollama: {
    endpoint: string;
    model: string;
  };
  permissionLevel: PermissionLevel;
  theme: string;
  plugins?: Record<string, boolean>;
  swarm: {
    enabled: boolean;
    maxAgents: number;
  };
}

export const DEFAULT_CONFIG: CopiumConfig = {
  provider: 'openrouter',
  openrouter: {
    apiKey: '',
    model: 'cohere/north-mini-code:free',
  },
  byok: {
    endpoint: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  ollama: {
    endpoint: 'http://localhost:11434',
    model: '',
  },
  permissionLevel: 'propose-edits',
  theme: 'copium-dark',
  plugins: {},
  swarm: {
    enabled: false,
    maxAgents: 3,
  },
};

export function mergeConfig(base: CopiumConfig, override: Partial<CopiumConfig>): CopiumConfig {
  return {
    ...base,
    ...override,
    openrouter: { ...base.openrouter, ...(override.openrouter ?? {}) },
    byok: { ...base.byok, ...(override.byok ?? {}) },
    ollama: { ...base.ollama, ...(override.ollama ?? {}) },
    swarm: { ...base.swarm, ...(override.swarm ?? {}) },
  };
}

export function validateProvider(raw: string): ProviderType {
  const valid: ProviderType[] = ['ollama', 'openrouter', 'byok'];
  return valid.includes(raw as ProviderType) ? (raw as ProviderType) : 'openrouter';
}

export function validatePermissionLevel(raw: string): PermissionLevel {
  const valid: PermissionLevel[] = ['read-only', 'propose-edits', 'auto-execute', 'bypass'];
  return valid.includes(raw as PermissionLevel) ? (raw as PermissionLevel) : 'propose-edits';
}
