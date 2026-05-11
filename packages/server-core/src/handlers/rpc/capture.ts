import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers';
import { captureItem, deleteCaptureItem, enrichUrl, listInboxItems, markCaptureTriaged, type CaptureItem } from '@craft-agent/shared/capture';
import { createTask, promoteTask, updateTask, type TaskCreateInput, type TaskListKind } from '@craft-agent/shared/tasks';
import { resolveVaultRoot, writeMarkdown } from '@craft-agent/shared/vault';
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.capture.SAVE,
  RPC_CHANNELS.capture.LIST,
  RPC_CHANNELS.capture.DELETE,
  RPC_CHANNELS.capture.PROMOTE,
  RPC_CHANNELS.capture.ENRICH_URL,
] as const;

export function registerCaptureHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.capture.SAVE, async (_ctx, input: {
    workspaceId: string;
    url?: string;
    title?: string;
    body: string;
    tags?: string[];
  }) => {
    if (!input.url?.trim() && !input.title?.trim() && !input.body?.trim()) {
      throw new Error('Capture requires content');
    }
    const workspace = getWorkspaceOrThrow(input.workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    const item = captureItem({ vaultRoot, url: input.url, title: input.title, body: input.body, tags: input.tags, skipEnrichment: true });
    const directTarget: TaskListKind | null = input.tags?.includes('next') ? 'next' : (input.tags?.includes('someday') ? 'someday' : null);
    let createdTaskId: string | null = null;
    if (directTarget) {
      try {
        const task = createTask(vaultRoot, {
          title: deriveTitle(item),
          day: null,
          list: directTarget,
          source: 'capture',
          source_ref: { type: 'capture', path: item.filePath },
          body: item.body,
        });
        createdTaskId = task.id;
        markCaptureTriaged(vaultRoot, item.id);
      } catch (error) {
        throw new Error(`Failed to route capture to ${directTarget}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    pushTyped(server, RPC_CHANNELS.capture.SAVED, { to: 'all' }, { workspaceId: input.workspaceId, item });

    if (item.url) {
      void enrichUrl(item.url).then(meta => {
        if (!meta.title && !meta.description && !meta.contentMarkdown && !meta.faviconUrl) return;
        const userNote = input.body?.trim();
        const isUserNote = userNote && userNote !== input.url?.trim() && userNote !== input.title?.trim();
        const parts: string[] = [];
        if (isUserNote) parts.push(userNote);
        if (meta.contentMarkdown) parts.push(meta.contentMarkdown);
        const enrichedBody = parts.length > 0 ? parts.join('\n\n---\n\n') : item.body;
        const enrichedItem = {
          ...item,
          title: item.title ?? meta.title,
          faviconUrl: item.faviconUrl ?? meta.faviconUrl,
          body: enrichedBody,
        };
        writeMarkdown(item.filePath, {
          id: item.id,
          captured_at: item.capturedAt,
          url: item.url,
          ...(enrichedItem.title ? { title: enrichedItem.title } : {}),
          ...(enrichedItem.faviconUrl ? { favicon_url: enrichedItem.faviconUrl } : {}),
          ...(meta.description ? { description: meta.description } : {}),
          ...(meta.author ? { author: meta.author } : {}),
          ...(meta.site ? { site: meta.site } : {}),
          ...(meta.published ? { published: meta.published } : {}),
          ...(meta.wordCount ? { word_count: meta.wordCount } : {}),
          tags: item.tags,
        }, enrichedBody);
        if (createdTaskId) {
          const enrichedTitle = (item.title?.trim() || meta.title?.trim()) ?? deriveTitle(item);
          const updated = updateTask(vaultRoot, createdTaskId, { title: enrichedTitle, body: enrichedBody });
          pushTyped(server, RPC_CHANNELS.tasks.CHANGED, { to: 'all' }, { workspaceId: input.workspaceId, task: updated });
        }
        pushTyped(server, RPC_CHANNELS.capture.SAVED, { to: 'all' }, { workspaceId: input.workspaceId, item: enrichedItem });
      }).catch(() => {});
    }

    return item;
  });

  server.handle(RPC_CHANNELS.capture.LIST, async (_ctx, workspaceId: string, limit?: number) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    return listInboxItems(vaultRoot, { limit });
  });

  server.handle(RPC_CHANNELS.capture.PROMOTE, async (_ctx, workspaceId: string, itemId: string, target: { kind: 'day'; dateISO: string; slot?: number } | { kind: 'next' } | { kind: 'someday' } | { kind: 'drop' }) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    const item = listInboxItems(vaultRoot, { limit: 1000 }).find(entry => entry.id === itemId);
    if (!item) throw new Error(`Capture item not found: ${itemId}`);
    const placement: Pick<TaskCreateInput, 'day' | 'slot' | 'list'> =
      target.kind === 'day'
        ? { day: target.dateISO, ...(target.slot != null ? { slot: target.slot } : {}), list: null }
        : target.kind === 'someday'
        ? { day: null, list: 'someday' }
        : { day: null, list: 'next' };
    const task = createTask(vaultRoot, {
      title: deriveTitle(item),
      source: 'capture',
      source_ref: { type: 'capture', path: item.filePath },
      body: item.body,
      ...placement,
    });
    const finalTask = target.kind === 'drop' ? promoteTask(vaultRoot, task.id, { kind: 'drop' }) : task;
    markCaptureTriaged(vaultRoot, itemId);
    return finalTask;
  });

  server.handle(RPC_CHANNELS.capture.DELETE, async (_ctx, workspaceId: string, itemId: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId);
    const config = loadWorkspaceConfig(workspace.rootPath);
    const vaultRoot = resolveVaultRoot(workspace.rootPath, config);
    deleteCaptureItem(vaultRoot, itemId);
  });

  server.handle(RPC_CHANNELS.capture.ENRICH_URL, async (_ctx, url: string) => enrichUrl(url));
}

function deriveTitle(item: CaptureItem): string {
  if (item.title?.trim()) return item.title.trim();
  for (const line of item.body.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*#+\s*/, '').trim();
    if (cleaned) return cleaned;
  }
  return 'Capture';
}
