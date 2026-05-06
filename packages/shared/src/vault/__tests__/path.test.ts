import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { resolveVaultRoot } from '../path.ts';

const tempDirs: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-vault-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveVaultRoot', () => {
  it('defaults to a vault directory under the workspace root', () => {
    const workspaceRoot = tempWorkspace();
    expect(resolveVaultRoot(workspaceRoot, null)).toBe(join(workspaceRoot, 'vault'));
  });

  it('resolves relative overrides against the workspace root', () => {
    const workspaceRoot = tempWorkspace();
    expect(resolveVaultRoot(workspaceRoot, { vault: { path: 'notes/vault' } })).toBe(join(workspaceRoot, 'notes/vault'));
  });

  it('preserves absolute overrides', () => {
    const workspaceRoot = tempWorkspace();
    const absoluteVault = join(tempWorkspace(), 'external-vault');
    expect(resolveVaultRoot(workspaceRoot, { vault: { path: absoluteVault } })).toBe(absoluteVault);
  });
});
