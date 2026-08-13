import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitCommitTool } from '../../src/agent/tools';
import type { ToolContext } from '../../src/agent/baseTool';

const execFileAsync = promisify(execFile);

describe('GitCommitTool', () => {
  let workspaceRoot: string;

  afterEach(async () => {
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function initRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'copium-git-test-'));
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return dir;
  }

  function autoExecuteContext(workspaceRoot: string): ToolContext {
    return {
      workspaceRoot,
      permissionLevel: 'auto-execute',
      confirmAction: async () => true,
    };
  }

  it('commits a message containing shell metacharacters literally, without executing them', async () => {
    workspaceRoot = await initRepo();
    await writeFile(path.join(workspaceRoot, 'a.txt'), 'hello', 'utf-8');

    // A canary file that a naive shell-string commit ("git add -A && git
    // commit -m \"$(touch pwned)\"") would create if the message were
    // interpreted by a shell instead of passed as a literal argv value.
    const maliciousMessage = 'fix bug $(touch pwned.txt) `touch pwned2.txt` && echo hacked; rm -rf /tmp/nope';

    const tool = new GitCommitTool();
    const result = await tool.run(autoExecuteContext(workspaceRoot), { message: maliciousMessage });

    expect(result.success).toBe(true);

    const pwnedExists = await Bun.file(path.join(workspaceRoot, 'pwned.txt')).exists();
    const pwned2Exists = await Bun.file(path.join(workspaceRoot, 'pwned2.txt')).exists();
    expect(pwnedExists).toBe(false);
    expect(pwned2Exists).toBe(false);

    const { stdout } = await execFileAsync('git', ['log', '-1', '--pretty=%B'], { cwd: workspaceRoot });
    expect(stdout.trim()).toBe(maliciousMessage);
  });
});
