import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { generateShortId } from '../automations/resolve-config-path.ts';
import { readMarkdown, writeMarkdown } from '../vault/markdown.ts';
import type { TaskCreateInput, TaskListFilter, TaskListKind, TaskPromoteTarget, TaskRecord, TaskStatus } from './types.ts';
import { isActiveTaskStatus, validateTask } from './types.ts';

export function getTasksDir(vaultRoot: string): string {
  return join(vaultRoot, 'tasks');
}

export function getTaskPath(vaultRoot: string, id: string): string {
  return join(getTasksDir(vaultRoot), `${id}.md`);
}

export function hasTaskStore(vaultRoot: string): boolean {
  return existsSync(getTasksDir(vaultRoot));
}

export function listTasks(vaultRoot: string, filter: TaskListFilter = {}): TaskRecord[] {
  const dir = getTasksDir(vaultRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => readTaskFile(join(dir, name)))
    .filter(task => matchesFilter(task, filter))
    .sort(compareTasks);
}

export function getTask(vaultRoot: string, id: string): TaskRecord | null {
  const path = getTaskPath(vaultRoot, id);
  return existsSync(path) ? readTaskFile(path) : null;
}

export function createTask(vaultRoot: string, input: TaskCreateInput): TaskRecord {
  const now = input.created_at ?? new Date().toISOString();
  // Auto-compute slot when caller pins a task to a day but didn't pass one explicitly.
  // promoteTask already does this; mirroring it here keeps callers (capture, renderer add)
  // from having to know about slot bookkeeping.
  const resolvedSlot = input.slot ?? (input.day && !input.dropped_at ? nextSlotForDay(vaultRoot, input.day, input.id) : undefined);
  const task: TaskRecord = {
    id: input.id ?? generateShortId(),
    title: input.title.trim(),
    status: input.status ?? 'todo',
    day: input.day ?? null,
    ...(resolvedSlot != null ? { slot: resolvedSlot } : {}),
    list: input.list ?? null,
    source: input.source ?? 'manual',
    ...(input.source_ref ? { source_ref: input.source_ref } : {}),
    ...(input.due ? { due: input.due } : {}),
    created_at: now,
    updated_at: input.updated_at ?? now,
    ...(input.completed_at ? { completed_at: input.completed_at } : {}),
    ...(input.canceled_at ? { canceled_at: input.canceled_at } : {}),
    ...(input.dropped_at ? { dropped_at: input.dropped_at } : {}),
    committed_history: input.committed_history ?? (input.day ? [{ from_day: null, to_day: input.day, at: now, reason: 'create' }] : []),
    tags: input.tags ?? [],
    body: input.body ?? '',
  };
  normalizeTerminalTimestamps(task, now);
  validateTask(task);
  writeTask(vaultRoot, task);
  return task;
}

export function updateTask(vaultRoot: string, id: string, patch: Partial<Omit<TaskRecord, 'id' | 'filePath'>>): TaskRecord {
  const current = getTask(vaultRoot, id);
  if (!current) throw new Error(`Task not found: ${id}`);
  const now = new Date().toISOString();
  const next: TaskRecord = {
    ...current,
    ...patch,
    id,
    title: (patch.title ?? current.title).trim(),
    updated_at: now,
    body: patch.body ?? current.body,
  };
  normalizeTerminalTimestamps(next, now, current.status);
  if (patch.status && patch.status !== current.status && patch.committed_history === undefined) {
    next.committed_history = [
      ...current.committed_history,
      { from_day: current.day, to_day: next.day, at: now, reason: `status:${current.status}->${patch.status}`, status_from: current.status, status_to: patch.status },
    ];
  }
  validateTask(next);
  writeTask(vaultRoot, next);
  return next;
}

export function touchTaskRenders(vaultRoot: string): void {
  mkdirSync(getTasksDir(vaultRoot), { recursive: true });
}

export function promoteTask(vaultRoot: string, id: string, target: TaskPromoteTarget): TaskRecord {
  const current = getTask(vaultRoot, id);
  if (!current) throw new Error(`Task not found: ${id}`);
  const now = new Date().toISOString();
  const reason = target.reason ?? `promote:${target.kind}`;
  const patch: Partial<TaskRecord> = { updated_at: now };

  if (target.kind === 'day') {
    patch.status = isActiveTaskStatus(current.status) ? current.status : 'todo';
    patch.day = target.dateISO;
    patch.list = null;
    patch.slot = target.slot ?? nextSlotForDay(vaultRoot, target.dateISO, id);
    patch.dropped_at = undefined;
    patch.completed_at = undefined;
    patch.canceled_at = undefined;
    patch.committed_history = [...current.committed_history, { from_day: current.day, to_day: target.dateISO, at: now, reason }];
  } else if (target.kind === 'next' || target.kind === 'someday') {
    patch.status = isActiveTaskStatus(current.status) ? current.status : 'todo';
    patch.day = null;
    patch.list = target.kind;
    patch.slot = undefined;
    patch.dropped_at = undefined;
    patch.completed_at = undefined;
    patch.canceled_at = undefined;
    patch.committed_history = current.day !== null
      ? [...current.committed_history, { from_day: current.day, to_day: null, at: now, reason }]
      : current.committed_history;
  } else {
    patch.status = 'canceled';
    patch.day = null;
    patch.list = null;
    patch.slot = undefined;
    patch.canceled_at = now;
    patch.dropped_at = now;
  }

  return updateTask(vaultRoot, id, patch);
}

