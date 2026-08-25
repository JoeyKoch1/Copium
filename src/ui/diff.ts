/** Max diff lines shown in a diff card before truncating with an ellipsis. */
export const MAX_DIFF_LINES = 20;

/**
 * Minimal LCS-based line diff, compact form: only changed regions plus up to
 * 2 lines of context on each side. Lines prefixed '+' added, '−' removed,
 * ' ' context.
 */
export function buildCompactDiff(before: string | null, after: string): string[] {
  if (before === null) {
    const all = after.split('\n');
    const out = all.slice(0, MAX_DIFF_LINES).map((l) => '+' + l);
    if (all.length > MAX_DIFF_LINES) out.push(`… +${all.length - MAX_DIFF_LINES} more lines`);
    return out;
  }

  const a = before.split('\n');
  const b = after.split('\n');

  // LCS table (capped to keep big files sane).
  const CAP = 800;
  if (a.length > CAP || b.length > CAP) {
    return [`… file too large for inline diff (${a.length}→${b.length} lines)`];
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // Walk the LCS to get edit script entries.
  type Entry = { t: ' ' | '+' | '−'; line: string };
  const entries: Entry[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      entries.push({ t: ' ', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      entries.push({ t: '−', line: a[i]! });
      i++;
    } else {
      entries.push({ t: '+', line: b[j]! });
      j++;
    }
  }
  while (i < n) entries.push({ t: '−', line: a[i++]! });
  while (j < m) entries.push({ t: '+', line: b[j++]! });

  // Keep only changed hunks ± 2 context lines.
  const keep = new Set<number>();
  entries.forEach((e, idx) => {
    if (e.t !== ' ') {
      for (let k = idx - 2; k <= idx + 2; k++) keep.add(k);
    }
  });
  const out: string[] = [];
  let pendingGap = false;
  entries.forEach((e, idx) => {
    if (keep.has(idx)) {
      if (pendingGap && out.length > 0) out.push('  …');
      pendingGap = false;
      out.push(e.t + e.line);
    } else {
      pendingGap = true;
    }
  });
  return out;
}
