import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ApplyEditTool, WriteFileTool } from '../../src/agent/tools';
import type { ToolContext } from '../../src/agent/baseTool';

describe('read-only permission enforcement', () => {
  let workspaceRoot: string;

  afterEach(async () => {
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  });

  function readOnlyContext(workspaceRoot: string, confirmCalled: { value: boolean }): ToolContext {
    return {
      workspaceRoot,
      permissionLevel: 'read-only',
      confirmAction: async () => {
        confirmCalled.value = true;
        return true;
      },
    };
  }

  it('blocks applyEdit outright in read-only mode, without prompting for confirmation', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'copium-perm-test-'));
    const filePath = path.join(workspaceRoot, 'a.txt');
    await writeFile(filePath, 'hello world', 'utf-8');

    const confirmCalled = { value: false };
    const tool = new ApplyEditTool();
    const result = await tool.run(readOnlyContext(workspaceRoot, confirmCalled), {
      path: 'a.txt',
      oldString: 'hello',
      newString: 'goodbye',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read-only/i);
    // Regression check: previously applyEdit was missing from the write-op
    // list, so read-only mode fell through to a confirmation prompt instead
    // of a hard block.
    expect(confirmCalled.value).toBe(false);

    const content = await Bun.file(filePath).text();
    expect(content).toBe('hello world');
  });

  it('still blocks writeFile outright in read-only mode (baseline, unchanged)', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'copium-perm-test-'));
    const confirmCalled = { value: false };
    const tool = new WriteFileTool();
    const result = await tool.run(readOnlyContext(workspaceRoot, confirmCalled), {
      path: 'new.txt',
      content: 'nope',
    });

    expect(result.success).toBe(false);
    expect(confirmCalled.value).toBe(false);
  });
});
