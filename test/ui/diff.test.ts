import { describe, expect, it } from 'bun:test';
import { buildCompactDiff } from '../../src/ui/diff';

describe('buildCompactDiff', () => {
  it('shows all lines as additions for a new file', () => {
    const out = buildCompactDiff(null, 'hello\nworld');
    expect(out).toEqual(['+hello', '+world']);
  });

  it('marks changed lines with + and −, keeping context', () => {
    const before = 'a\nb\nc\nd\ne';
    const after = 'a\nb\nX\nd\ne';
    const out = buildCompactDiff(before, after);
    expect(out).toContain('−c');
    expect(out).toContain('+X');
    // context lines around the change are kept
    expect(out.some((l) => l === ' b')).toBe(true);
    expect(out.some((l) => l === ' d')).toBe(true);
    expect(out.join('\n')).not.toContain('…'); // single hunk: no gap marker
  });

  it('collapses unchanged regions between separate hunks', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const afterLines = [...before.split('\n')];
    afterLines[2] = 'CHANGED-A';
    afterLines[35] = 'CHANGED-B';
    const after = afterLines.join('\n');
    const out = buildCompactDiff(before, after);
    expect(out.filter((l) => l.startsWith('+CHANGED'))).toHaveLength(2);
    expect(out.filter((l) => l === '  …')).toHaveLength(1); // one gap between hunks
  });

  it('handles files too large for the LCS table gracefully', () => {
    const big1 = Array.from({ length: 1000 }, (_, i) => `a${i}`).join('\n');
    const big2 = Array.from({ length: 1000 }, (_, i) => `b${i}`).join('\n');
    const out = buildCompactDiff(big1, big2);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('too large');
  });
});