export function writeTask(vaultRoot: string, task: TaskRecord): void {
  validateTask(task);
  const path = getTaskPath(vaultRoot, task.id);
  mkdirSync(dirname(path), { recursive: true });
  const { body, filePath: _filePath, ...data } = task;
  writeMarkdown(path, data, body);
}

export function deleteAllTasks(vaultRoot: string): void {
  rmSync(getTasksDir(vaultRoot), { recursive: true, force: true });
}

export function listRenderedDayTasks(vaultRoot: string, day: string): TaskRecord[] {
  return listTasks(vaultRoot, { day }).filter(task => task.dropped_at == null);
}

export function listRenderedListTasks(vaultRoot: string, list: TaskListKind): TaskRecord[] {
  return listTasks(vaultRoot, { list, activeOnly: true });
}

export function listLingeringTasks(vaultRoot: string, todayISO: string, maxDays = 7): TaskRecord[] {
  const cutoff = addDaysISO(todayISO, -1);
  const floor = addDaysISO(todayISO, -maxDays);
  return listTasks(vaultRoot, { activeOnly: true })
    .filter(task => task.day != null && task.day < cutoff && task.day >= floor)
    .sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '') || compareTasks(a, b));
}

function readTaskFile(path: string): TaskRecord {
  const doc = readMarkdown(path);
  const id = String(doc.data.id ?? basename(path, '.md'));
  const task: TaskRecord = {
    id,
    title: String(doc.data.title ?? '').trim(),
    status: normalizeStatus(doc.data.status),
    day: typeof doc.data.day === 'string' ? doc.data.day : null,
    ...(Number.isInteger(doc.data.slot) ? { slot: Number(doc.data.slot) } : {}),
    list: doc.data.list === 'next' || doc.data.list === 'someday' ? doc.data.list : null,
    source: normalizeSource(doc.data.source),
    ...(typeof doc.data.source_ref === 'object' && doc.data.source_ref ? { source_ref: doc.data.source_ref as TaskRecord['source_ref'] } : {}),
    ...(typeof doc.data.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.data.due) ? { due: doc.data.due } : {}),
    created_at: String(doc.data.created_at ?? ''),
    updated_at: String(doc.data.updated_at ?? doc.data.created_at ?? ''),
    ...(typeof doc.data.completed_at === 'string' ? { completed_at: doc.data.completed_at } : {}),
    ...(typeof doc.data.canceled_at === 'string' ? { canceled_at: doc.data.canceled_at } : {}),
    ...(typeof doc.data.dropped_at === 'string' ? { dropped_at: doc.data.dropped_at } : {}),
    committed_history: Array.isArray(doc.data.committed_history) ? doc.data.committed_history as TaskRecord['committed_history'] : [],
    tags: Array.isArray(doc.data.tags) ? doc.data.tags.map(String) : [],
    body: doc.content,
    filePath: path,
  };
  validateTask(task);
  return task;
}

function matchesFilter(task: TaskRecord, filter: TaskListFilter): boolean {
  if (filter.activeOnly && !isActiveTaskStatus(task.status)) return false;
  if ('day' in filter && task.day !== filter.day) return false;
  if ('list' in filter && task.list !== filter.list) return false;
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!statuses.includes(task.status)) return false;
  }
  if (filter.tag && !task.tags.includes(filter.tag)) return false;
  return true;
}

function compareTasks(a: TaskRecord, b: TaskRecord): number {
  return (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER)
    || (a.day ?? '').localeCompare(b.day ?? '')
    || a.updated_at.localeCompare(b.updated_at)
    || a.id.localeCompare(b.id);
}

function nextSlotForDay(vaultRoot: string, day: string, excludingId?: string): number {
  const used = listRenderedDayTasks(vaultRoot, day)
    .filter(task => task.id !== excludingId)
    .map(task => task.slot ?? 0);
  return Math.max(0, ...used) + 1;
}

function normalizeStatus(value: unknown): TaskStatus {
  return value === 'in_progress' || value === 'delegated' || value === 'completed' || value === 'canceled' ? value : 'todo';
}

function normalizeSource(value: unknown): TaskRecord['source'] {
  return value === 'capture' || value === 'follow-up' || value === 'session' || value === 'meeting' ? value : 'manual';
}

function normalizeTerminalTimestamps(task: TaskRecord, now: string, previousStatus?: TaskStatus): void {
  if (task.status === 'completed') {
    task.completed_at ??= now;
    if (previousStatus && previousStatus !== 'completed') delete task.canceled_at;
  } else if (task.status === 'canceled') {
    task.canceled_at ??= now;
    if (previousStatus && previousStatus !== 'canceled') delete task.completed_at;
  } else {
    delete task.completed_at;
    delete task.canceled_at;
    delete task.dropped_at;
  }
}

function addDaysISO(dateISO: string, amount: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
