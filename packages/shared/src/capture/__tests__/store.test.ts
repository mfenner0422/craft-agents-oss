import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { captureItem, listInboxItems } from '../store.ts';

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
      source: 'manual',
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
    expect(items[0]?.body.trim()).toBe('Interesting note');
  });

  it('uses URL hostname for the filename when no title exists', () => {
    const vaultRoot = tempVault();
    const item = captureItem({
      vaultRoot,
      source: 'url',
      url: 'https://example.com/path',
      body: 'https://example.com/path',
      now: new Date('2026-05-06T10:11:12.000Z'),
    });

    expect(item.filePath.endsWith('/inbox/2026-05-06-101112-example-com.md')).toBe(true);
  });
});
