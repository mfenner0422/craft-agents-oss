import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertDateISO, getDayFilePath, type DayFileKind } from './paths.ts';
import { atomicWriteFileSync } from '../utils/files.ts';

const DAY_FILE_KINDS: DayFileKind[] = ['tasks', 'scratch', 'journal'];
const BUNDLED_TEMPLATES: Record<DayFileKind, string> = {
  tasks: '# Tasks\n\n- [ ] Plan the day\n',
  scratch: '# Scratch\n',
  journal: '# Journal\n',
};

export interface DayRecord {
  dateISO: string;
  files: Record<DayFileKind, string>;
}

export interface DayTask {
  id: string;
  text: string;
  line: string;
}

export function ensureDay(vaultRoot: string, dateISO = new Date().toISOString().slice(0, 10)): DayRecord {
  assertDateISO(dateISO);
  const files = {} as Record<DayFileKind, string>;
  for (const kind of DAY_FILE_KINDS) {
    const filePath = getDayFilePath(vaultRoot, dateISO, kind);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      atomicWriteFileSync(filePath, loadTemplate(vaultRoot, kind));
    }
    files[kind] = readFileSync(filePath, 'utf-8');
  }
  return { dateISO, files };
}

export function listDays(vaultRoot: string, limit = 30): string[] {
  const dailyRoot = join(vaultRoot, 'daily');
  if (!existsSync(dailyRoot)) return [];
  return readdirSync(dailyRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

export function getIncompleteTasks(vaultRoot: string, dateISO: string): DayTask[] {
  assertDateISO(dateISO);
  const filePath = getDayFilePath(vaultRoot, dateISO, 'tasks');
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter(line => /^\s*-\s+\[\s\]\s+/.test(line))
    .map(line => {
      const id = line.match(/<!--\s*task:([a-zA-Z0-9_-]+)\s*-->/)?.[1] ?? generateTaskId(line);
      const text = line
        .replace(/^\s*-\s+\[\s\]\s+/, '')
        .replace(/\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->\s*$/, '')
        .trim();
      return { id, text, line };
    });
}

export function pullForwardTasks(vaultRoot: string, fromDateISO: string, toDateISO: string): DayTask[] {
  assertDateISO(fromDateISO);
  assertDateISO(toDateISO);
  ensureDay(vaultRoot, toDateISO);
  const tasks = getIncompleteTasks(vaultRoot, fromDateISO);
  if (tasks.length === 0) return [];

  const targetPath = getDayFilePath(vaultRoot, toDateISO, 'tasks');
  const current = readFileSync(targetPath, 'utf-8');
  const existingIds = new Set(
    Array.from(current.matchAll(/<!--\s*task:([a-zA-Z0-9_-]+)\s*-->/g)).map(match => match[1])
  );
  const additions = tasks
    .filter(task => !existingIds.has(task.id))
    .map(task => `- [ ] ${task.text} <!-- task:${task.id} -->`);

  if (additions.length > 0) {
    const separator = current.endsWith('\n') ? '' : '\n';
    atomicWriteFileSync(targetPath, `${current}${separator}\n## Carried forward from ${fromDateISO}\n${additions.join('\n')}\n`);
  }

  return tasks;
}

export function updateDayFile(vaultRoot: string, dateISO: string, kind: DayFileKind, content: string): DayRecord {
  assertDateISO(dateISO);
  const filePath = getDayFilePath(vaultRoot, dateISO, kind);
  mkdirSync(dirname(filePath), { recursive: true });
  atomicWriteFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`);
  return ensureDay(vaultRoot, dateISO);
}

function loadTemplate(vaultRoot: string, kind: DayFileKind): string {
  const override = join(vaultRoot, '_templates', 'daily', `${kind}.md`);
  if (existsSync(override)) return readFileSync(override, 'utf-8');
  return BUNDLED_TEMPLATES[kind];
}

function generateTaskId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
