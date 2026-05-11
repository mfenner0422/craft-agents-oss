import { WebSocket } from 'ws'
import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
} from '@craft-agent/shared/protocol'
import { serializeEnvelope, deserializeEnvelope } from '../transport/codec'

export type RelaySocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface RelaySocketOptions {
  token: string
  deviceId?: string
  maxReconnectDelayMs?: number
}

type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>
type StatusHandler = (status: RelaySocketStatus) => void

export class RelaySocket {
  private ws: WebSocket | null = null
  private status: RelaySocketStatus = 'idle'
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false
  private messageHandlers = new Set<MessageHandler>()
  private statusHandlers = new Set<StatusHandler>()

  constructor(
    private readonly url: string,
    private readonly opts: RelaySocketOptions,
  ) {}

  connect(): void {
    if (this.destroyed || this.ws) return
    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    const ws = new WebSocket(this.url, {
      headers: { authorization: `Bearer ${this.opts.token}` },
    })
    this.ws = ws

    ws.on('open', () => {
      const handshake: MessageEnvelope = {
        id: crypto.randomUUID(),
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        token: this.opts.token,
      }
      ws.send(serializeEnvelope(handshake))
    })

    ws.on('message', (data) => {
      let envelope: MessageEnvelope
      try {
        envelope = deserializeEnvelope(data.toString())
      } catch {
        return
      }

      if (envelope.type === 'handshake_ack') {
        this.reconnectAttempt = 0
        this.setStatus('connected')
        this.startHeartbeat()
        return
      }

      for (const handler of this.messageHandlers) {
        void handler(envelope)
      }
    })

    ws.on('close', () => this.onClose(ws))
    ws.on('error', () => {
      // close drives retry state; ws can emit both error and close.
    })
  }

  send(envelope: MessageEnvelope): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'connected') return false
    this.ws.send(serializeEnvelope(envelope))
    return true
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.status)
    return () => this.statusHandlers.delete(handler)
  }

  get isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return
    this.ws = null
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    if (this.destroyed) return

    this.setStatus('disconnected')
    const base = [1000, 2000, 5000, 15000, 60000][Math.min(this.reconnectAttempt, 4)] ?? 60000
    const max = this.opts.maxReconnectDelayMs ?? 60000
    const jitter = Math.floor(Math.random() * Math.min(base * 0.25, 5000))
    const delay = Math.min(base + jitter, max)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping()
    }, 60_000)
  }

  private setStatus(status: RelaySocketStatus): void {
    this.status = status
    for (const handler of this.statusHandlers) handler(status)
  }
}
