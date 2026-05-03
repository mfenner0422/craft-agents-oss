import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rpcCall } from './rpc.ts';

interface MessagingBinding {
  id: string;
  workspaceId: string;
  sessionId: string;
  platform: string;
  channelId: string;
  channelName?: string;
  enabled: boolean;
}

interface CraftSession {
  id: string;
  name?: string;
  labels?: string[];
}

export async function resetMainSession(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? '/workspace';
  const workspaceId = typeof payload.workspaceId === 'string'
    ? payload.workspaceId
    : process.env.CRAFT_WORKSPACE_ID ?? 'ws_rockyii';
  const platform = typeof payload.platform === 'string' ? payload.platform : 'telegram';
  const requestedChannelId = typeof payload.channelId === 'string' ? payload.channelId : undefined;
  const dryRun = payload.dryRun === true;

  const bindings = await rpcCall<MessagingBinding[]>('messaging:getBindings');
  const binding = bindings.find((item) =>
    item.enabled &&
    item.platform === platform &&
    (!requestedChannelId || item.channelId === requestedChannelId)
  );
  if (!binding) {
    throw new Error(`No enabled ${platform} binding found`);
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      workspaceId,
      platform: binding.platform,
      channelId: binding.channelId,
      currentSessionId: binding.sessionId,
    };
  }

  const date = new Date().toISOString().slice(0, 10);
  const session = await rpcCall<CraftSession>('sessions:create', workspaceId, {
    name: `Rocky main ${date}`,
    permissionMode: 'ask',
    labels: ['coordinator', 'role::main'],
  });

  const newBinding = await rpcCall<MessagingBinding>(
    'messaging:bindChannel',
    session.id,
    binding.platform,
    binding.channelId,
    binding.channelName,
  );

  await removeCoordinatorLabel(binding.sessionId, workspaceId).catch((error) => {
    console.warn('[main-session-reset] could not update old session labels', error);
  });

  writeCurrentPointers(workspaceRoot, {
    main_session_id: session.id,
    previous_main_session_id: binding.sessionId,
    last_main_session_reset: new Date().toISOString(),
  });

  return {
    ok: true,
    workspaceId,
    platform: binding.platform,
    channelId: binding.channelId,
    oldSessionId: binding.sessionId,
    newSessionId: session.id,
    bindingId: newBinding.id,
  };
}

async function removeCoordinatorLabel(sessionId: string, workspaceId: string): Promise<void> {
  const sessions = await rpcCall<CraftSession[]>('sessions:get', workspaceId);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session?.labels?.length) return;
  const labels = session.labels.filter((label) => label !== 'coordinator' && label !== 'role::main');
  if (labels.length === session.labels.length) return;
  await rpcCall('sessions:command', sessionId, { type: 'setLabels', labels });
}

function writeCurrentPointers(workspaceRoot: string, updates: Record<string, string>): void {
  const stateDir = join(workspaceRoot, 'state');
  const pointersPath = join(stateDir, 'current-pointers.md');
  mkdirSync(stateDir, { recursive: true });

  const existing = existsSync(pointersPath)
    ? readFileSync(pointersPath, 'utf8').split('\n')
    : ['# Current Pointers', ''];
  const seen = new Set<string>();
  const lines = existing.map((line) => {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) return line;
    const key = match[1]!;
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}: ${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}: ${value}`);
  }

  writeFileSync(pointersPath, `${lines.join('\n').trimEnd()}\n`);
}
