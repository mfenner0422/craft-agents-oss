import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import { ensureDay, listDays } from '@craft-agent/shared/days';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export function registerDaysHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.days.ENSURE, async (_ctx, workspaceId: string, dateISO?: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return ensureDay(resolveVaultRoot(workspace.rootPath, config), dateISO);
  });

  server.handle(RPC_CHANNELS.days.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    return listDays(resolveVaultRoot(workspace.rootPath, config), limit);
  });
}
