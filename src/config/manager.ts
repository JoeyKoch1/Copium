import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  validatePermissionLevel,
  validateProvider,
} from './types';
import type { CopiumConfig, PermissionLevel, ProviderType } from './types';

const CONFIG_DIR = path.join(homedir(), '.config', 'copium');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function configFile(): string {
  return process.env.COPIUM_CONFIG_FILE ?? CONFIG_FILE;
}

export function configDir(): string {
  return path.dirname(configFile());
}

async function readRawConfig(): Promise<Partial<CopiumConfig> | null> {
  try {
    const content = await readFile(configFile(), 'utf-8');
    return JSON.parse(content) as Partial<CopiumConfig>;
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<CopiumConfig> {
  const fileConfig = (await readRawConfig()) ?? {};
  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig);

  // Environment variables override config file for secrets and quick switches.
  if (process.env.COPIUM_PROVIDER) merged.provider = validateProvider(process.env.COPIUM_PROVIDER);
  if (process.env.COPIUM_PERMISSION_LEVEL) {
    merged.permissionLevel = validatePermissionLevel(process.env.COPIUM_PERMISSION_LEVEL);
  }

  if (process.env.OPENROUTER_API_KEY) merged.openrouter.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.COPIUM_OPENROUTER_API_KEY) merged.openrouter.apiKey = process.env.COPIUM_OPENROUTER_API_KEY;
  if (process.env.COPIUM_OPENROUTER_MODEL) merged.openrouter.model = process.env.COPIUM_OPENROUTER_MODEL;

  if (process.env.COPIUM_BYOK_ENDPOINT) merged.byok.endpoint = process.env.COPIUM_BYOK_ENDPOINT;
  if (process.env.COPIUM_BYOK_API_KEY) merged.byok.apiKey = process.env.COPIUM_BYOK_API_KEY;
  if (process.env.COPIUM_BYOK_MODEL) merged.byok.model = process.env.COPIUM_BYOK_MODEL;

  if (process.env.COPIUM_OLLAMA_ENDPOINT) merged.ollama.endpoint = process.env.COPIUM_OLLAMA_ENDPOINT;
  if (process.env.COPIUM_OLLAMA_MODEL) merged.ollama.model = process.env.COPIUM_OLLAMA_MODEL;

  if (process.env.COPIUM_SWARM_ENABLED === 'true') merged.swarm.enabled = true;
  if (process.env.COPIUM_SWARM_MAX_AGENTS) {
    merged.swarm.maxAgents = Number(process.env.COPIUM_SWARM_MAX_AGENTS) || merged.swarm.maxAgents;
  }

  return merged;
}

export async function saveConfig(config: CopiumConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(configFile(), JSON.stringify(config, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  // Belt-and-braces: writeFile's `mode` option only applies when creating a
  // new file, so explicitly chmod in case the file already existed with
  // looser permissions from an older Copium version.
  await chmod(configFile(), 0o600).catch(() => {
    // Non-POSIX filesystems (e.g. some Windows setups) may not support this;
    // config still works, it's just not permission-locked.
  });
}

export function describeProvider(config: CopiumConfig): string {
  switch (config.provider) {
    case 'openrouter':
      return `OpenRouter (${config.openrouter.model})`;
    case 'byok':
      return `BYOK (${config.byok.model})`;
    case 'ollama':
      return config.ollama.model
        ? `Ollama (${config.ollama.model})`
        : `Ollama (${config.ollama.endpoint})`;
  }
}
