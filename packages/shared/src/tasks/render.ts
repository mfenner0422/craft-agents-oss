import type { TaskRecord } from './types.ts';

const STATUS_TO_MARKER: Record<TaskRecord['status'], string> = {
  todo: ' ',
  in_progress: '/',
  delegated: '>',
  completed: 'x',
  canceled: '-',
};

export function renderTaskLine(task: TaskRecord): string {
  return `- [${STATUS_TO_MARKER[task.status] ?? ' '}] ${task.title.trim()} <!-- task:${task.id} -->`;
}

export function renderManagedTaskBlock(tasks: TaskRecord[]): string {
  const lines = tasks
    .filter(task => task.title.trim().length > 0)
    .map(renderTaskLine);
  return [
    '<!-- craft-tasks:start -->',
    ...lines,
    '<!-- craft-tasks:end -->',
  ].join('\n') + '\n';
}

export function replaceManagedTaskBlock(content: string, renderedBlock: string, fallbackTitle: string): string {
  const normalizedBlock = renderedBlock.endsWith('\n') ? renderedBlock : `${renderedBlock}\n`;
  if (/<!--\s*craft-tasks:start\s*-->[\s\S]*?<!--\s*craft-tasks:end\s*-->/.test(content)) {
    return content.replace(/<!--\s*craft-tasks:start\s*-->[\s\S]*?<!--\s*craft-tasks:end\s*-->\n?/, normalizedBlock);
  }
  const body = content.replace(/^\s*#\s+[^\n]*\n?/, '').replace(/^\n/, '');
  return `# ${fallbackTitle}\n\n${normalizedBlock}${body.trim().length > 0 ? `\n${body}` : ''}`;
}
