import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { ensureDay, listDays } from '../store.ts';

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
});
