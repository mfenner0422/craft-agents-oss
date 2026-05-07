import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertDateISO, getDayFilePath, getSharedTaskListPath, type DayFileKind, type SharedTaskListKind } from './paths.ts';
import { todayDateISO } from './date.ts';
import { atomicWriteFileSync } from '../utils/files.ts';
import {
  createTask,
  getTask,
  hasTaskStore,
  listRenderedDayTasks,
  listRenderedListTasks,
  promoteTask,
  updateTask,
} from '../tasks/store.ts';
import type { TaskRecord, TaskSource, TaskSourceRef } from '../tasks/types.ts';
import { parseRenderedTaskLines } from '../tasks/parse.ts';
import { renderManagedTaskBlock, replaceManagedTaskBlock } from '../tasks/render.ts';

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
  tasks: '# Today\n',
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
  tags?: string[];
  source?: TaskSource;
  source_ref?: TaskSourceRef;
  due?: string;
  body?: string;
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
  if (hasTaskStore(vaultRoot)) {
    regenerateDayTaskFile(vaultRoot, dateISO);
    const refreshed = readDay(vaultRoot, dateISO);
    if (refreshed) return refreshed;
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
  if (hasTaskStore(vaultRoot)) {
    return {
      ...day,
      tasks: {
        today: listRenderedDayTasks(vaultRoot, dateISO).map(taskRecordToDayTask),
        next: listRenderedListTasks(vaultRoot, 'next').map(taskRecordToDayTask),
        someday: listRenderedListTasks(vaultRoot, 'someday').map(taskRecordToDayTask),
      },
    };
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
  if (hasTaskStore(vaultRoot)) {
    return listRenderedDayTasks(vaultRoot, dateISO)
      .filter(task => task.status === 'todo' || task.status === 'in_progress' || task.status === 'delegated')
      .map(taskRecordToDayTask);
  }
  const filePath = getDayFilePath(vaultRoot, dateISO, 'tasks');
  if (!existsSync(filePath)) return [];
  return parseTaskList(readManagedMarkdownBody(readFileSync(filePath, 'utf-8')))
    .filter(task => task.status === 'todo' || task.status === 'in_progress' || task.status === 'delegated');
}

export function pullForwardTasks(vaultRoot: string, fromDateISO: string, toDateISO: string): DayTask[] {
  assertDateISO(fromDateISO);
  assertDateISO(toDateISO);
  if (hasTaskStore(vaultRoot)) {
    ensureDay(vaultRoot, toDateISO);
    const tasks = getIncompleteTasks(vaultRoot, fromDateISO);
    for (const task of tasks) {
      promoteTask(vaultRoot, task.id, { kind: 'day', dateISO: toDateISO, reason: 'pull-forward' });
    }
    regenerateDayTaskFile(vaultRoot, fromDateISO);
    regenerateDayTaskFile(vaultRoot, toDateISO);
    return tasks;
  }
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
  if (hasTaskStore(vaultRoot)) return listRenderedListTasks(vaultRoot, kind).map(taskRecordToDayTask);
  const path = getSharedTaskListPath(vaultRoot, kind);
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : loadSharedTemplate(vaultRoot, kind);
  return parseTaskList(readManagedMarkdownBody(content));
}

export function writeSharedTaskList(vaultRoot: string, kind: SharedTaskListKind, tasks: DayTask[]): DayTask[] {
  if (hasTaskStore(vaultRoot)) {
    const incomingIds = new Set(tasks.filter(t => t.text.trim()).map(t => t.id));
    for (const stale of listRenderedListTasks(vaultRoot, kind)) {
      if (!incomingIds.has(stale.id)) promoteTask(vaultRoot, stale.id, { kind: 'drop', reason: `removed-from-${kind}` });
    }
    for (const t of tasks.filter(t => t.text.trim())) {
      const current = getTask(vaultRoot, t.id);
      if (current) {
        updateTask(vaultRoot, t.id, { title: t.text, status: t.status, day: null, list: kind, slot: undefined });
      } else {
        createTask(vaultRoot, { id: t.id, title: t.text, status: t.status, day: null, list: kind });
      }
    }
    regenerateSharedTaskList(vaultRoot, kind);
    return tasks;
  }
  const path = getSharedTaskListPath(vaultRoot, kind);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, withManagedTitle(kind, serializeTaskList(tasks)));
  return tasks;
}

/**
 * Lighter-weight payload for `days.updateTaskLists` after step 8: only IDs
 * (in slot order) per list. Tasks must already exist in the canonical store
 * (created via `tasks.create`). Lists not in the payload are left alone.
 */
export interface ReorderTaskListsPayload {
  today?: string[];
  next?: string[];
  someday?: string[];
}

