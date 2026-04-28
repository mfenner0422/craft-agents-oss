import type { CycleReport } from '../cycle/report.ts';

export function formatCycleDigest(report: CycleReport): string {
  const completedAt = report.completedAt ?? new Date().toISOString();
  const lines = [`[${completedAt}] Cycle ${report.ok ? 'complete' : 'completed with errors'}`];

  for (const phase of report.phases) {
    const status = phase.ok ? 'ok' : 'failed';
    const detail = phase.summary ?? phase.error ?? `${phase.durationMs}ms`;
    lines.push(`- ${phase.name}: ${status} - ${detail}`);
  }

  return lines.join('\n');
}

