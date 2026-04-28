export interface SignalMatch {
  type: 'entity' | 'decision';
  slug?: string;
  context: string;
}

const DECISION_PATTERNS = [
  /\b(?:we|i)\s+(?:decided|chose|committed|are going with|am going with)\b/i,
  /\b(?:decision|let's go with)\b/i,
];

export function detectDecisionSignal(text: string): SignalMatch | null {
  for (const pattern of DECISION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.index && match?.index !== 0) continue;
    const start = Math.max(0, match.index - 200);
    const end = Math.min(text.length, match.index + match[0].length + 100);
    return { type: 'decision', context: text.slice(start, end) };
  }
  return null;
}

export function detectEntitySignals(text: string, entitySlugs: string[]): SignalMatch[] {
  return entitySlugs
    .filter((slug) => new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
    .map((slug) => ({ type: 'entity' as const, slug, context: text }));
}

