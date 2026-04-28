import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceEventBus } from '../event-bus.ts';
import type { AutomationsConfigProvider } from './types.ts';
import type { AutomationEvent, AutomationsConfig } from '../types.ts';
import { WebhookHandler } from './webhook-handler.ts';

function provider(config: AutomationsConfig): AutomationsConfigProvider {
  return {
    getConfig: () => config,
    getMatchersForEvent: (event: AutomationEvent) => config.automations[event] ?? [],
  };
}

describe('WebhookHandler', () => {
  it('processes UserPromptSubmit agent-event webhooks', async () => {
    const bus = new WorkspaceEventBus('ws-1');
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'webhook-agent-event-'));
    const results: unknown[] = [];
    const config: AutomationsConfig = {
      automations: {
        UserPromptSubmit: [{
          actions: [{
            type: 'webhook',
            url: 'ftp://localhost/signal',
            body: { prompt: '$CRAFT_DATA' },
          }],
        }],
      },
    };

    const handler = new WebhookHandler({
      workspaceId: 'ws-1',
      workspaceRootPath,
      onWebhookResults: (items) => results.push(...items),
    }, provider(config));
    handler.subscribe(bus);

    await bus.emit('UserPromptSubmit', {
      workspaceId: 'ws-1',
      timestamp: Date.now(),
      data: { prompt: 'we decided to use Postgres' },
    });

    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain('Invalid URL scheme');

    await handler.dispose();
    bus.dispose();
  });
});
