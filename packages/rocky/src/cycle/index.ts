import { rebuildVaultIndex } from '../vault-index/builder.ts';
import { qmdUpdateAndEmbed } from '../qmd/lifecycle.ts';
import { CycleReport } from './report.ts';

export interface RockyWorkspace {
  rootPath: string;
}

export async function runCycle(workspace: RockyWorkspace): Promise<CycleReport> {
  const report = new CycleReport();

  await report.phase('lint', () => 'lint phase placeholder');
  await report.phase('backlinks', async () => {
    const index = await rebuildVaultIndex(workspace.rootPath);
    return `${index.fileCount} markdown files indexed`;
  });
  await report.phase('sync', () => 'github sync placeholder');
  await report.phase('extract', () => 'entity extraction placeholder');
  await report.phase('consolidate-memory', () => 'memory consolidation placeholder');
  await report.phase('orphans', () => 'orphan detection placeholder');
  await report.phase('qmd-refresh', async () => qmdUpdateAndEmbed(workspace.rootPath));

  return report.complete();
}

