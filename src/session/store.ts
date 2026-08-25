import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool' | 'status';
  content: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function sessionsDir(): string {
  return path.join(homedir(), '.config', 'copium', 'sessions');
}

/** Persist a session transcript as JSON (atomic-ish via temp file). */
export async function saveSession(
  id: string,
  title: string,
  messages: StoredMessage[],
): Promise<void> {
  const dir = sessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify({
    id,
    title,
    createdAt: getCreatedAt(dir, id),
    updatedAt: Date.now(),
    messages,
  });
  const target = path.join(dir, `${id}.json`);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, payload, 'utf-8');
  await fs.rename(tmp, target);
}

async function getCreatedAt(dir: string, id: string): Promise<number> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf-8'));
    return typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  } catch {
    return Date.now();
  }
}

/** Load a stored transcript by id. */
export async function loadSession(id: string): Promise<StoredMessage[] | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(sessionsDir(), `${id}.json`), 'utf-8'));
    return Array.isArray(raw.messages) ? (raw.messages as StoredMessage[]) : null;
  } catch {
    return null;
  }
}

/** Most recent sessions, newest first. */
export async function listSessions(limit = 15): Promise<SessionMeta[]> {
  const dir = sessionsDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const metas: SessionMeta[] = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'));
      metas.push({
        id: raw.id ?? f.replace('.json', ''),
        title: typeof raw.title === 'string' ? raw.title : '(untitled)',
        createdAt: raw.createdAt ?? 0,
        updatedAt: raw.updatedAt ?? 0,
      });
    } catch {
      // skip corrupted
    }
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas.slice(0, limit);
}

/** Derive a short title from the first user message. */
export function deriveTitle(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '(empty)';
  return first.content.replace(/\s+/g, ' ').slice(0, 60);
}

export interface ExportResult {
  folderPath: string;
  messageCount: number;
}

/**
 * Export a session as a portable folder:
 *   <dest>/copium-session-<id>/
 *     session.json   — full transcript
 *     meta.json      — id, title, dates, version
 *     README.md      — human-readable transcript
 */
export async function exportSession(
  id: string,
  destDir?: string,
): Promise<ExportResult> {
  const messages = await loadSession(id);
  if (!messages) throw new Error(`Session not found: ${id}`);
  const meta = (await listSessions(500)).find((m) => m.id === id);

  const base = destDir?.trim() || process.cwd();
  const folder = path.join(base, `copium-session-${id.replace(/[^\w.-]/g, '_')}`);
  await fs.mkdir(folder, { recursive: true });

  await fs.writeFile(
    path.join(folder, 'session.json'),
    JSON.stringify({ id, title: meta?.title ?? deriveTitle(messages), messages }, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(folder, 'meta.json'),
    JSON.stringify(
      {
        id,
        title: meta?.title ?? deriveTitle(messages),
        createdAt: meta?.createdAt ?? null,
        updatedAt: meta?.updatedAt ?? Date.now(),
        exportedAt: Date.now(),
        copiumVersion: '1.0.0',
        messageCount: messages.length,
      },
      null,
      2,
    ),
    'utf-8',
  );
  await fs.writeFile(path.join(folder, 'README.md'), renderTranscriptMarkdown(meta?.title ?? id, messages), 'utf-8');

  return { folderPath: folder, messageCount: messages.length };
}

/** Human-readable markdown rendering of a transcript. */
function renderTranscriptMarkdown(title: string, messages: StoredMessage[]): string {
  const parts: string[] = [`# Copium Session — ${title}\n`];
  for (const m of messages) {
    if (m.role === 'user') parts.push(`## 🧑 User\n\n${m.content}\n`);
    else if (m.role === 'assistant') parts.push(`## 🤖 Copium\n\n${m.content}\n`);
    else if (m.content.startsWith('**Tool')) parts.push(`<details><summary>tool</summary>\n\n${m.content}\n\n</details>\n`);
  }
  return parts.join('\n');
}

export interface ImportResult {
  id: string;
  title: string;
  messageCount: number;
  folderPath: string;
}

/**
 * Import an exported session folder. Copies session.json into the local
 * sessions dir; if the id already exists locally, a suffix is appended.
 */
export async function importSession(folderPath: string): Promise<ImportResult> {
  let raw: any;
  try {
    raw = JSON.parse(await fs.readFile(path.join(folderPath, 'session.json'), 'utf-8'));
  } catch {
    throw new Error(`Not a valid Copium session folder: ${folderPath} (missing session.json)`);
  }
  if (!Array.isArray(raw.messages) || typeof raw.id !== 'string') {
    throw new Error('session.json is malformed (missing id or messages).');
  }

  let id = raw.id;
  const existing = await listSessions(500);
  while (existing.some((m) => m.id === id)) {
    id = `${id}_imported`;
  }
  const title = typeof raw.title === 'string' ? raw.title : deriveTitle(raw.messages);
  await saveSession(id, title, raw.messages as StoredMessage[]);
  return { id, title, messageCount: raw.messages.length, folderPath };
}
