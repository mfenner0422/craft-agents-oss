import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  ensureBoard,
  ensureDay,
  getIncompleteTasks,
  listDays,
  parseTaskList,
  pullForwardTasks,
  readDay,
  readManagedMarkdownBody,
  readSharedTaskList,
  serializeTaskList,
  updateDayFile,
  updateTaskLists,
  writeSharedTaskList,
} from '../store.ts';
import { addDays, formatLocalDateISO, parseDateISO } from '../date.ts';
import { createTask, getTask } from '../../tasks/store.ts';

const tempDirs: string[] = [];

function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-days-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('days store', () => {
  it('formats day dates using local calendar fields', () => {
    expect(formatLocalDateISO(new Date(2026, 4, 6))).toBe('2026-05-06');
    expect(formatLocalDateISO(parseDateISO('2026-05-06'))).toBe('2026-05-06');
    expect(addDays('2026-05-06', -1)).toBe('2026-05-05');
    expect(addDays('2026-05-06', 1)).toBe('2026-05-07');
  });

  it('creates the three daily files deterministically', () => {
    const vaultRoot = tempVault();
    const day = ensureDay(vaultRoot, '2026-05-06');
    expect(Object.keys(day.files).sort()).toEqual(['journal', 'scratch', 'tasks']);
    expect(day.files.tasks).toStartWith('# Today');
    expect(listDays(vaultRoot)).toEqual(['2026-05-06']);
  });

  it('uses vault template overrides', () => {
    const vaultRoot = tempVault();
    mkdirSync(join(vaultRoot, '_templates', 'daily'), { recursive: true });
    writeFileSync(join(vaultRoot, '_templates', 'daily', 'tasks.md'), '# Custom tasks\n\n- [ ] Custom\n', 'utf-8');
    expect(ensureDay(vaultRoot, '2026-05-06').files.tasks).toBe('# Today\n\n- [ ] Custom\n');
  });

  it('is idempotent when called repeatedly', () => {
    const vaultRoot = tempVault();
    const first = ensureDay(vaultRoot, '2026-05-06');
    writeFileSync(join(vaultRoot, 'daily', '2026-05-06', 'scratch.md'), 'keep me\n', 'utf-8');
    const second = ensureDay(vaultRoot, '2026-05-06');
    expect(second.files.tasks).toBe(first.files.tasks);
    expect(second.files.scratch).toBe('# Scratch\n\nkeep me\n');
    expect(second.bodies.scratch).toBe('keep me\n');
  });

  it('reads existing partial days without creating missing files', () => {
    const vaultRoot = tempVault();
    expect(readDay(vaultRoot, '2026-05-06')).toBeNull();
    mkdirSync(join(vaultRoot, 'daily', '2026-05-06'), { recursive: true });
    writeFileSync(join(vaultRoot, 'daily', '2026-05-06', 'scratch.md'), 'existing scratch\n', 'utf-8');
    const day = readDay(vaultRoot, '2026-05-06');
    expect(day?.files.scratch).toBe('# Scratch\n\nexisting scratch\n');
    expect(day?.bodies.scratch).toBe('existing scratch\n');
    expect(day?.files.tasks).toContain('# Today');
  });

  it('sorts days descending and respects the limit', () => {
    const vaultRoot = tempVault();
    ensureDay(vaultRoot, '2026-05-04');
    ensureDay(vaultRoot, '2026-05-06');
    ensureDay(vaultRoot, '2026-05-05');
    expect(listDays(vaultRoot, 2)).toEqual(['2026-05-06', '2026-05-05']);
  });

  it('rejects malformed dates', () => {
    const vaultRoot = tempVault();
    expect(() => ensureDay(vaultRoot, '../bad')).toThrow('Invalid day date');
    expect(() => ensureDay(vaultRoot, '2026-5-6')).toThrow('Invalid day date');
  });

  it('pulls incomplete tasks forward without duplicating stable ids', () => {
    const vaultRoot = tempVault();
    ensureDay(vaultRoot, '2026-05-05');
    writeFileSync(
      join(vaultRoot, 'daily', '2026-05-05', 'tasks.md'),
      '- [ ] Follow up <!-- task:abc -->\n- [x] Done thing <!-- task:def -->\n',
      'utf-8',
    );

    expect(getIncompleteTasks(vaultRoot, '2026-05-05')).toEqual([
      { id: 'abc', text: 'Follow up', status: 'todo', line: '- [ ] Follow up <!-- task:abc -->' },
    ]);
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    const target = ensureDay(vaultRoot, '2026-05-06').files.tasks;
    expect(target.match(/task:abc/g)).toHaveLength(1);
  });

  it('updates an individual day file', () => {
    const vaultRoot = tempVault();
    updateDayFile(vaultRoot, '2026-05-06', 'journal', '# Updated\n\nBody\n');
    expect(ensureDay(vaultRoot, '2026-05-06').files.journal).toBe('# Journal\n\nBody\n');
  });

  it('reads and writes managed title bodies without duplicating the H1', () => {
    const vaultRoot = tempVault();
    updateDayFile(vaultRoot, '2026-05-06', 'scratch', 'Body\n');
    updateDayFile(vaultRoot, '2026-05-06', 'scratch', '# Scratch\n\nBody 2\n');
    const content = readFileSync(join(vaultRoot, 'daily', '2026-05-06', 'scratch.md'), 'utf-8');
    expect(content).toBe('# Scratch\n\nBody 2\n');
    expect(readManagedMarkdownBody(content)).toBe('Body 2\n');
  });

  it('parses and serializes all task statuses with stable ids', () => {
    const tasks = parseTaskList([
      '- [ ] Todo <!-- task:a -->',
      '- [/] Doing <!-- task:b -->',
      '- [>] Delegated <!-- task:c -->',
      '- [x] Done <!-- task:d -->',
      '- [-] Canceled <!-- task:e -->',
    ].join('\n'));
    expect(tasks.map(task => task.status)).toEqual(['todo', 'in_progress', 'delegated', 'completed', 'canceled']);
    expect(serializeTaskList(tasks)).toContain('- [>] Delegated <!-- task:c -->');
  });

  it('reads and writes shared Next and Someday lists', () => {
    const vaultRoot = tempVault();
    writeSharedTaskList(vaultRoot, 'next', [{ id: 'n1', text: 'Queued', status: 'todo' }]);
    writeSharedTaskList(vaultRoot, 'someday', [{ id: 's1', text: 'Later', status: 'delegated' }]);
    expect(readSharedTaskList(vaultRoot, 'next')).toEqual([
      { id: 'n1', text: 'Queued', status: 'todo', line: '- [ ] Queued <!-- task:n1 -->' },
    ]);
    expect(readFileSync(join(vaultRoot, 'daily', 'someday.md'), 'utf-8')).toBe('# Someday\n\n- [>] Later <!-- task:s1 -->\n');
  });

  it('updateTaskLists is a slot-and-membership reconciler over canonical tasks', () => {
    const vaultRoot = tempVault();
    // Renderer creates canonical tasks via tasks.create *before* asking the server to reorder.
    const a = createTask(vaultRoot, { id: 'a', title: 'A', day: '2026-05-06', slot: 1 });
    const b = createTask(vaultRoot, { id: 'b', title: 'B', day: '2026-05-06', slot: 2 });
    ensureBoard(vaultRoot, '2026-05-06');
    updateTaskLists(vaultRoot, '2026-05-06', { today: [b.id, a.id] });
    const file = readFileSync(join(vaultRoot, 'daily', '2026-05-06', 'tasks.md'), 'utf-8');
    expect(file.indexOf('task:b')).toBeLessThan(file.indexOf('task:a'));
  });

  it('carries forward only active yesterday Today tasks', () => {
    const vaultRoot = tempVault();
    ensureDay(vaultRoot, '2026-05-05');
    writeFileSync(
      join(vaultRoot, 'daily', '2026-05-05', 'tasks.md'),
      [
        '# Today',
        '',
        '- [ ] Todo <!-- task:a -->',
        '- [/] Doing <!-- task:b -->',
        '- [>] Waiting <!-- task:c -->',
        '- [x] Done <!-- task:d -->',
        '- [-] Canceled <!-- task:e -->',
      ].join('\n'),
      'utf-8',
    );
    writeSharedTaskList(vaultRoot, 'next', [{ id: 'n1', text: 'Not carried', status: 'todo' }]);
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    const target = readFileSync(join(vaultRoot, 'daily', '2026-05-06', 'tasks.md'), 'utf-8');
    expect(target).toContain('task:a');
    expect(target).toContain('task:b');
    expect(target).toContain('task:c');
    expect(target).not.toContain('task:d');
    expect(target).not.toContain('task:e');
    expect(target).not.toContain('task:n1');
  });

  it('pulls canonical tasks forward by moving the same task and recording provenance', () => {
    const vaultRoot = tempVault();
    createTask(vaultRoot, {
      id: 'canonical',
      title: 'Move me',
      day: '2026-05-05',
      slot: 1,
      list: null,
      created_at: '2026-05-05T08:00:00.000Z',
      updated_at: '2026-05-05T08:00:00.000Z',
    });
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    const task = getTask(vaultRoot, 'canonical');
    expect(task?.day).toBe('2026-05-06');
    expect(task?.created_at).toBe('2026-05-05T08:00:00.000Z');
    expect(task?.committed_history).toHaveLength(2);
    expect(readFileSync(join(vaultRoot, 'daily', '2026-05-06', 'tasks.md'), 'utf-8')).toContain('task:canonical');
    expect(readFileSync(join(vaultRoot, 'daily', '2026-05-05', 'tasks.md'), 'utf-8')).not.toContain('task:canonical');
  });
});
