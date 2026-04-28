export interface CyclePhaseResult {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: string;
  error?: string;
}

export class CycleReport {
  readonly startedAt = new Date().toISOString();
  completedAt: string | null = null;
  phases: CyclePhaseResult[] = [];

  async phase(name: string, fn: () => Promise<string | void> | string | void): Promise<void> {
    const started = Date.now();
    try {
      const summary = await fn();
      this.phases.push({
        name,
        ok: true,
        durationMs: Date.now() - started,
        summary: typeof summary === 'string' ? summary : undefined,
      });
    } catch (err) {
      this.phases.push({
        name,
        ok: false,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  complete(): this {
    this.completedAt = new Date().toISOString();
    return this;
  }

  get ok(): boolean {
    return this.phases.every((phase) => phase.ok);
  }
}

