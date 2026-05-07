import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import {
  assertDateISO,
  ensureBoard,
  ensureDay,
  getDaysBoard,
  getIncompleteTasks,
  listDays,
  pullForwardTasks,
  readDay,
  updateDayFile,
  updateTaskLists,
  type DayFileKind,
  type ReorderTaskListsPayload,
} from '@craft-agent/shared/days';
import { getTask, promoteTask, type TaskPromoteTarget } from '@craft-agent/shared/tasks';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import { ensureTaskExternalSync } from '../../services/task-external-sync';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.days.ENSURE,
  RPC_CHANNELS.days.GET,
  RPC_CHANNELS.days.GET_BOARD,
  RPC_CHANNELS.days.LIST,
  RPC_CHANNELS.days.INCOMPLETE_TASKS,
  RPC_CHANNELS.days.PULL_FORWARD,
  RPC_CHANNELS.days.UPDATE_FILE,
  RPC_CHANNELS.days.UPDATE_TASK_LISTS,
  RPC_CHANNELS.days.MOVE_TASK,
] as const;

export function registerDaysHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.days.ENSURE, async (_ctx, workspaceId: string, dateISO?: string) => {
    if (dateISO) assertDateISO(dateISO);
    const vaultRoot = resolveWorkspaceVaultRoot(workspaceId, server);
    const day = ensureDay(vaultRoot, dateISO);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO: day.dateISO });
    return day;
  });

  server.handle(RPC_CHANNELS.days.GET, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    return readDay(resolveWorkspaceVaultRoot(workspaceId, server), dateISO);
  });

  server.handle(RPC_CHANNELS.days.GET_BOARD, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    return getDaysBoard(resolveWorkspaceVaultRoot(workspaceId, server), dateISO);
  });

  server.handle(RPC_CHANNELS.days.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    return listDays(resolveWorkspaceVaultRoot(workspaceId, server), limit);
  });

  server.handle(RPC_CHANNELS.days.INCOMPLETE_TASKS, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    return getIncompleteTasks(resolveWorkspaceVaultRoot(workspaceId, server), dateISO);
  });

  server.handle(RPC_CHANNELS.days.PULL_FORWARD, async (_ctx, workspaceId: string, fromDateISO: string, toDateISO: string) => {
    assertDateISO(fromDateISO);
    assertDateISO(toDateISO);
    const tasks = pullForwardTasks(resolveWorkspaceVaultRoot(workspaceId, server), fromDateISO, toDateISO);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO: toDateISO });
    return tasks;
  });

  server.handle(RPC_CHANNELS.days.UPDATE_FILE, async (_ctx, workspaceId: string, dateISO: string, kind: DayFileKind, content: string) => {
    assertDateISO(dateISO);
    if (!['tasks', 'scratch', 'journal'].includes(kind)) throw new Error(`Invalid day file kind: ${kind}`);
    const day = updateDayFile(resolveWorkspaceVaultRoot(workspaceId, server), dateISO, kind, content);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO });
    return day;
  });

  server.handle(
    RPC_CHANNELS.days.UPDATE_TASK_LISTS,
    async (_ctx, workspaceId: string, dateISO: string, payload: ReorderTaskListsPayload) => {
      assertDateISO(dateISO);
      const board = updateTaskLists(resolveWorkspaceVaultRoot(workspaceId, server), dateISO, payload);
      pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO });
      return board;
    },
  );

  server.handle(
    RPC_CHANNELS.days.MOVE_TASK,
    async (_ctx, workspaceId: string, taskId: string, target: TaskPromoteTarget) => {
      const vaultRoot = resolveWorkspaceVaultRoot(workspaceId, server);
      if (target.kind === 'day') {
        assertDateISO(target.dateISO);
        ensureDay(vaultRoot, target.dateISO);
      }
      const before = getTask(vaultRoot, taskId);
      const task = promoteTask(vaultRoot, taskId, { ...target, reason: target.reason ?? 'cross-day-move' });
      const datesToRender = new Set<string>();
      if (before?.day) datesToRender.add(before.day);
      if (task.day) datesToRender.add(task.day);
      for (const date of datesToRender) {
        ensureBoard(vaultRoot, date);
        pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO: date });
      }
      pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task });
      return task;
    },
  );
}

function resolveWorkspaceVaultRoot(workspaceId: string, server: RpcServer): string {
  const workspace = getWorkspaceOrThrow(workspaceId);
  const config = loadWorkspaceConfig(workspace.rootPath);
  const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
  if (config?.vault?.externalSyncEnabled === true) ensureTaskExternalSync(workspaceId, vaultRoot, server);
  return vaultRoot;
}
