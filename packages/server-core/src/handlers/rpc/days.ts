import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import {
  assertDateISO,
  ensureDay,
  getDaysBoard,
  getIncompleteTasks,
  listDays,
  pullForwardTasks,
  readDay,
  updateDayFile,
  updateTaskLists,
  type DayFileKind,
  type DayTask,
} from '@craft-agent/shared/days';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
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
] as const;

export function registerDaysHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.days.ENSURE, async (_ctx, workspaceId: string, dateISO?: string) => {
    if (dateISO) assertDateISO(dateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const day = ensureDay(resolveVaultRoot(workspace.rootPath, config), dateISO);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO: day.dateISO });
    return day;
  });

  server.handle(RPC_CHANNELS.days.GET, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return readDay(resolveVaultRoot(workspace.rootPath, config), dateISO);
  });

  server.handle(RPC_CHANNELS.days.GET_BOARD, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return getDaysBoard(resolveVaultRoot(workspace.rootPath, config), dateISO);
  });

  server.handle(RPC_CHANNELS.days.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return listDays(resolveVaultRoot(workspace.rootPath, config), limit);
  });

  server.handle(RPC_CHANNELS.days.INCOMPLETE_TASKS, async (_ctx, workspaceId: string, dateISO: string) => {
    assertDateISO(dateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return getIncompleteTasks(resolveVaultRoot(workspace.rootPath, config), dateISO);
  });

  server.handle(RPC_CHANNELS.days.PULL_FORWARD, async (_ctx, workspaceId: string, fromDateISO: string, toDateISO: string) => {
    assertDateISO(fromDateISO);
    assertDateISO(toDateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const tasks = pullForwardTasks(resolveVaultRoot(workspace.rootPath, config), fromDateISO, toDateISO);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO: toDateISO });
    return tasks;
  });

  server.handle(RPC_CHANNELS.days.UPDATE_FILE, async (_ctx, workspaceId: string, dateISO: string, kind: DayFileKind, content: string) => {
    assertDateISO(dateISO);
    if (!['tasks', 'scratch', 'journal'].includes(kind)) throw new Error(`Invalid day file kind: ${kind}`);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const day = updateDayFile(resolveVaultRoot(workspace.rootPath, config), dateISO, kind, content);
    pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO });
    return day;
  });

  server.handle(
    RPC_CHANNELS.days.UPDATE_TASK_LISTS,
    async (_ctx, workspaceId: string, dateISO: string, payload: { today: DayTask[]; next: DayTask[]; someday: DayTask[] }) => {
      assertDateISO(dateISO);
      const workspace = getWorkspaceOrThrow(workspaceId);
      const config = loadWorkspaceConfig(workspace.rootPath);
      const board = updateTaskLists(resolveVaultRoot(workspace.rootPath, config), dateISO, payload);
      pushTyped(server, RPC_CHANNELS.days.CHANGED, { to: 'all' }, { workspaceId, dateISO });
      return board;
    },
  );
}
