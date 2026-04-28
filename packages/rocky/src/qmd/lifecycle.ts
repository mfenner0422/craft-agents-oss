import { spawnSync } from 'node:child_process';

const ROCKY_QMD_INDEX = 'rocky';

export function qmdUpdateAndEmbed(_workspaceRoot: string): string {
  const update = spawnSync('qmd', ['--index', ROCKY_QMD_INDEX, 'update'], { encoding: 'utf8' });
  if (update.status !== 0) {
    throw new Error(update.stderr || update.stdout || 'qmd update failed');
  }

  const embed = spawnSync('qmd', ['--index', ROCKY_QMD_INDEX, 'embed'], { encoding: 'utf8' });
  if (embed.status !== 0) {
    throw new Error(embed.stderr || embed.stdout || 'qmd embed failed');
  }

  return 'qmd collections refreshed';
}

export function qmdHealth(): boolean {
  const result = spawnSync('qmd', ['--help'], { encoding: 'utf8' });
  return result.status === 0;
}

export function qmdAddCollection(path: string): string {
  const result = spawnSync('qmd', ['--index', ROCKY_QMD_INDEX, 'collection', 'add', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'qmd collection add failed');
  }
  return result.stdout.trim();
}
