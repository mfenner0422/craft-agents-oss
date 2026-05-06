import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertDateISO, getDayFilePath, getSharedTaskListPath, type DayFileKind, type SharedTaskListKind } from './paths.ts';
import { todayDateISO } from './date.ts';
import { atomicWriteFileSync } from '../utils/files.ts';

const DAY_FILE_KINDS: DayFileKind[] = ['tasks', 'scratch', 'journal'];
const SHARED_TASK_LIST_KINDS: SharedTaskListKind[] = ['next', 'someday'];
const MANAGED_TITLES: Record<DayFileKind | SharedTaskListKind, string> = {
  tasks: 'Today',
  scratch: 'Scratch',
  journal: 'Journal',
  next: 'Next',
  someday: 'Someday',
};
const BUNDLED_TEMPLATES: Record<DayFileKind, string> = {
  tasks: '# Today\n\n- [ ] Plan the day\n',
  scratch: '# Scratch\n',
  journal: '# Journal\n',
};
const BUNDLED_SHARED_TEMPLATES: Record<SharedTaskListKind, string> = {
  next: '# Next\n',
  someday: '# Someday\n',
};
const STATUS_TO_MARKER: Record<DayTaskStatus, string> = {
  todo: ' ',
  in_progress: '/',
  delegated: '>',
  completed: 'x',
  canceled: '-',
};
const MARKER_TO_STATUS: Record<string, DayTaskStatus> = {
  ' ': 'todo',
  '/': 'in_progress',
  '>': 'delegated',
  x: 'completed',
  X: 'completed',
  '-': 'canceled',
};

export interface DayRecord {
  dateISO: string;
  files: Record<DayFileKind, string>;
  bodies: Record<DayFileKind, string>;
}

export type DayTaskStatus = 'todo' | 'in_progress' | 'delegated' | 'completed' | 'canceled';

export interface DayTask {
  id: string;
  text: string;
  status: DayTaskStatus;
  line?: string;
}

export interface DaysBoardRecord extends DayRecord {
  tasks: {
    today: DayTask[];
    next: DayTask[];
    someday: DayTask[];
  };
}

export function ensureDay(vaultRoot: string, dateISO = todayDateISO()): DayRecord {
  assertDateISO(dateISO);
  const files = {} as Record<DayFileKind, string>;
  const bodies = {} as Record<DayFileKind, string>;
  for (const kind of DAY_FILE_KINDS) {
    const filePath = getDayFilePath(vaultRoot, dateISO, kind);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      atomicWriteFileSync(filePath, loadTemplate(vaultRoot, kind));
    }
    const body = readManagedMarkdownBody(readFileSync(filePath, 'utf-8'));
    bodies[kind] = body;
    files[kind] = withManagedTitle(kind, body);
  }
  return { dateISO, files, bodies };
}

export function readDay(vaultRoot: string, dateISO: string): DayRecord | null {
  assertDateISO(dateISO);
  const files = {} as Record<DayFileKind, string>;
  const bodies = {} as Record<DayFileKind, string>;
  let anyExist = false;
  for (const kind of DAY_FILE_KINDS) {
    const filePath = getDayFilePath(vaultRoot, dateISO, kind);
    let content: string;
    if (existsSync(filePath)) {
      anyExist = true;
      content = readFileSync(filePath, 'utf-8');
    } else {
      content = loadTemplate(vaultRoot, kind);
    }
    const body = readManagedMarkdownBody(content);
    bodies[kind] = body;
    files[kind] = withManagedTitle(kind, body);
  }
  return anyExist ? { dateISO, files, bodies } : null;
}

export function getDaysBoard(vaultRoot: string, dateISO: string): DaysBoardRecord | null {
  const day = readDay(vaultRoot, dateISO);
  if (!day) return null;
  return {
    ...day,
    tasks: {
      today: parseTaskList(day.bodies.tasks),
      next: readSharedTaskList(vaultRoot, 'next'),
      someday: readSharedTaskList(vaultRoot, 'someday'),
    },
  };
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
  return parseTaskList(readManagedMarkdownBody(readFileSync(filePath, 'utf-8')))
    .filter(task => task.status === 'todo' || task.status === 'in_progress' || task.status === 'delegated');
}

export function pullForwardTasks(vaultRoot: string, fromDateISO: string, toDateISO: string): DayTask[] {
  assertDateISO(fromDateISO);
  assertDateISO(toDateISO);
  ensureDay(vaultRoot, toDateISO);
  const tasks = getIncompleteTasks(vaultRoot, fromDateISO);
  if (tasks.length === 0) return [];

  const targetPath = getDayFilePath(vaultRoot, toDateISO, 'tasks');
  const current = readFileSync(targetPath, 'utf-8');
  const existing = parseTaskList(readManagedMarkdownBody(current));
  const existingIds = new Set(existing.map(task => task.id));
  const additions = tasks
    .filter(task => !existingIds.has(task.id))
    .map(task => ({ ...task, status: 'todo' as const }));

  if (additions.length > 0) {
    const nextTasks = [...existing, ...additions];
    atomicWriteFileSync(targetPath, withManagedTitle('tasks', serializeTaskList(nextTasks)));
  }

  return tasks;
}

