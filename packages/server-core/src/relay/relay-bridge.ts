import {
  RPC_CHANNELS,
  type MessageEnvelope,
  type RelayAck,
  type RelayEvent,
  type RelaySetMeta,
  type RelaySnapshot,
  type RelayWrite,
} from '@craft-agent/shared/protocol'
import type { EventSink, RequestContext, RpcServer } from '../transport/types'
import { RelaySocket } from './relay-socket'

export interface RelayBridgeOptions {
  url: string
  token: string
  roomId: string
  workspaceId: string
  vaultName?: string
  server: RpcServer
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface RelayWorkspaceConfig {
  id: string
  name?: string
  remoteServer?: {
    mode?: 'direct' | 'relay'
    url: string
    token: string
    roomId?: string
  } | null
}

const EVENT_CHANNELS = new Set<string>([
  RPC_CHANNELS.tasks.CHANGED,
  RPC_CHANNELS.days.CHANGED,
  RPC_CHANNELS.capture.SAVED,
])

const WRITE_CHANNELS_PREPEND_WORKSPACE = new Set<string>([
  RPC_CHANNELS.tasks.CREATE,
  RPC_CHANNELS.tasks.UPDATE,
  RPC_CHANNELS.tasks.PROMOTE,
  RPC_CHANNELS.days.MOVE_TASK,
  RPC_CHANNELS.days.UPDATE_FILE,
  RPC_CHANNELS.days.UPDATE_TASK_LISTS,
  RPC_CHANNELS.days.PULL_FORWARD,
  RPC_CHANNELS.capture.PROMOTE,
  RPC_CHANNELS.capture.DELETE,
])

export class RelayBridge {
  readonly eventSink: EventSink
  private readonly socket: RelaySocket
  private readonly applied = new Map<string, RelayAck>()

  constructor(private readonly opts: RelayBridgeOptions) {
    this.socket = new RelaySocket(withRoom(opts.url, opts.roomId), { token: opts.token })
    this.eventSink = (channel, _target, ...args) => {
      if (!EVENT_CHANNELS.has(channel)) return
      this.sendRelayEvent(channel, args)
    }
    this.socket.onMessage((envelope) => this.onMessage(envelope))
    this.socket.onStatus((status) => {
      if (status !== 'connected') return
      this.sendSetMeta()
      void this.pushInitialSnapshots()
    })
  }

  start(): void {
    this.socket.connect()
  }

  stop(): void {
    this.socket.destroy()
  }

  private async onMessage(envelope: MessageEnvelope): Promise<void> {
    if (envelope.channel === RPC_CHANNELS.relay.WRITE) {
      await this.applyWrite(envelope.args?.[0] as RelayWrite | undefined)
      return
    }

    if (envelope.type === 'request' && envelope.channel) {
      await this.dispatchRequest(envelope)
    }
  }

  private sendSetMeta(): void {
    const payload: RelaySetMeta = {
      desktopWorkspaceId: this.opts.workspaceId,
      ...(this.opts.vaultName ? { vaultName: this.opts.vaultName } : {}),
    }
    this.socket.send({
      id: crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.SET_META,
      args: [payload],
    })
  }

  private sendRelayEvent(channel: string, args: any[]): void {
    const inner: MessageEnvelope = {
      id: crypto.randomUUID(),
      type: 'event',
      channel,
      args,
    }
    const event: Partial<RelayEvent> = {
      originDeviceId: 'desktop',
      serverSeq: 0,
      envelope: inner,
    }
    this.socket.send({
      id: crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.EVENT,
      args: [event],
    })
  }

  private async applyWrite(write: RelayWrite | undefined): Promise<void> {
    if (!write?.writeId || !write.targetChannel) return
    const key = `${write.deviceId}:${write.writeId}`
    const cached = this.applied.get(key)
    if (cached) {
      this.sendAck(cached)
      return
    }

    try {
      const args = normalizeRelayWriteArgs(write)
      await this.dispatch(write.targetChannel, args, `relay:${write.deviceId}`)
      const ack: RelayAck = { kind: 'write', writeId: write.writeId, status: 'applied' }
      this.rememberAck(key, ack)
      this.sendAck(ack)
    } catch (error) {
      const ack: RelayAck = {
        kind: 'write',
        writeId: write.writeId,
        status: 'rejected',
        error: {
          code: (error as any)?.code ?? 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
      this.rememberAck(key, ack)
      this.sendAck(ack)
    }
  }

  private async dispatchRequest(envelope: MessageEnvelope): Promise<void> {
    try {
      const result = await this.dispatch(envelope.channel!, envelope.args ?? [], 'relay:request')
      this.socket.send({
        id: envelope.id,
        type: 'response',
        channel: envelope.channel,
        result,
      })
    } catch (error) {
      this.socket.send({
        id: envelope.id,
        type: 'response',
        channel: envelope.channel,
        error: {
          code: (error as any)?.code ?? 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private async dispatch(channel: string, args: any[], clientId: string): Promise<any> {
    if (!this.opts.server.dispatch) throw new Error('Server dispatch is unavailable')
    const ctx: RequestContext = {
      clientId,
      workspaceId: this.opts.workspaceId,
      webContentsId: null,
    }
    return await this.opts.server.dispatch(channel, ctx, args)
  }

  private sendAck(ack: RelayAck): void {
    this.socket.send({
      id: crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.ACK,
      args: [ack],
    })
  }

  private rememberAck(key: string, ack: RelayAck): void {
    this.applied.set(key, ack)
    if (this.applied.size <= 1000) return
    const first = this.applied.keys().next().value
    if (first) this.applied.delete(first)
  }

  private async pushInitialSnapshots(): Promise<void> {
    const { createRelaySnapshots } = await import('./relay-snapshot')
    for (const snapshot of await createRelaySnapshots(this.opts.server, this.opts.workspaceId)) {
      this.sendSnapshot(snapshot)
    }
  }

  private sendSnapshot(snapshot: RelaySnapshot): void {
    this.socket.send({
      id: crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.SNAPSHOT,
      args: [snapshot],
    })
  }
}

export function createRelayBridgesForWorkspaces(
  workspaces: RelayWorkspaceConfig[],
  server: RpcServer,
  logger?: RelayBridgeOptions['logger'],
): RelayBridge[] {
  return workspaces
    .filter((workspace) => workspace.remoteServer?.mode === 'relay' && workspace.remoteServer.roomId)
    .map((workspace) => new RelayBridge({
      url: workspace.remoteServer!.url,
      token: workspace.remoteServer!.token,
      roomId: workspace.remoteServer!.roomId!,
      workspaceId: workspace.id,
      vaultName: workspace.name,
      server,
      logger,
    }))
}

export function normalizeRelayWriteArgs(write: RelayWrite): any[] {
  if (write.targetChannel === RPC_CHANNELS.capture.SAVE) {
    const input = write.args[0]
    if (!input || typeof input !== 'object') return [{ workspaceId: write.workspaceId }]
    return [{ ...(input as Record<string, unknown>), workspaceId: write.workspaceId }]
  }

  if (WRITE_CHANNELS_PREPEND_WORKSPACE.has(write.targetChannel)) {
    return [write.workspaceId, ...write.args]
  }

  return write.args
}

function withRoom(url: string, roomId: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('room', roomId)
  return parsed.toString()
}
