import { detectDecisionSignal, detectEntitySignals } from './patterns.ts';

export interface SignalDetectorOptions {
  port?: number;
  entitySlugs?: string[];
  onSignal?: (matches: ReturnType<typeof detectEntitySignals>) => void | Promise<void>;
}

export function startSignalDetector(options: SignalDetectorOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? 48212;
  const entitySlugs = options.entitySlugs ?? [];

  return Bun.serve({
    port,
    async fetch(req) {
      if (new URL(req.url).pathname !== '/signal') {
        return new Response('not found', { status: 404 });
      }

      const payload = await req.json().catch((): Record<string, unknown> => ({}));
      const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const text = typeof data.text === 'string'
        ? data.text
        : typeof data.prompt === 'string'
          ? data.prompt
          : JSON.stringify(data);

      const matches = [
        ...detectEntitySignals(text, entitySlugs),
        ...[detectDecisionSignal(text)].filter(Boolean),
      ];

      if (matches.length > 0 && options.onSignal) {
        await options.onSignal(matches as ReturnType<typeof detectEntitySignals>);
      }

      return Response.json({ ok: true, matches });
    },
  });
}
