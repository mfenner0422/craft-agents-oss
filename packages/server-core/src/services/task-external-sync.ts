import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import {
  createTask,
  getTask,
  listRenderedDayTasks,
  listRenderedListTasks,
  promoteTask,
  updateTask,
  type TaskRecord,
} from '@craft-agent/shared/tasks';
import { parseRenderedTaskLines } from '@craft-agent/shared/tasks';
import { ensureBoard } from '@craft-agent/shared/days';
import { todayDateISO } from '@craft-agent/shared/days/date';
import { getSharedTaskListPath } from '@craft-agent/shared/days';
import { readManagedMarkdownBody } from '@craft-agent/shared/days';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';

interface WatchState {
  watchers: FSWatcher[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Last content hash processed per file path; used to suppress self-write loops */
  lastProcessedHash: Map<string, string>;
}

const watchers = new Map<string, WatchState>();

function watcherKey(workspaceId: string, vaultRoot: string): string {
  return `${workspaceId}:${vaultRoot}`;
}

function logWatcherError(context: string, error: unknown): void {
  console.error(`[task-external-sync] ${context}:`, error);
}

export function ensureTaskExternalSync(workspaceId: string, vaultRoot: string, server: RpcServer): void {
  const key = watcherKey(workspaceId, vaultRoot);
  if (watchers.has(key)) return;

  for (const otherKey of [...watchers.keys()]) {
    if (otherKey !== key) closeWatchState(otherKey);
  }

  const state: WatchState = { watchers: [], timer: null, lastProcessedHash: new Map() };
  watchers.set(key, state);

  for (const dir of [join(vaultRoot, 'daily'), join(vaultRoot, 'tasks')]) {
    if (!existsSync(dir)) continue;
    try {
      state.watchers.push(watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const filePath = join(dir, String(filename));
        if (!filePath.endsWith('.md')) return;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => handleChangedFile(workspaceId, vaultRoot, server, filePath, state), 150);
      }));
    } catch (error) {
      logWatcherError(`watch(${dir}) failed (likely unsupported platform for recursive watch)`, error);
    }
  }
}

export function stopTaskExternalSync(workspaceId: string, vaultRoot: string): void {
  closeWatchState(watcherKey(workspaceId, vaultRoot));
}

export function stopAllTaskExternalSync(): void {
  for (const key of [...watchers.keys()]) closeWatchState(key);
}

function closeWatchState(key: string): void {
  const state = watchers.get(key);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  for (const watcher of state.watchers) {
    try { watcher.close(); } catch (error) { logWatcherError(`watcher.close() for ${key}`, error); }
  }
  watchers.delete(key);
}

function handleChangedFile(workspaceId: string, vaultRoot: string, server: RpcServer, filePath: string, state: WatchState): void {
  try {
    if (!existsSync(filePath)) {
      state.lastProcessedHash.delete(filePath);
      return;
    }
    const content = readFileSync(filePath, 'utf-8');
    const contentHash = sha1(content);
    if (state.lastProcessedHash.get(filePath) === contentHash) return;

    const rel = relative(vaultRoot, filePath);
    if (rel.startsWith(`tasks${sep}`)) {
      const id = basename(filePath, '.md');
      const task = getTask(vaultRoot, id);
      if (task) {
        refreshRenders(vaultRoot, task);
        pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task });
      }
      state.lastProcessedHash.set(filePath, contentHash);
      return;
    }

    if (rel.startsWith(`daily${sep}`)) {
      const parsed = parseRenderedTaskLines(readManagedMarkdownBody(content));
      const target = classifyRenderedFile(vaultRoot, filePath);
      if (!target) return;
      const existing = target.kind === 'day'
        ? listRenderedDayTasks(vaultRoot, target.dateISO)
        : listRenderedListTasks(vaultRoot, target.kind);
      const existingById = new Map(existing.map(task => [task.id, task]));
      const incomingIds = new Set<string>();

      parsed.forEach((line, index) => {
        const id = line.id ?? `task_${randomUUID()}`;
        const current = existingById.get(id) ?? getTask(vaultRoot, id);
        // A line referencing a soft-deleted task is stale markdown; ignore it
        // (and don't add to incomingIds, so the next regenerate strips the line).
        if (current?.dropped_at != null) return;
        incomingIds.add(id);
        if (current) {
          const patch: Partial<TaskRecord> = {
            title: line.title,
            status: line.status,
          };
          if (target.kind === 'day') {
            patch.day = target.dateISO;
            patch.list = null;
            patch.slot = index + 1;
          } else {
            patch.day = null;
            patch.list = target.kind;
            patch.slot = undefined;
          }
          const updated = updateTask(vaultRoot, id, patch);
          pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task: updated });
        } else {
          const task = createTask(vaultRoot, target.kind === 'day'
            ? { id, title: line.title, status: line.status, day: target.dateISO, slot: index + 1, list: null }
            : { id, title: line.title, status: line.status, day: null, list: target.kind });
          pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task });
        }
      });

      for (const stale of existing) {
        if (!incomingIds.has(stale.id) && stale.status !== 'completed' && stale.status !== 'canceled') {
          const moved = promoteTask(vaultRoot, stale.id, { kind: 'next', reason: 'external-delete' });
          pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task: moved });
        }
      }
      ensureBoard(vaultRoot, target.kind === 'day' ? target.dateISO : todayDateISO());
      state.lastProcessedHash.set(filePath, contentHash);
    }
  } catch (error) {
    logWatcherError(`handleChangedFile(${filePath})`, error);
  }
}

function classifyRenderedFile(vaultRoot: string, filePath: string): { kind: 'day'; dateISO: string; key: string } | { kind: 'next' | 'someday'; key: string } | null {
  if (filePath === getSharedTaskListPath(vaultRoot, 'next')) return { kind: 'next', key: 'next' };
  if (filePath === getSharedTaskListPath(vaultRoot, 'someday')) return { kind: 'someday', key: 'someday' };
  const parts = relative(join(vaultRoot, 'daily'), filePath).split(sep);
  if (parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0] ?? '') && parts[1] === 'tasks.md') {
    return { kind: 'day', dateISO: parts[0]!, key: parts[0]! };
  }
  return null;
}

function refreshRenders(vaultRoot: string, task: TaskRecord): void {
  ensureBoard(vaultRoot, task.day ?? todayDateISO());
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
