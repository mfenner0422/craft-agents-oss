import { describe, expect, test } from 'bun:test'
import { RPC_CHANNELS, type RelayWrite } from '@craft-agent/shared/protocol'
import { normalizeRelayWriteArgs } from '../relay-bridge'

function write(targetChannel: string, args: unknown[]): RelayWrite {
  return {
    writeId: 'write-1',
    deviceId: 'phone-1',
    workspaceId: 'workspace-1',
    targetChannel,
    args,
    createdAt: new Date(0).toISOString(),
  }
}

describe('RelayBridge write normalization', () => {
  test('prepends workspaceId for task and day writes', () => {
    expect(normalizeRelayWriteArgs(write(RPC_CHANNELS.tasks.UPDATE, ['task-1', { status: 'completed' }]))).toEqual([
      'workspace-1',
      'task-1',
      { status: 'completed' },
    ])

    expect(normalizeRelayWriteArgs(write(RPC_CHANNELS.days.MOVE_TASK, ['task-1', { kind: 'next' }]))).toEqual([
      'workspace-1',
      'task-1',
      { kind: 'next' },
    ])
  })

  test('merges workspaceId into capture:save object input', () => {
    expect(normalizeRelayWriteArgs(write(RPC_CHANNELS.capture.SAVE, [{ source: 'ios', body: 'note' }]))).toEqual([
      { source: 'ios', body: 'note', workspaceId: 'workspace-1' },
    ])
  })
})
