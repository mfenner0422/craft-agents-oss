import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import { captureItem, deleteCaptureItem, enrichUrl, listInboxItems } from '@craft-agent/shared/capture';
import { resolveVaultRoot, writeMarkdown } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.capture.SAVE,
  RPC_CHANNELS.capture.LIST,
  RPC_CHANNELS.capture.DELETE,
  RPC_CHANNELS.capture.ENRICH_URL,
] as const;

export function registerCaptureHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.capture.SAVE, async (_ctx, input: {
    workspaceId: string;
    source: string;
    url?: string;
    title?: string;
    body: string;
    tags?: string[];
  }) => {
    if (!input.url?.trim() && !input.title?.trim()) {
      throw new Error('Capture requires either a URL or a title');
    }
    const workspace = getWorkspaceOrThrow(input.workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    const item = captureItem({ vaultRoot, source: input.source, url: input.url, title: input.title, body: input.body, tags: input.tags, skipEnrichment: true });
    pushTyped(server, RPC_CHANNELS.capture.SAVED, { to: 'all' }, { workspaceId: input.workspaceId, item });

    if (item.url) {
      void enrichUrl(item.url).then(meta => {
        if (!meta.title && !meta.description && !meta.contentMarkdown) return;
        const userNote = input.body?.trim();
        const isUserNote = userNote && userNote !== input.url?.trim() && userNote !== input.title?.trim();
        const parts: string[] = [];
        if (isUserNote) parts.push(userNote);
        if (meta.contentMarkdown) parts.push(meta.contentMarkdown);
        const enrichedBody = parts.length > 0 ? parts.join('\n\n---\n\n') : item.body;
        const enrichedItem = {
          ...item,
          title: item.title ?? meta.title,
          body: enrichedBody,
        };
        writeMarkdown(item.filePath, {
          id: item.id,
          captured_at: item.capturedAt,
          source: item.source,
          url: item.url,
          title: enrichedItem.title,
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.author ? { author: meta.author } : {}),
          ...(meta.site ? { site: meta.site } : {}),
          ...(meta.published ? { published: meta.published } : {}),
          ...(meta.wordCount ? { word_count: meta.wordCount } : {}),
          tags: item.tags,
        }, enrichedBody);
        pushTyped(server, RPC_CHANNELS.capture.SAVED, { to: 'all' }, { workspaceId: input.workspaceId, item: enrichedItem });
      }).catch(() => {});
    }

    return item;
  });

  server.handle(RPC_CHANNELS.capture.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    return listInboxItems(vaultRoot, limit);
  });

  server.handle(RPC_CHANNELS.capture.DELETE, async (_ctx, workspaceId: string, itemId: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    deleteCaptureItem(vaultRoot, itemId);
  });

  server.handle(RPC_CHANNELS.capture.ENRICH_URL, async (_ctx, url: string) => enrichUrl(url));
}
