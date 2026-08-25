#!/usr/bin/env bun
import { createCliRenderer, Text, Box } from '@opentui/core';
import { loadConfig, saveConfig, configFile, CopiumConfig, DEFAULT_CONFIG, mergeConfig, validateProvider, validatePermissionLevel } from './config';
import { createProvider } from './providers';
import { ToolRegistry } from './agent';
import { ChatEngine } from './engine';
import { CopiumApp } from './ui/app';
import * as path from 'node:path';

const VERSION = '1.0.0';

interface CliArgs {
  prompt?: string;
  provider?: string;
  model?: string;
  permissionLevel?: string;
  swarm?: boolean;
  maxAgents?: number;
  configFile?: string;
  listModels?: boolean;
  version?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--provider':
        args.provider = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--permission-level':
      case '--permission':
        args.permissionLevel = argv[++i];
        break;
      case '--swarm':
        args.swarm = true;
        break;
      case '--max-agents':
        args.maxAgents = Number(argv[++i]);
        break;
      case '--config':
      case '-c':
        args.configFile = argv[++i];
        break;
      case '--list-models':
      case '--models':
        args.listModels = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        positionals.push(arg);
        break;
    }
  }

  if (positionals.length > 0) {
    args.prompt = positionals.join(' ');
  }

  return args;
}

function printHelp(): void {
  console.log(`Copium ${VERSION} - free coding agent for the terminal

Usage:
  copium                        Start the interactive chat UI
  copium "<prompt>"             Run a one-shot prompt (non-interactive)
  copium /swarm "<task>"        Run a swarm of agents on a task

Options:
  --provider <p>       ollama | openrouter | byok
  --model <m>          Model name (provider-specific)
  --permission <lvl>   read-only | propose-edits | auto-execute
  --swarm              Enable swarm mode
  --max-agents <n>     Max swarm agents (default 3)
  --config <path>      Path to config file (default: ~/.config/copium/config.json)
  --list-models        List available models for the configured provider
  --version, -v        Print version
  --help, -h           Show this help

Environment:
  OPENROUTER_API_KEY / COPIUM_OPENROUTER_API_KEY
  COPIUM_BYOK_API_KEY / COPIUM_BYOK_ENDPOINT / COPIUM_BYOK_MODEL
  COPIUM_OLLAMA_ENDPOINT / COPIUM_OLLAMA_MODEL
  COPIUM_PROVIDER, COPIUM_PERMISSION_LEVEL, COPIUM_SWARM_ENABLED`);
}

function applyCliOverrides(config: CopiumConfig, args: CliArgs): CopiumConfig {
  let merged = config;
  if (args.provider) {
    merged = mergeConfig(merged, { provider: validateProvider(args.provider) });
  }
  if (args.model) {
    switch (merged.provider) {
      case 'openrouter':
        merged = mergeConfig(merged, { openrouter: { ...merged.openrouter, model: args.model } });
        break;
      case 'byok':
        merged = mergeConfig(merged, { byok: { ...merged.byok, model: args.model } });
        break;
      case 'ollama':
        merged = mergeConfig(merged, { ollama: { ...merged.ollama, model: args.model } });
        break;
    }
  }
  if (args.permissionLevel) {
    merged = mergeConfig(merged, { permissionLevel: validatePermissionLevel(args.permissionLevel) });
  }
  if (args.swarm !== undefined) {
    merged = mergeConfig(merged, { swarm: { ...merged.swarm, enabled: args.swarm } });
  }
  if (args.maxAgents !== undefined) {
    merged = mergeConfig(merged, { swarm: { ...merged.swarm, maxAgents: args.maxAgents } });
  }
  return merged;
}

async function listModels(provider: ReturnType<typeof createProvider>): Promise<void> {
  if (!provider) {
    console.error('No provider configured. Set an API key first.');
    process.exit(1);
  }
  const models = await provider.listModels();
  console.log(models.join('\n'));
}

async function runOneShot(args: CliArgs): Promise<void> {
  let config = applyCliOverrides(await loadConfig(), args);
  let provider = createProvider(config);
  if (!provider) {
    console.error(
      'No provider configured. Set an API key (e.g. OPENROUTER_API_KEY) or edit ' + configFile(),
    );
    process.exit(1);
  }

  const prompt = args.prompt ?? '';
  const registry = new ToolRegistry();

  // Slash commands in one-shot mode.
  if (prompt.startsWith('/')) {
    const [cmd, ...rest] = prompt.split(/\s+/);
    if (cmd === '/model' && rest[0]) {
      config = mergeConfig(config, { openrouter: { ...config.openrouter, model: rest.join(' ') } });
      const rebuilt = createProvider(config);
      if (rebuilt) {
        provider = rebuilt;
      }
      console.log(`Using model: ${config.openrouter.model}`);
      process.exit(0);
    }
  }

  let toolResultText = '';
  const engine = new ChatEngine(provider, config, registry, process.cwd(), {
    onToken: (token) => process.stdout.write(token),
    onStatus: (status) => {},
    onToolCall: (name, _args) => console.error(`\n[using tool: ${name}]`),
    onToolResult: (name, result) => {
      toolResultText = JSON.stringify(result);
    },
    onMessage: (_role, _content) => {},
    onDone: () => {
      process.stdout.write('\n');
      if (toolResultText) {
        console.error(`\n[result: ${toolResultText.slice(0, 500)}]`);
      }
    },
    onError: (error) => {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    },
    confirm: async (message) => {
      // Non-interactive: deny write/command tools unless auto-execute.
      if (config.permissionLevel === 'auto-execute') return true;
      console.error(`\n[requires permission: ${message} → denied in non-interactive mode]`);
      return false;
    },
  });

  await engine.send(prompt);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.configFile) {
    process.env.COPIUM_CONFIG_FILE = args.configFile;
  }

  if (args.prompt) {
    await runOneShot(args);
    return;
  }

  const config = applyCliOverrides(await loadConfig(), args);

  if (args.listModels) {
    await listModels(createProvider(config));
    return;
  }

  const app = new CopiumApp(config, process.cwd());
  await app.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
