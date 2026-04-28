import { describe, expect, it } from 'bun:test';
import { SourceServerBuilder } from './server-builder.ts';
import type { LoadedSource } from './types.ts';

describe('SourceServerBuilder Rocky env refs', () => {
  it('preserves non-op stdio env values', () => {
    const source: LoadedSource = {
      workspaceRootPath: '/workspace',
      workspaceId: 'workspace',
      folderPath: '/workspace/sources/memory',
      config: {
        id: 'src_memory',
        name: 'memory',
        slug: 'memory',
        enabled: true,
        provider: 'local',
        type: 'mcp',
        mcp: {
          transport: 'stdio',
          command: 'bun',
          env: { WORKSPACE_ROOT: '/workspace' },
        },
      },
      guide: null,
    };

    const server = new SourceServerBuilder().buildMcpServer(source, null);

    expect(server).toEqual({
      type: 'stdio',
      command: 'bun',
      args: undefined,
      env: { WORKSPACE_ROOT: '/workspace' },
    });
  });
});
