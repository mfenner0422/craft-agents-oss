import { describe, expect, it } from 'bun:test';
import { computeMissedFirings } from '../recovery.ts';
import type { AutomationMatcher } from '../types.ts';

function matcher(partial: Partial<AutomationMatcher>): AutomationMatcher {
  return {
    id: 'matcher-1',
    cron: '* * * * *',
    actions: [{ type: 'prompt', prompt: 'run' }],
    ...partial,
  };
}

describe('computeMissedFirings', () => {
  it('returns cron-aligned missed minutes after the last persisted run', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '*/5 * * * *' }),
      '2026-05-06T10:00:00.000Z',
      new Date('2026-05-06T10:16:30.000Z'),
    );

    expect(missed.map(firing => firing.scheduledAt)).toEqual([
      '2026-05-06T10:05:00.000Z',
      '2026-05-06T10:10:00.000Z',
      '2026-05-06T10:15:00.000Z',
    ]);
  });

  it('returns the previous minute when no watermark exists', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '* * * * *' }),
      undefined,
      new Date('2026-05-06T10:16:30.000Z'),
    );

    expect(missed).toEqual([{ scheduledAt: '2026-05-06T10:16:00.000Z' }]);
  });

  it('returns no firings for a persisted future watermark', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '* * * * *' }),
      '2026-05-06T10:17:00.000Z',
      new Date('2026-05-06T10:16:30.000Z'),
    );

    expect(missed).toEqual([]);
  });

  it('respects weekday cron expressions', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '0 9 * * 1' }),
      '2026-05-01T00:00:00.000Z',
      new Date('2026-05-06T12:00:00.000Z'),
    );

    expect(missed.map(firing => firing.scheduledAt)).toEqual([
      '2026-05-04T09:00:00.000Z',
    ]);
  });

  it('handles DST spring-forward gaps in the matcher timezone', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '30 2 * * *', timezone: 'Europe/Amsterdam' }),
      '2026-03-28T00:00:00.000Z',
      new Date('2026-03-30T12:00:00.000Z'),
    );

    expect(missed.map(firing => firing.scheduledAt)).toEqual([
      '2026-03-28T01:30:00.000Z',
      '2026-03-29T01:30:00.000Z',
      '2026-03-30T00:30:00.000Z',
    ]);
  });

  it('caps recovery scans at seven days', () => {
    const missed = computeMissedFirings(
      matcher({ cron: '* * * * *' }),
      '2026-04-01T00:00:00.000Z',
      new Date('2026-05-06T10:16:30.000Z'),
    );

    expect(missed).toHaveLength(7 * 24 * 60);
    expect(missed[0]?.scheduledAt).toBe('2026-04-29T10:17:00.000Z');
    expect(missed.at(-1)?.scheduledAt).toBe('2026-05-06T10:16:00.000Z');
  });
});
