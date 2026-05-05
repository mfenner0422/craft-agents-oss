import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import { captureItem, enrichUrl, listInboxItems } from '@craft-agent/shared/capture';
import { resolveVaultRoot } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export function registerCaptureHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.capture.SAVE, async (_ctx, input: {
    workspaceId: string;
    source: string;
    url?: string;
    title?: string;
    body: string;
    tags?: string[];
  }) => {
    const workspace = getWorkspaceOrThrow(input.workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    return captureItem({ vaultRoot, source: input.source, url: input.url, title: input.title, body: input.body, tags: input.tags });
  });

  server.handle(RPC_CHANNELS.capture.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    return listInboxItems(vaultRoot, limit);
  });

  server.handle(RPC_CHANNELS.capture.ENRICH_URL, async (_ctx, url: string) => enrichUrl(url));
}
