import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { captureItem, deleteCaptureItem, listInboxItems } from '../store.ts';

const tempDirs: string[] = [];

function tempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-capture-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('capture store', () => {
  it('writes one markdown file per capture item', () => {
    const vaultRoot = tempVault();
    const item = captureItem({
      vaultRoot,
      title: 'Read Later',
      body: 'Interesting note',
      tags: ['inbox'],
      now: new Date('2026-05-06T10:11:12.000Z'),
    });

    expect(item.filePath.endsWith('/inbox/2026-05-06-101112-read-later.md')).toBe(true);
    const items = listInboxItems(vaultRoot);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      id: item.id,
      title: 'Read Later',
      tags: ['inbox'],
    }));
    expect(items[0]).not.toHaveProperty('source');
    expect(items[0]?.body.trim()).toBe('Interesting note');
  });

  it('deletes a capture item by id', () => {
    const vaultRoot = tempVault();
    const item = captureItem({
      vaultRoot,
      title: 'Throwaway',
      body: 'goodbye',
      now: new Date('2026-05-06T10:11:12.000Z'),
    });

    expect(existsSync(item.filePath)).toBe(true);
    deleteCaptureItem(vaultRoot, item.id);
    expect(existsSync(item.filePath)).toBe(false);
    expect(listInboxItems(vaultRoot)).toHaveLength(0);
  });

  it('throws when deleting an unknown capture id', () => {
    const vaultRoot = tempVault();
    captureItem({
      vaultRoot,
      title: 'Real one',
      body: 'still here',
      now: new Date('2026-05-06T10:11:12.000Z'),
    });

    expect(() => deleteCaptureItem(vaultRoot, 'no-such-id')).toThrow(/not found/);
  });

  it('uses URL hostname for the filename when no title exists', () => {
    const vaultRoot = tempVault();
    const item = captureItem({
      vaultRoot,
      url: 'https://example.com/path',
      body: 'https://example.com/path',
      now: new Date('2026-05-06T10:11:12.000Z'),
    });

    expect(item.filePath.endsWith('/inbox/2026-05-06-101112-example-com.md')).toBe(true);
  });
});