export function updateTaskLists(
  vaultRoot: string,
  dateISO: string,
  payload: ReorderTaskListsPayload,
): DaysBoardRecord {
  assertDateISO(dateISO);
  if (!hasTaskStore(vaultRoot)) {
    // Without a canonical task store nothing to reconcile; legacy markdown is read-only here.
    ensureDay(vaultRoot, dateISO);
    return getDaysBoard(vaultRoot, dateISO) ?? ensureBoard(vaultRoot, dateISO);
  }
  if (payload.today !== undefined) reconcileDayMembership(vaultRoot, dateISO, payload.today);
  if (payload.next !== undefined) reconcileListMembership(vaultRoot, 'next', payload.next);
  if (payload.someday !== undefined) reconcileListMembership(vaultRoot, 'someday', payload.someday);
  if (payload.today !== undefined) regenerateDayTaskFile(vaultRoot, dateISO);
  if (payload.next !== undefined) regenerateSharedTaskList(vaultRoot, 'next');
  if (payload.someday !== undefined) regenerateSharedTaskList(vaultRoot, 'someday');
  return getDaysBoard(vaultRoot, dateISO) ?? ensureBoard(vaultRoot, dateISO);
}

function reconcileDayMembership(vaultRoot: string, dateISO: string, ids: string[]): void {
  const incomingIds = new Set(ids);
  for (const stale of listRenderedDayTasks(vaultRoot, dateISO)) {
    if (!incomingIds.has(stale.id) && stale.status !== 'completed' && stale.status !== 'canceled') {
      promoteTask(vaultRoot, stale.id, { kind: 'next', reason: 'removed-from-day' });
    }
  }
  ids.forEach((id, index) => {
    const task = getTask(vaultRoot, id);
    if (!task) return;
    const desiredSlot = index + 1;
    if (task.day !== dateISO || task.list !== null || task.slot !== desiredSlot) {
      updateTask(vaultRoot, id, { day: dateISO, list: null, slot: desiredSlot });
    }
  });
}

function reconcileListMembership(vaultRoot: string, kind: SharedTaskListKind, ids: string[]): void {
  const incomingIds = new Set(ids);
  for (const stale of listRenderedListTasks(vaultRoot, kind)) {
    if (!incomingIds.has(stale.id)) {
      promoteTask(vaultRoot, stale.id, { kind: 'drop', reason: `removed-from-${kind}` });
    }
  }
  for (const id of ids) {
    const task = getTask(vaultRoot, id);
    if (!task) continue;
    if (task.list !== kind || task.day !== null) {
      updateTask(vaultRoot, id, { day: null, list: kind, slot: undefined });
    }
  }
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
  if (hasTaskStore(vaultRoot)) {
    regenerateDayTaskFile(vaultRoot, dateISO);
    regenerateSharedTaskList(vaultRoot, 'next');
    regenerateSharedTaskList(vaultRoot, 'someday');
    const refreshed = readDay(vaultRoot, dateISO) ?? day;
    return {
      ...refreshed,
      tasks: {
        today: listRenderedDayTasks(vaultRoot, dateISO).map(taskRecordToDayTask),
        next: listRenderedListTasks(vaultRoot, 'next').map(taskRecordToDayTask),
        someday: listRenderedListTasks(vaultRoot, 'someday').map(taskRecordToDayTask),
      },
    };
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
  return parseRenderedTaskLines(content).map(task => {
    const result: DayTask = {
      id: task.id ?? generateTaskId(`${task.status}:${task.title}`),
      text: task.title,
      status: task.status,
      line: task.line,
    };
    return result;
  });
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

function taskRecordToDayTask(task: TaskRecord): DayTask {
  return {
    id: task.id,
    text: task.title,
    status: task.status,
    line: `- [${STATUS_TO_MARKER[task.status] ?? ' '}] ${task.title} <!-- task:${task.id} -->`,
    ...(task.tags && task.tags.length > 0 ? { tags: task.tags } : {}),
    source: task.source,
    ...(task.source_ref ? { source_ref: task.source_ref } : {}),
    ...(task.due ? { due: task.due } : {}),
    ...(task.body ? { body: task.body } : {}),
  };
}

function regenerateDayTaskFile(vaultRoot: string, dateISO: string): void {
  const path = getDayFilePath(vaultRoot, dateISO, 'tasks');
  mkdirSync(dirname(path), { recursive: true });
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : loadTemplate(vaultRoot, 'tasks');
  const rendered = renderManagedTaskBlock(listRenderedDayTasks(vaultRoot, dateISO));
  atomicWriteFileSync(path, replaceManagedTaskBlock(content, rendered, 'Today'));
}

function regenerateSharedTaskList(vaultRoot: string, kind: SharedTaskListKind): void {
  const path = getSharedTaskListPath(vaultRoot, kind);
  mkdirSync(dirname(path), { recursive: true });
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : loadSharedTemplate(vaultRoot, kind);
  const rendered = renderManagedTaskBlock(listRenderedListTasks(vaultRoot, kind));
  atomicWriteFileSync(path, replaceManagedTaskBlock(content, rendered, MANAGED_TITLES[kind]));
}
