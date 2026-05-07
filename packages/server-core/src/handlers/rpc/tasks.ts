import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import {
  createTask,
  getTask,
  listTasks,
  promoteTask,
  updateTask,
  type TaskCreateInput,
  type TaskListFilter,
  type TaskPromoteTarget,
  type TaskRecord,
} from '@craft-agent/shared/tasks';
import { ensureBoard } from '@craft-agent/shared/days';
import { todayDateISO } from '@craft-agent/shared/days/date';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import { ensureTaskExternalSync } from '../../services/task-external-sync';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tasks.LIST,
  RPC_CHANNELS.tasks.GET,
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.UPDATE,
  RPC_CHANNELS.tasks.PROMOTE,
] as const;

export function registerTasksHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.tasks.LIST, async (_ctx, workspaceId: string, filter?: TaskListFilter) => {
    const { vaultRoot } = resolveWorkspaceVault(workspaceId, server);
    return listTasks(vaultRoot, filter);
  });

  server.handle(RPC_CHANNELS.tasks.GET, async (_ctx, workspaceId: string, id: string) => {
    const { vaultRoot } = resolveWorkspaceVault(workspaceId, server);
    return getTask(vaultRoot, id);
  });

  server.handle(RPC_CHANNELS.tasks.CREATE, async (_ctx, workspaceId: string, input: TaskCreateInput) => {
    const { vaultRoot } = resolveWorkspaceVault(workspaceId, server);
    const task = createTask(vaultRoot, input);
    refreshTaskRenders(vaultRoot, task);
    pushTaskChanged(server, workspaceId, task);
    return task;
  });

  server.handle(RPC_CHANNELS.tasks.UPDATE, async (_ctx, workspaceId: string, id: string, patch: Partial<Omit<TaskRecord, 'id' | 'filePath'>>) => {
    const { vaultRoot } = resolveWorkspaceVault(workspaceId, server);
    const before = getTask(vaultRoot, id);
    const task = updateTask(vaultRoot, id, patch);
    refreshTaskRenders(vaultRoot, task, before ?? undefined);
    pushTaskChanged(server, workspaceId, task);
    return task;
  });

  server.handle(RPC_CHANNELS.tasks.PROMOTE, async (_ctx, workspaceId: string, id: string, target: TaskPromoteTarget) => {
    const { vaultRoot } = resolveWorkspaceVault(workspaceId, server);
    const before = getTask(vaultRoot, id);
    const task = promoteTask(vaultRoot, id, target);
    refreshTaskRenders(vaultRoot, task, before ?? undefined);
    pushTaskChanged(server, workspaceId, task);
    return task;
  });
}

function resolveWorkspaceVault(workspaceId: string, server: RpcServer): { vaultRoot: string } {
  const workspace = getWorkspaceOrThrow(workspaceId);
  const config = loadWorkspaceConfig(workspace.rootPath);
  const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
  if (config?.vault?.externalSyncEnabled === true) ensureTaskExternalSync(workspaceId, vaultRoot, server);
  return { vaultRoot };
}

function refreshTaskRenders(vaultRoot: string, task: TaskRecord, before?: TaskRecord): void {
  const dates = new Set<string>();
  if (task.day) dates.add(task.day);
  if (before?.day) dates.add(before.day);
  if (dates.size === 0) dates.add(todayDateISO());
  for (const date of dates) ensureBoard(vaultRoot, date);
}

function pushTaskChanged(server: RpcServer, workspaceId: string, task: TaskRecord): void {
  pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId, task });
}
