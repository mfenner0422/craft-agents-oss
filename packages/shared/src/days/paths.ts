import { join } from 'node:path';

export type DayFileKind = 'tasks' | 'scratch' | 'journal';
export const DAY_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateISO(dateISO: string): void {
  if (!DAY_ISO_PATTERN.test(dateISO)) {
    throw new Error(`Invalid day date: ${dateISO}`);
  }
}

export function getDayDir(vaultRoot: string, dateISO: string): string {
  assertDateISO(dateISO);
  return join(vaultRoot, 'daily', dateISO);
}

export function getDayFilePath(vaultRoot: string, dateISO: string, kind: DayFileKind): string {
  return join(getDayDir(vaultRoot, dateISO), `${kind}.md`);
}