export function updateDayFile(vaultRoot: string, dateISO: string, kind: DayFileKind, content: string): DayRecord {
  assertDateISO(dateISO);
  const filePath = getDayFilePath(vaultRoot, dateISO, kind);
  mkdirSync(dirname(filePath), { recursive: true });
  atomicWriteFileSync(filePath, withManagedTitle(kind, readManagedMarkdownBody(content)));
  return ensureDay(vaultRoot, dateISO);
}

export function readManagedMarkdownBody(content: string): string {
  return content.replace(/^\s*#\s+[^\n]*\n?/, '').replace(/^\n/, '');
}

export function writeManagedMarkdownBody(vaultRoot: string, dateISO: string, kind: DayFileKind, body: string): DayRecord {
  return updateDayFile(vaultRoot, dateISO, kind, body);
}

export function readSharedTaskList(vaultRoot: string, kind: SharedTaskListKind): DayTask[] {
  const path = getSharedTaskListPath(vaultRoot, kind);
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : loadSharedTemplate(vaultRoot, kind);
  return parseTaskList(readManagedMarkdownBody(content));
}

export function writeSharedTaskList(vaultRoot: string, kind: SharedTaskListKind, tasks: DayTask[]): DayTask[] {
  const path = getSharedTaskListPath(vaultRoot, kind);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, withManagedTitle(kind, serializeTaskList(tasks)));
  return tasks;
}

export function updateTaskLists(
  vaultRoot: string,
  dateISO: string,
  payload: { today: DayTask[]; next: DayTask[]; someday: DayTask[] },
): DaysBoardRecord {
  assertDateISO(dateISO);
  ensureDay(vaultRoot, dateISO);
  const todayPath = getDayFilePath(vaultRoot, dateISO, 'tasks');
  atomicWriteFileSync(todayPath, withManagedTitle('tasks', serializeTaskList(payload.today)));
  writeSharedTaskList(vaultRoot, 'next', payload.next);
  writeSharedTaskList(vaultRoot, 'someday', payload.someday);
  return getDaysBoard(vaultRoot, dateISO) ?? ensureBoard(vaultRoot, dateISO);
}

export function ensureBoard(vaultRoot: string, dateISO = todayDateISO()): DaysBoardRecord {
  const day = ensureDay(vaultRoot, dateISO);
  for (const kind of SHARED_TASK_LIST_KINDS) {
    const path = getSharedTaskListPath(vaultRoot, kind);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      atomicWriteFileSync(path, loadSharedTemplate(vaultRoot, kind));
    }
  }
  return {
    ...day,
    tasks: {
      today: parseTaskList(day.bodies.tasks),
      next: readSharedTaskList(vaultRoot, 'next'),
      someday: readSharedTaskList(vaultRoot, 'someday'),
    },
  };
}

export function parseTaskList(content: string): DayTask[] {
  const tasks: DayTask[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\[([ xX/>\-])\]\s+(.+?)\s*$/);
    const marker = match?.[1];
    const textWithId = match?.[2];
    if (!marker || !textWithId) continue;
    const rawText = textWithId.replace(/\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->\s*$/, '').trim();
    if (!rawText) continue;
    const id = line.match(/<!--\s*task:([a-zA-Z0-9_-]+)\s*-->/)?.[1] ?? generateTaskId(`${marker}:${rawText}`);
    tasks.push({ id, text: rawText, status: MARKER_TO_STATUS[marker] ?? 'todo', line });
  }
  return tasks;
}

export function serializeTaskList(tasks: DayTask[]): string {
  const lines = tasks
    .filter(task => task.text.trim().length > 0)
    .map(task => `- [${STATUS_TO_MARKER[task.status] ?? ' '}] ${task.text.trim()} <!-- task:${task.id || generateTaskId(task.text)} -->`);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function loadTemplate(vaultRoot: string, kind: DayFileKind): string {
  const override = join(vaultRoot, '_templates', 'daily', `${kind}.md`);
  const content = existsSync(override) ? readFileSync(override, 'utf-8') : BUNDLED_TEMPLATES[kind];
  return withManagedTitle(kind, readManagedMarkdownBody(content));
}

function loadSharedTemplate(vaultRoot: string, kind: SharedTaskListKind): string {
  const override = join(vaultRoot, '_templates', 'daily', `${kind}.md`);
  const content = existsSync(override) ? readFileSync(override, 'utf-8') : BUNDLED_SHARED_TEMPLATES[kind];
  return withManagedTitle(kind, readManagedMarkdownBody(content));
}

function withManagedTitle(kind: DayFileKind | SharedTaskListKind, body: string): string {
  const normalizedBody = body.endsWith('\n') || body.length === 0 ? body : `${body}\n`;
  return `# ${MANAGED_TITLES[kind]}\n${normalizedBody.length > 0 ? `\n${normalizedBody}` : ''}`;
}

function generateTaskId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
