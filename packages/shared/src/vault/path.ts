import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { WorkspaceConfig } from '../workspaces/types.ts';

export function resolveVaultRoot(workspaceRootPath: string, config?: Pick<WorkspaceConfig, 'vault'> | null): string {
  const configuredPath = config?.vault?.path?.trim();
  const vaultRoot = configuredPath
    ? (isAbsolute(configuredPath) ? configuredPath : resolve(workspaceRootPath, configuredPath))
    : resolve(workspaceRootPath, 'vault');

  if (!existsSync(vaultRoot)) {
    mkdirSync(vaultRoot, { recursive: true });
  }

  return vaultRoot;
}
