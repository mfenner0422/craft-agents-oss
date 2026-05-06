import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { AUTOMATIONS_LAST_RUN_FILE } from './constants.ts';

type LastRunMap = Record<string, string>;

const mutexes = new Map<string, Promise<void>>();

function getPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, AUTOMATIONS_LAST_RUN_FILE);
}

function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexes.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mutexes.set(key, next.then(() => {}, () => {}));
  return next;
}

export function readLastRun(workspaceRootPath: string): LastRunMap {
  const path = getPath(workspaceRootPath);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as LastRunMap;
  } catch {
    return {};
  }
}

export async function writeLastRun(workspaceRootPath: string, matcherId: string, scheduledAt: string): Promise<void> {
  await withMutex(workspaceRootPath, async () => {
    const path = getPath(workspaceRootPath);
    const current = readLastRun(workspaceRootPath);
    current[matcherId] = scheduledAt;
    atomicWriteFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
  });
}
