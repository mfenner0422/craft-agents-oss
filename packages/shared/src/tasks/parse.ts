import type { TaskStatus } from './types.ts';

export interface ParsedTaskLine {
  id: string | null;
  title: string;
  status: TaskStatus;
  line: string;
}

const MARKER_TO_STATUS: Record<string, TaskStatus> = {
  ' ': 'todo',
  '/': 'in_progress',
  '>': 'delegated',
  x: 'completed',
  X: 'completed',
  '-': 'canceled',
};

export function extractManagedTaskBlock(content: string): string {
  const match = content.match(/<!--\s*craft-tasks:start\s*-->\s*\r?\n?([\s\S]*?)\r?\n?<!--\s*craft-tasks:end\s*-->/);
  return match ? match[1] ?? '' : content;
}

export function parseRenderedTaskLines(content: string): ParsedTaskLine[] {
  const tasks: ParsedTaskLine[] = [];
  for (const line of extractManagedTaskBlock(content).split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\[([ xX/>\-])\]\s+(.+?)\s*$/);
    if (!match) continue;
    const marker = match[1] ?? ' ';
    const textWithComment = match[2] ?? '';
    const comment = textWithComment.match(/<!--\s*task:([a-zA-Z0-9_-]+)\s*-->/);
    const id = comment?.[1] ?? null;
    const title = textWithComment.replace(/\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->\s*$/, '').trim();
    if (!title) continue;
    tasks.push({ id, title, status: MARKER_TO_STATUS[marker] ?? 'todo', line });
  }
  return tasks;
}

export function deterministicTaskId(scope: string, title: string): string {
  let hash = 0;
  const value = `${scope}:${title}`;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `task_${Math.abs(hash).toString(36)}`;
}
