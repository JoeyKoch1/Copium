import { describe, it, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { saveConfig, loadConfig, DEFAULT_CONFIG } from '../../src/config';

describe('config file permissions', () => {
  let dir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'copium-config-test-'));
    originalEnv = process.env.COPIUM_CONFIG_FILE;
    process.env.COPIUM_CONFIG_FILE = path.join(dir, 'nested', 'config.json');
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.COPIUM_CONFIG_FILE;
    else process.env.COPIUM_CONFIG_FILE = originalEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the config file with owner-only (0600) permissions, since it may hold API keys', async () => {
    const config = { ...DEFAULT_CONFIG, openrouter: { ...DEFAULT_CONFIG.openrouter, apiKey: 'sk-secret' } };
    await saveConfig(config);

    const info = await stat(process.env.COPIUM_CONFIG_FILE!);
    // Mask to the permission bits only (ignore the file-type bits).
    expect(info.mode & 0o777).toBe(0o600);

    const loaded = await loadConfig();
    expect(loaded.openrouter.apiKey).toBe('sk-secret');
  });
});
