import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ExportedSessionTurn {
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
}

function extractTurn(line: string, sessionId: string): ExportedSessionTurn | null {
  try {
    const event = JSON.parse(line);
    const role = event.role === 'user' || event.role === 'assistant' ? event.role : null;
    const text = typeof event.text === 'string'
      ? event.text
      : typeof event.content === 'string'
        ? event.content
        : null;
    if (!role || !text) return null;
    return { sessionId, role, text };
  } catch {
    return null;
  }
}

export function exportSessionTranscripts(workspaceRoot: string): number {
  const sessionsDir = join(workspaceRoot, 'sessions');
  const outDir = join(workspaceRoot, '.qmd', 'sessions');
  if (!existsSync(sessionsDir)) return 0;
  mkdirSync(outDir, { recursive: true });

  let exported = 0;
  for (const sessionId of readdirSync(sessionsDir)) {
    const jsonl = join(sessionsDir, sessionId, 'session.jsonl');
    if (!existsSync(jsonl)) continue;
    const turns = readFileSync(jsonl, 'utf8')
      .split('\n')
      .map((line) => extractTurn(line, sessionId))
      .filter((turn): turn is ExportedSessionTurn => Boolean(turn));
    if (turns.length === 0) continue;
    const markdown = turns.map((turn) => `## ${turn.role}\n\n${turn.text}`).join('\n\n');
    writeFileSync(join(outDir, `${sessionId}.md`), `${markdown}\n`);
    exported += 1;
  }

  return exported;
}

