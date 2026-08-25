import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

export interface Skill {
  name: string;
  description: string;
  /** manual = invoked via /skill <name>; auto = injected when prompt matches keywords */
  trigger: 'manual' | 'auto';
  /** Keywords matched (case-insensitive) against the user prompt for auto skills. */
  keywords: string[];
  content: string;
  source: 'builtin' | 'user' | 'project';
}

/** Minimal frontmatter parser: `key: value` lines between --- markers. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2]!.trim() };
}

function parseSkillFile(raw: string, source: Skill['source'], fallbackName: string): Skill | null {
  const { meta, body } = parseFrontmatter(raw);
  if (!body) return null;
  const name = meta.name || fallbackName;
  return {
    name,
    description: meta.description || '',
    trigger: meta.trigger === 'auto' ? 'auto' : 'manual',
    keywords:
      typeof meta.keywords === 'string'
        ? meta.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
        : [],
    content: body,
    source,
  };
}

/**
 * Load skills from three layers (later layers override earlier by name):
 *   builtin: src/skills/builtin/*.md — shipped defaults
 *   user:    ~/.config/copium/skills/*.md
 *   project: <workspace>/.copium/skills/*.md
 */
export async function loadSkills(workspaceRoot?: string): Promise<Skill[]> {
  const layers: Array<{ dir: string; source: Skill['source'] }> = [
    { dir: path.join(import.meta.dir, 'builtin'), source: 'builtin' },
    { dir: path.join(homedir(), '.config', 'copium', 'skills'), source: 'user' },
  ];
  if (workspaceRoot) {
    layers.push({ dir: path.join(workspaceRoot, '.copium', 'skills'), source: 'project' });
  }

  const byName = new Map<string, Skill>();
  for (const layer of layers) {
    let files: string[];
    try {
      files = await fs.readdir(layer.dir);
    } catch {
      continue; // layer doesn't exist
    }
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      try {
        const raw = await fs.readFile(path.join(layer.dir, f), 'utf-8');
        const skill = parseSkillFile(raw, layer.source, f.replace(/\.md$/, ''));
        if (skill) byName.set(skill.name, skill);
      } catch {
        // skip unreadable skill files
      }
    }
  }
  return Array.from(byName.values());
}

/** Pick auto-triggered skills whose keywords appear in the user prompt. */
export function selectAutoSkills(skills: Skill[], userPrompt: string): Skill[] {
  const lower = userPrompt.toLowerCase();
  return skills.filter(
    (s) =>
      s.trigger === 'auto' &&
      s.keywords.length > 0 &&
      s.keywords.some((k) => lower.includes(k)),
  );
}
