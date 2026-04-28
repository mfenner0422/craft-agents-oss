import { spawnSync } from 'node:child_process';

export function qmdUpdateAndEmbed(workspaceRoot: string): string {
  const update = spawnSync('qmd', ['update', '--workspace', workspaceRoot], { encoding: 'utf8' });
  if (update.status !== 0) {
    throw new Error(update.stderr || update.stdout || 'qmd update failed');
  }

  const embed = spawnSync('qmd', ['embed', '--workspace', workspaceRoot], { encoding: 'utf8' });
  if (embed.status !== 0) {
    throw new Error(embed.stderr || embed.stdout || 'qmd embed failed');
  }

  return 'qmd collections refreshed';
}

export function qmdHealth(): boolean {
  const result = spawnSync('qmd', ['--help'], { encoding: 'utf8' });
  return result.status === 0;
}

