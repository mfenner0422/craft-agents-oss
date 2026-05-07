import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { createTask, getTask, listLingeringTasks, listTasks, promoteTask, updateTask } from '../store.ts';
import { validateTask, type TaskRecord } from '../types.ts';

const tempDirs: string[] = [];

function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-tasks-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tasks store', () => {
  it('enforces active task placement invariants', () => {
    const base = makeTask({ day: '2026-05-07', slot: 1, list: null });
    expect(() => validateTask(base)).not.toThrow();
    expect(() => validateTask({ ...base, list: 'next' })).toThrow('exactly one');
    expect(() => validateTask({ ...base, day: null, list: null, slot: undefined })).toThrow('exactly one');
    expect(() => validateTask({ ...base, day: null, list: 'next' })).toThrow('must not have a slot');
  });

  it('round-trips a committed task through markdown frontmatter', () => {
    const vaultRoot = tempVault();
    const task = createTask(vaultRoot, {
      id: 'abc',
      title: 'Ship triage',
      day: '2026-05-07',
      slot: 1,
      list: null,
      tags: ['design'],
      body: 'Notes',
    });
    expect(task.id).toBe('abc');
    expect(readFileSync(join(vaultRoot, 'tasks', 'abc.md'), 'utf-8')).toContain('title: Ship triage');
    expect(getTask(vaultRoot, 'abc')?.body.trim()).toBe('Notes');
    expect(listTasks(vaultRoot, { day: '2026-05-07' }).map(item => item.id)).toEqual(['abc']);
  });

  it('promotes without changing created_at and records history', () => {
    const vaultRoot = tempVault();
    const task = createTask(vaultRoot, {
      id: 'abc',
      title: 'Follow up',
      day: '2026-05-06',
      slot: 1,
      list: null,
      created_at: '2026-05-06T08:00:00.000Z',
      updated_at: '2026-05-06T08:00:00.000Z',
    });
    const promoted = promoteTask(vaultRoot, task.id, { kind: 'day', dateISO: '2026-05-07', reason: 'pull-forward' });
    expect(promoted.id).toBe('abc');
    expect(promoted.created_at).toBe('2026-05-06T08:00:00.000Z');
    expect(promoted.day).toBe('2026-05-07');
    expect(promoted.committed_history).toHaveLength(2);
    expect(promoted.committed_history[1]).toMatchObject({ from_day: '2026-05-06', to_day: '2026-05-07', reason: 'pull-forward' });
  });

  it('sets and clears terminal timestamps', () => {
    const vaultRoot = tempVault();
    createTask(vaultRoot, { id: 'abc', title: 'Cancel me', day: '2026-05-07', slot: 1, list: null });
    const canceled = updateTask(vaultRoot, 'abc', { status: 'canceled' });
    expect(canceled.canceled_at).toBeTruthy();
    expect(canceled.day).toBe('2026-05-07');
    const reopened = updateTask(vaultRoot, 'abc', { status: 'todo' });
    expect(reopened.canceled_at).toBeUndefined();
  });

  it('lists lingering active tasks oldest first', () => {
    const vaultRoot = tempVault();
    createTask(vaultRoot, { id: 'old', title: 'Old', day: '2026-05-03', slot: 1, list: null });
    createTask(vaultRoot, { id: 'newer', title: 'Newer', day: '2026-05-05', slot: 1, list: null });
    createTask(vaultRoot, { id: 'done', title: 'Done', status: 'completed', day: '2026-05-04', slot: 1, list: null });
    expect(listLingeringTasks(vaultRoot, '2026-05-07', 7).map(task => task.id)).toEqual(['old', 'newer']);
  });
});

function makeTask(patch: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'abc',
    title: 'Task',
    status: 'todo',
    day: null,
    list: 'next',
    source: 'manual',
    created_at: '2026-05-07T08:00:00.000Z',
    updated_at: '2026-05-07T08:00:00.000Z',
    committed_history: [],
    tags: [],
    body: '',
    ...patch,
  };
}
