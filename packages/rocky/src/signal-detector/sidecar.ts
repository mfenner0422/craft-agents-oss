import { detectDecisionSignal, detectEntitySignals } from './patterns.ts';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface SignalDetectorOptions {
  port?: number;
  entitySlugs?: string[];
  onSignal?: (matches: ReturnType<typeof detectEntitySignals>) => void | Promise<void>;
}

export function startSignalDetector(options: SignalDetectorOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? 48212;
  const entitySlugs = options.entitySlugs ?? [];

  return Bun.serve({
    port,
    async fetch(req) {
      if (new URL(req.url).pathname !== '/signal') {
        return new Response('not found', { status: 404 });
      }

      const payload = await req.json().catch((): Record<string, unknown> => ({}));
      const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const text = typeof data.text === 'string'
        ? data.text
        : typeof data.prompt === 'string'
          ? data.prompt
          : JSON.stringify(data);

      const matches = [
        ...detectEntitySignals(text, entitySlugs),
        ...[detectDecisionSignal(text)].filter(Boolean),
      ];

      if (matches.length > 0 && options.onSignal) {
        await options.onSignal(matches as ReturnType<typeof detectEntitySignals>);
      }

      return Response.json({ ok: true, matches });
    },
  });
}

function loadEntitySlugs(workspaceRoot: string): string[] {
  const entitiesDir = join(workspaceRoot, 'entities');
  if (!existsSync(entitiesDir)) return [];
  return readdirSync(entitiesDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => basename(name, '.md'));
}

function spawnDecisionDetector(context: string): void {
  const craftRoot = process.env.CRAFT_ROOT ?? process.cwd();
  const workspaceId = process.env.CRAFT_WORKSPACE_ID ?? 'ws_rockyii';
  const rpcPort = process.env.CRAFT_RPC_PORT ?? '48211';
  const url = process.env.CRAFT_SERVER_URL ?? `ws://127.0.0.1:${rpcPort}`;
  const token = process.env.CRAFT_SERVER_TOKEN;
  if (!token) {
    console.warn('[signal-detector] CRAFT_SERVER_TOKEN is not set; decision session not spawned');
    return;
  }

  const prompt = [
    'Run the decision-detector skill for this captured UserPromptSubmit decision signal.',
    'Read /workspace/skills/decision-detector/SKILL.md directly; do not spawn a subagent to locate the skill.',
    '',
    'Captured context:',
    context,
    '',
    'Source channel: UserPromptSubmit automation.',
  ].join('\n');

  const script = `
set -euo pipefail
cd "${craftRoot.replace(/"/g, '\\"')}"
SESSION_JSON=$(bun run apps/cli/src/index.ts --url "${url}" --workspace "${workspaceId}" --json --mode allow-all session create --name "decision-signal-$(date +%s)")
SESSION_ID=$(printf '%s' "$SESSION_JSON" | jq -r '.id')
bun run apps/cli/src/index.ts --url "${url}" --workspace "${workspaceId}" invoke session:setModel "$SESSION_ID" "${workspaceId}" claude-sonnet-4-6 claude-max >/dev/null
bun run apps/cli/src/index.ts --url "${url}" --workspace "${workspaceId}" --timeout 240000 send "$SESSION_ID" "$ROCKY_DECISION_PROMPT" >/tmp/rocky-signal-detector-$SESSION_ID.log 2>&1
`;

  const child = spawn('bash', ['-lc', script], {
    cwd: craftRoot,
    env: {
      ...process.env,
      CRAFT_SERVER_TOKEN: token,
      ROCKY_DECISION_PROMPT: prompt,
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

if (import.meta.main) {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? '/workspace';
  const server = startSignalDetector({
    port: Number(process.env.ROCKY_SIGNAL_PORT ?? 48212),
    entitySlugs: loadEntitySlugs(workspaceRoot),
    onSignal(matches) {
      for (const match of matches) {
        if (match.type === 'decision') {
          spawnDecisionDetector(match.context);
        }
      }
    },
  });
  console.log(`[signal-detector] listening on ${server.url}`);
}
