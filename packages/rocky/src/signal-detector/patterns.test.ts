import { describe, expect, it } from 'bun:test';
import { detectDecisionSignal, detectEntitySignals } from './patterns.ts';

describe('signal detector patterns', () => {
  it('detects decision language', () => {
    expect(detectDecisionSignal('we decided to use Postgres')?.type).toBe('decision');
  });

  it('detects entity slugs', () => {
    expect(detectEntitySignals('Jane mentioned acme-corp yesterday', ['acme-corp'])).toHaveLength(1);
  });
});

