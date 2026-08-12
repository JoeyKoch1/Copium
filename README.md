# Copium

![banner](Assets/logo.webp)

100% free, no-account, no-subscription coding agent for VS Code.

## Why Copium

Why cope with expensive AI coding tools when Copium is free. Copium is a Visual Studio Code extension that gives you a fully functional coding agent without gating features behind payment, waitlists, or required accounts.

## Features

- **Multi-provider support** - OpenRouter, BYOK OpenAI-compatible endpoints, Ollama local models, and VS Code LM
- **Free by default** - Defaults to OpenRouter free auto-routed models. No credit card required
- **Swarm agents** - Spawn multiple background agents in parallel with shared memory
- **Agent tools** - Read/write files, run commands, search code, get diagnostics, check git status
- **Persistent memory** - Every request and response is logged in compressed JSON so the agent always has context
- **Permission tiers** - Choose read-only, propose-edits, or auto-execute modes
- **Streaming responses** - Real-time token streaming from models

## Supported Providers

| Provider | Default Model | Notes |
|----------|--------------|-------|
| OpenRouter | openrouter/free | Free auto-router, no API key needed for free models |
| BYOK | deepseek-chat | Bring your own OpenAI-compatible endpoint |
| Ollama | (first available) | Local models, fully offline |
| VS Code LM | (system default) | Coming in v0.3 |

## Quick Start

1. Install the extension
2. Open Settings (Ctrl+,) and search for "Copium"
3. Set your provider and model
4. Click the Copium icon in the left sidebar to open the chat UI
5. Or open the Chat view (Ctrl+Shift+I) and type `@copium hello` to start chatting

### Swarm Mode

Enable swarm mode in settings, then use `/swarm` in chat to spawn multiple background agents:

```
@copium /swarm implement user authentication with JWT tokens
```

Swarm agents share memory and context through compressed JSON logs stored in `.swarm/`.

## Memory System

Every interaction is logged to `.swarm/memory/` as compressed JSON. The agent reads this memory on every request to maintain full context across sessions. Memory is automatically compressed when it grows too large.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| copium.provider | openrouter | Model provider |
| copium.openrouter.apiKey | (empty) | OpenRouter API key |
| copium.openrouter.model | openrouter/free | Model ID |
| copium.byok.endpoint | https://api.deepseek.com/v1 | BYOK endpoint |
| copium.byok.apiKey | (empty) | BYOK API key |
| copium.byok.model | deepseek-chat | BYOK model name |
| copium.ollama.endpoint | http://localhost:11434 | Ollama endpoint |
| copium.ollama.model | (empty) | Ollama model name |
| copium.permissionLevel | propose-edits | Permission tier |
| copium.swarm.enabled | false | Enable swarm mode |
| copium.swarm.maxAgents | 3 | Max parallel swarm agents |
| copium.telemetry.enabled | false | Opt-in telemetry |

## Commands

- `Copium: Start Agent Task` - Start a Copium agent task
- `Copium: Explain Selection` - Explain the current selection
- `Copium: Fix Diagnostic` - Fix the current diagnostic
- `Copium: Apply Edit` - Apply an edit to the current file

## Chat Commands

- `@copium <prompt>` - Chat with Copium
- `@copium /swarm <prompt>` - Spawn swarm agents for the task

## Development

```bash
pnpm install
npm run compile
npm test
```

## License

MIT

## Disclaimer

This project was developed with assistance from Kilo Code for bug finding, code review, and implementation support. Kilo Code helped identify issues, suggest fixes, and implement features throughout the development process.
