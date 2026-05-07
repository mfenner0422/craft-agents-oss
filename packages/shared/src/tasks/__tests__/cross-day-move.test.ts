import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { ensureBoard, getDaysBoard } from '../../days/store.ts';
import { createTask, listRenderedDayTasks, promoteTask, updateTask } from '../store.ts';

const tempDirs: string[] = [];

function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cross-day-move-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('cross-day move (server-side merge)', () => {
  it('moves a task across days without losing pre-existing tasks at the target', () => {
    const vaultRoot = tempVault();
    const sourceDate = '2026-05-07';
    const targetDate = '2026-06-07';

    ensureBoard(vaultRoot, sourceDate);
    ensureBoard(vaultRoot, targetDate);

    createTask(vaultRoot, { id: 't-existing-1', title: 'Pre-existing 1', day: targetDate, slot: 1 });
    createTask(vaultRoot, { id: 't-existing-2', title: 'Pre-existing 2', day: targetDate, slot: 2 });
    createTask(vaultRoot, { id: 't-source', title: 'Source', day: sourceDate, slot: 1 });

    promoteTask(vaultRoot, 't-source', { kind: 'day', dateISO: targetDate, reason: 'cross-day-move' });
    ensureBoard(vaultRoot, sourceDate);
    ensureBoard(vaultRoot, targetDate);

    const sourceTasks = listRenderedDayTasks(vaultRoot, sourceDate);
    const targetTasks = listRenderedDayTasks(vaultRoot, targetDate);

    expect(sourceTasks.map(t => t.id)).toEqual([]);
    expect(targetTasks.map(t => t.id).sort()).toEqual(['t-existing-1', 't-existing-2', 't-source']);

    const sourceBoard = getDaysBoard(vaultRoot, sourceDate);
    const targetBoard = getDaysBoard(vaultRoot, targetDate);
    expect(sourceBoard?.tasks.today.map(t => t.id)).toEqual([]);
    expect(targetBoard?.tasks.today.map(t => t.id).sort()).toEqual(['t-existing-1', 't-existing-2', 't-source']);
  });
});

describe('status transitions are recorded in committed_history', () => {
  it('updateTask with a status change appends a history entry', () => {
    const vaultRoot = tempVault();
    const dateISO = '2026-05-07';
    ensureBoard(vaultRoot, dateISO);
    const created = createTask(vaultRoot, { id: 't-status', title: 'Status test', day: dateISO, slot: 1 });
    const initialHistoryLen = created.committed_history.length;

    const completed = updateTask(vaultRoot, created.id, { status: 'completed' });

    expect(completed.committed_history.length).toBe(initialHistoryLen + 1);
    const last = completed.committed_history[completed.committed_history.length - 1];
    expect(last?.status_from).toBe('todo');
    expect(last?.status_to).toBe('completed');
    expect(last?.reason).toBe('status:todo->completed');
  });

  it('updateTask without a status change does not append history', () => {
    const vaultRoot = tempVault();
    const dateISO = '2026-05-07';
    ensureBoard(vaultRoot, dateISO);
    const created = createTask(vaultRoot, { id: 't-title', title: 'Title test', day: dateISO, slot: 1 });
    const initialHistoryLen = created.committed_history.length;

    const renamed = updateTask(vaultRoot, created.id, { title: 'Renamed' });

    expect(renamed.committed_history.length).toBe(initialHistoryLen);
  });
});

describe('capture promote — direct placement records "create" reason (not "promote:day")', () => {
  it('direct day placement is recorded with reason="create"', () => {
    const vaultRoot = tempVault();
    const dateISO = '2026-05-07';
    ensureBoard(vaultRoot, dateISO);

    const task = createTask(vaultRoot, {
      id: 't-direct',
      title: 'Direct placement',
      day: dateISO,
      slot: 1,
      list: null,
      source: 'capture',
    });

    expect(task.day).toBe(dateISO);
    expect(task.list).toBeNull();
    expect(task.committed_history.length).toBe(1);
    expect(task.committed_history[0]?.to_day).toBe(dateISO);
    expect(task.committed_history[0]?.reason).toBe('create');
  });

  it('legacy create-in-next-then-promote-to-day records reason="promote:day" (the phantom we fixed)', () => {
    const vaultRoot = tempVault();
    const dateISO = '2026-05-07';
    ensureBoard(vaultRoot, dateISO);

    const intermediate = createTask(vaultRoot, {
      id: 't-via-next',
      title: 'Via next',
      day: null,
      list: 'next',
      source: 'capture',
    });
    const moved = promoteTask(vaultRoot, intermediate.id, { kind: 'day', dateISO });
    expect(moved.committed_history.length).toBe(1);
    expect(moved.committed_history[0]?.reason).toBe('promote:day');
  });
});
