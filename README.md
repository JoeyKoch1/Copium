# Copium

![banner](Assets/logo.webp)

100% free, no-account, no-subscription coding agent for the terminal.

## Why Copium

Why cope with expensive AI coding tools when Copium is free. Copium is a terminal-based coding agent (TUI) that gives you a fully functional coding agent without gating features behind payment, waitlists, or required accounts.

## Features

- **Multi-provider support** - OpenRouter, BYOK OpenAI-compatible endpoints, and Ollama local models
- **Free by default** - Defaults to OpenRouter free auto-routed models. No credit card required
- **Swarm agents** - Run a coordinated explorer → coder → reviewer pipeline with shared memory
- **Agent tools** - Read/write files, run commands, search code, check git status/diff
- **Persistent memory** - Every request and response is logged in compressed JSON so the agent always has context
- **Permission tiers** - Choose read-only, propose-edits, or auto-execute modes
- **Streaming responses** - Real-time token streaming from models

## Requirements

- [Bun](https://bun.sh) >= 1.1

## Quick Start

```bash
bun install
bun start
```

This starts the interactive chat UI. Type a prompt and press Enter to send (Shift+Enter for a newline).

| Key | Action |
|-----|--------|
| Enter | Send message |
| Shift+Enter | Newline |
| ? | Show help overlay |
| Ctrl+L | Clear the transcript |

### Slash commands

Type these in the input box:

| Command | Action |
|---------|--------|
| `/model` | Pick a model from the provider (interactive picker) |
| `/permission` | Switch permission level: read-only / propose-edits / auto-execute |
| `/permission <lvl>` | Set permission level directly |
| `/swarm <task>` | Run a swarm of agents on a task |
| `/tools` | List the tools the agent can use |
| `/config` | Show current provider/model/permission/swarm config |
| `/clear` | Clear the transcript |
| `/help` | Show help overlay |
| `/version` | Print version |

In one-shot mode you can pass `/model <id>` as the prompt to just switch the model:

```bash
bun run src/index.ts "/model meta-llama/llama-3.3-70b"
```

### One-shot mode

Pass a prompt as an argument to run non-interactively (no confirmations; denied unless `--permission auto-execute`):

```bash
bun run src/index.ts "explain the diff in my last commit"
```

### Swarm Mode

Enable swarm mode with `--swarm`, then use `/swarm` in chat to run a task through a pipeline of agents:

```bash
bun run src/index.ts --swarm
# then:  /swarm implement user authentication with JWT tokens
```

By default, three agents run **in sequence**, each handing its output to the next: an Explorer scans the codebase and gathers context, a Coder implements the change, and a Reviewer checks it for correctness. They run one after another (not concurrently) so each stage can build on the last, and they share context and memory through compressed JSON logs stored in `.swarm/` next to your workspace.

## Supported Providers

| Provider | Default Model | Notes |
|----------|--------------|-------|
| OpenRouter | cohere/north-mini-code:free | Free model, no API key needed |
| BYOK | deepseek-chat | Bring your own OpenAI-compatible endpoint |
| Ollama | (first available) | Local models, fully offline |

## Configuration

Configuration lives in `~/.config/copium/config.json` (override the path with `--config` or the `COPIUM_CONFIG_FILE` environment variable).

```json
{
  "provider": "openrouter",
  "openrouter": { "apiKey": "", "model": "cohere/north-mini-code:free" },
  "byok": { "endpoint": "https://api.deepseek.com/v1", "apiKey": "", "model": "deepseek-chat" },
  "ollama": { "endpoint": "http://localhost:11434", "model": "" },
  "permissionLevel": "propose-edits",
  "swarm": { "enabled": false, "maxAgents": 3 }
}
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` / `COPIUM_OPENROUTER_API_KEY` | OpenRouter API key |
| `COPIUM_OPENROUTER_MODEL` | OpenRouter model ID |
| `COPIUM_BYOK_ENDPOINT` / `COPIUM_BYOK_API_KEY` / `COPIUM_BYOK_MODEL` | BYOK endpoint, key, model |
| `COPIUM_OLLAMA_ENDPOINT` / `COPIUM_OLLAMA_MODEL` | Ollama endpoint, model |
| `COPIUM_PROVIDER` | `ollama` \| `openrouter` \| `byok` |
| `COPIUM_PERMISSION_LEVEL` | `read-only` \| `propose-edits` \| `auto-execute` |
| `COPIUM_SWARM_ENABLED` | Enable swarm mode |
| `COPIUM_SWARM_MAX_AGENTS` | Max agents in the swarm pipeline |

### CLI options

```
copium                        Start the interactive chat UI
copium "<prompt>"             Run a one-shot prompt (non-interactive)
copium /swarm "<task>"        Run a swarm of agents on a task

--provider <p>       ollama | openrouter | byok
--model <m>          Model name (provider-specific)
--permission <lvl>   read-only | propose-edits | auto-execute
--swarm              Enable swarm mode
--max-agents <n>     Max swarm agents (default 3)
--config <path>      Path to config file
--list-models        List available models for the configured provider
--version, -v        Print version
--help, -h           Show this help
```

## Memory System

Every interaction is logged to `.swarm/memory/` in your workspace as compressed JSON. The agent reads this memory on every request to maintain full context across sessions.

## Development

```bash
bun install
bunx tsc --noEmit   # typecheck
bun test            # tests
bun start           # run the TUI
```

## License

MIT

