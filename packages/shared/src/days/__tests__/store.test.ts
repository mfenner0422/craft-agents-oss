import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { ensureDay, getIncompleteTasks, listDays, pullForwardTasks, updateDayFile } from '../store.ts';

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
  it('creates the three daily files deterministically', () => {
    const vaultRoot = tempVault();
    const day = ensureDay(vaultRoot, '2026-05-06');
    expect(Object.keys(day.files).sort()).toEqual(['journal', 'scratch', 'tasks']);
    expect(listDays(vaultRoot)).toEqual(['2026-05-06']);
  });

  it('uses vault template overrides', () => {
    const vaultRoot = tempVault();
    mkdirSync(join(vaultRoot, '_templates', 'daily'), { recursive: true });
    writeFileSync(join(vaultRoot, '_templates', 'daily', 'tasks.md'), '# Custom tasks\n', 'utf-8');
    expect(ensureDay(vaultRoot, '2026-05-06').files.tasks).toBe('# Custom tasks\n');
  });

  it('is idempotent when called repeatedly', () => {
    const vaultRoot = tempVault();
    const first = ensureDay(vaultRoot, '2026-05-06');
    writeFileSync(join(vaultRoot, 'daily', '2026-05-06', 'scratch.md'), 'keep me\n', 'utf-8');
    const second = ensureDay(vaultRoot, '2026-05-06');
    expect(second.files.tasks).toBe(first.files.tasks);
    expect(second.files.scratch).toBe('keep me\n');
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
      { id: 'abc', text: 'Follow up', line: '- [ ] Follow up <!-- task:abc -->' },
    ]);
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    pullForwardTasks(vaultRoot, '2026-05-05', '2026-05-06');
    const target = ensureDay(vaultRoot, '2026-05-06').files.tasks;
    expect(target.match(/task:abc/g)).toHaveLength(1);
  });

  it('updates an individual day file', () => {
    const vaultRoot = tempVault();
    updateDayFile(vaultRoot, '2026-05-06', 'journal', '# Updated\n');
    expect(ensureDay(vaultRoot, '2026-05-06').files.journal).toBe('# Updated\n');
  });
});
