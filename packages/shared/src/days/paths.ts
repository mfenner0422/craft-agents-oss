import { join } from 'node:path';

export type DayFileKind = 'tasks' | 'scratch' | 'journal';

export function getDayDir(vaultRoot: string, dateISO: string): string {
  return join(vaultRoot, 'daily', dateISO);
}

export function getDayFilePath(vaultRoot: string, dateISO: string, kind: DayFileKind): string {
  return join(getDayDir(vaultRoot, dateISO), `${kind}.md`);
}
