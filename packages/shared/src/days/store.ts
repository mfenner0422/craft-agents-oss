import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDayFilePath, type DayFileKind } from './paths.ts';
import { atomicWriteFileSync } from '../utils/files.ts';

const DAY_FILE_KINDS: DayFileKind[] = ['tasks', 'scratch', 'journal'];

export interface DayRecord {
  dateISO: string;
  files: Record<DayFileKind, string>;
}

export function ensureDay(vaultRoot: string, dateISO = new Date().toISOString().slice(0, 10)): DayRecord {
  const files = {} as Record<DayFileKind, string>;
  for (const kind of DAY_FILE_KINDS) {
    const filePath = getDayFilePath(vaultRoot, dateISO, kind);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      atomicWriteFileSync(filePath, loadTemplate(vaultRoot, kind));
    }
    files[kind] = readFileSync(filePath, 'utf-8');
  }
  return { dateISO, files };
}

export function listDays(vaultRoot: string, limit = 30): string[] {
  const dailyRoot = join(vaultRoot, 'daily');
  if (!existsSync(dailyRoot)) return [];
  return readdirSync(dailyRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);
}

function loadTemplate(vaultRoot: string, kind: DayFileKind): string {
  const override = join(vaultRoot, '_templates', 'daily', `${kind}.md`);
  if (existsSync(override)) return readFileSync(override, 'utf-8');
  return readFileSync(new URL(`./templates/${kind}.md`, import.meta.url), 'utf-8');
}
