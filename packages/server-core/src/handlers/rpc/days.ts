import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import { assertDateISO, ensureDay, getIncompleteTasks, listDays, pullForwardTasks } from '@craft-agent/shared/days';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export function registerDaysHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.days.ENSURE, async (_ctx, workspaceId: string, dateISO?: string) => {
    if (dateISO) assertDateISO(dateISO);
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return ensureDay(resolveVaultRoot(workspace.rootPath, config), dateISO);
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
    return pullForwardTasks(resolveVaultRoot(workspace.rootPath, config), fromDateISO, toDateISO);
  });
}
