import { Cron } from 'croner';
import type { AutomationMatcher } from './types.ts';

export interface MissedFiring { scheduledAt: string }

const MAX_RECOVERY_MINUTES = 7 * 24 * 60;

export function computeMissedFirings(matcher: AutomationMatcher, lastRunISO: string | undefined, now: Date): MissedFiring[] {
  if (!matcher.cron) return [];
  const start = lastRunISO ? new Date(lastRunISO) : new Date(now.getTime() - 60_000);
  if (Number.isNaN(start.getTime()) || start > now) return [];

  try {
    const cron = new Cron(matcher.cron, matcher.timezone ? { timezone: matcher.timezone } : {});
    const result: MissedFiring[] = [];
    let cursor = new Date(start.getTime() + 1);
    const cutoff = new Date(Math.max(start.getTime(), now.getTime() - MAX_RECOVERY_MINUTES * 60_000));
    if (cursor < cutoff) cursor = cutoff;

    for (let i = 0; i < MAX_RECOVERY_MINUTES; i++) {
      const next = cron.nextRun(cursor);
      if (!next || next > now) break;
      result.push({ scheduledAt: floorToMinute(next).toISOString() });
      cursor = new Date(next.getTime() + 1);
    }
    return dedupeFirings(result);
  } catch {
    return computeMissedFiringsByMinuteWalk(matcher, start, now);
  }
}

function computeMissedFiringsByMinuteWalk(matcher: AutomationMatcher, start: Date, now: Date): MissedFiring[] {
  const result: MissedFiring[] = [];
  const cursor = new Date(start.getTime());
  let walked = 0;
  while (cursor < now && walked < MAX_RECOVERY_MINUTES) {
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
    walked++;
    if (cursor <= now && matchesByNextRun(matcher, cursor)) {
      result.push({ scheduledAt: cursor.toISOString() });
    }
  }
  return dedupeFirings(result);
}

function matchesByNextRun(matcher: AutomationMatcher, candidate: Date): boolean {
  if (!matcher.cron) return false;
  try {
    const cron = new Cron(matcher.cron, matcher.timezone ? { timezone: matcher.timezone } : {});
    const previousSecond = new Date(candidate.getTime() - 1000);
    const next = cron.nextRun(previousSecond);
    return !!next && floorToMinute(next).getTime() === candidate.getTime();
  } catch {
    return false;
  }
}

function floorToMinute(date: Date): Date {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  return floored;
}

function dedupeFirings(firings: MissedFiring[]): MissedFiring[] {
  return Array.from(new Set(firings.map(firing => firing.scheduledAt))).map(scheduledAt => ({ scheduledAt }));
}
