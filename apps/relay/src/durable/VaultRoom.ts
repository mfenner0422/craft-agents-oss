import {
  RPC_CHANNELS,
  PROTOCOL_VERSION,
  type MessageEnvelope,
  type RelayAck,
  type RelayEvent,
  type RelaySnapshot,
  type RelayWrite,
  type RelayWriteFromDevice,
} from '@craft-agent/shared/protocol'
import { bearerToken, signToken, verifyToken, type SignedTokenPayload } from '../auth'
import type { Env } from '../worker'
import type {
  PairingRecord,
  QueuedWriteRecord,
  RelayDeviceRecord,
  RelayEventLogRecord,
  RoomMeta,
  WriteStatusRecord,
} from '../protocol'

type SocketRole = 'desktop' | 'device'

interface SocketAttachment {
  role: SocketRole
  roomId: string
  deviceId: string
  kind: 'desktop' | 'phone' | 'pad'
}

export class VaultRoom {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/internal/init' && request.method === 'POST') {
      return await this.initRoom(request)
    }

    if (url.pathname === '/pair/start' && request.method === 'POST') {
      return await this.startPairing(request)
    }

    if (url.pathname === '/pair/complete' && request.method === 'POST') {
      return await this.completePairing(request)
    }

    if (url.pathname === '/pair/revoke' && request.method === 'POST') {
      return await this.revokeDevice(request)
    }

    if ((url.pathname === '/v1/desktop' || url.pathname === '/v1/device') && request.headers.get('upgrade') === 'websocket') {
      return await this.acceptSocket(request, url.pathname === '/v1/desktop' ? 'desktop' : 'device')
    }

    return json({ error: 'Not found' }, 404)
  }

  private async initRoom(request: Request): Promise<Response> {
    if (request.headers.get('x-relay-internal') !== this.env.RELAY_HMAC_KEY) {
      return json({ error: 'Forbidden' }, 403)
    }

    const existing = await this.state.storage.get<RoomMeta>('meta')
    if (existing) return json({ ok: true })

    const body = await request.json() as { vaultName: string; desktopDeviceId: string }
    const now = new Date().toISOString()
    const meta: RoomMeta = {
      vaultName: body.vaultName,
      ownerDeviceId: body.desktopDeviceId,
      createdAt: now,
    }
    await this.state.storage.put('meta', meta)
    await this.state.storage.put(`devices/${body.desktopDeviceId}`, {
      kind: 'desktop',
      name: 'Desktop',
      pairedAt: now,
      lastSeenAt: now,
    } satisfies RelayDeviceRecord)
    return json({ ok: true })
  }

  private async startPairing(request: Request): Promise<Response> {
    const token = await this.requireToken(request, 'desktop')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const meta = await this.state.storage.get<RoomMeta>('meta')
    if (!meta?.desktopWorkspaceId) return json({ error: 'Room metadata is not ready' }, 409)

    const now = new Date()
    const expires = new Date(now.getTime() + 10 * 60 * 1000)
    const pairingToken = await signToken({
      kind: 'pairing',
      roomId: token.roomId,
      exp: Math.floor(expires.getTime() / 1000),
      nonce: crypto.randomUUID(),
    }, this.env.RELAY_HMAC_KEY)

    const record: PairingRecord = {
      roomId: token.roomId,
      token: pairingToken,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }
    await this.state.storage.put(`pair/${pairingToken}`, record)

    const relayUrl = new URL(request.url)
    relayUrl.pathname = '/v1/device'
    relayUrl.searchParams.set('room', token.roomId)
    relayUrl.protocol = relayUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    return json({
      pairingToken,
      roomId: token.roomId,
      relayUrl: relayUrl.toString(),
      expiresAt: record.expiresAt,
    })
  }

  private async completePairing(request: Request): Promise<Response> {
    const body = await request.json() as { pairingToken?: string; deviceName?: string; kind?: 'phone' | 'pad' }
    if (!body.pairingToken || !body.deviceName || (body.kind !== 'phone' && body.kind !== 'pad')) {
      return json({ error: 'Invalid pairing request' }, 400)
    }

    const token = await verifyToken(body.pairingToken, this.env.RELAY_HMAC_KEY)
    if (!token || token.kind !== 'pairing') return json({ error: 'Invalid pairing token' }, 401)

    const pairKey = `pair/${body.pairingToken}`
    const record = await this.state.storage.get<PairingRecord>(pairKey)
    if (!record || record.roomId !== token.roomId || Date.parse(record.expiresAt) < Date.now()) {
      return json({ error: 'Pairing token expired' }, 401)
    }
    await this.state.storage.delete(pairKey)

    const deviceId = `${body.kind}_${crypto.randomUUID()}`
    const now = new Date().toISOString()
    await this.state.storage.put(`devices/${deviceId}`, {
      kind: body.kind,
      name: body.deviceName,
      pairedAt: now,
      lastSeenAt: now,
    } satisfies RelayDeviceRecord)

    const deviceToken = await signToken({
      kind: 'device',
      roomId: token.roomId,
      deviceId,
    }, this.env.RELAY_HMAC_KEY)

    this.broadcastToRole('desktop', {
      id: crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.DEVICE_PAIRED,
      args: [{ deviceId, kind: body.kind, name: body.deviceName, pairedAt: now }],
      serverId: 'relay',
    })

    const relayWsUrl = new URL(request.url)
    relayWsUrl.pathname = '/v1/device'
    relayWsUrl.searchParams.set('room', token.roomId)
    relayWsUrl.searchParams.set('device', deviceId)
    relayWsUrl.protocol = relayWsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    return json({ deviceId, deviceToken, roomId: token.roomId, relayWsUrl: relayWsUrl.toString() })
  }

  private async revokeDevice(request: Request): Promise<Response> {
    const token = await this.requireToken(request, 'desktop')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const body = await request.json() as { deviceId?: string }
    if (!body.deviceId) return json({ error: 'deviceId is required' }, 400)

    const key = `devices/${body.deviceId}`
    const device = await this.state.storage.get<RelayDeviceRecord>(key)
    if (!device || device.kind === 'desktop') return json({ error: 'Device not found' }, 404)

    await this.state.storage.put(key, { ...device, revokedAt: new Date().toISOString() })
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment<SocketAttachment | undefined>()
      if (attachment?.deviceId === body.deviceId) ws.close(4005, 'Device revoked')
    }
    return json({ ok: true })
  }

  private async acceptSocket(request: Request, role: SocketRole): Promise<Response> {
    const expectedKind = role === 'desktop' ? 'desktop' : 'device'
    const token = await this.requireToken(request, expectedKind)
    if (!token?.deviceId) return json({ error: 'Unauthorized' }, 401)

    const url = new URL(request.url)
    if (url.searchParams.get('room') !== token.roomId) return json({ error: 'Room mismatch' }, 403)
    if (role === 'device' && url.searchParams.get('device') !== token.deviceId) return json({ error: 'Device mismatch' }, 403)

    const device = await this.state.storage.get<RelayDeviceRecord>(`devices/${token.deviceId}`)
    if (!device || device.revokedAt) return json({ error: 'Device revoked' }, 403)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server)
    server.serializeAttachment({
      role,
      roomId: token.roomId,
      deviceId: token.deviceId,
      kind: device.kind,
    } satisfies SocketAttachment)

    await this.state.storage.put(`devices/${token.deviceId}`, {
      ...device,
      lastSeenAt: new Date().toISOString(),
    } satisfies RelayDeviceRecord)

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment<SocketAttachment | undefined>()
    if (!attachment) {
      ws.close(4006, 'Missing attachment')
      return
    }

    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
    let envelope: MessageEnvelope
    try {
      envelope = JSON.parse(raw) as MessageEnvelope
    } catch {
      ws.close(4002, 'Invalid JSON')
      return
    }

    if (envelope.type === 'handshake') {
      const ack: MessageEnvelope = {
        id: envelope.id,
        type: 'handshake_ack',
        protocolVersion: PROTOCOL_VERSION,
        clientId: attachment.deviceId,
        serverId: 'relay',
      }
      ws.send(JSON.stringify(ack))
      if (attachment.role === 'device') {
        await this.sendSnapshots(ws)
      } else {
        await this.drainQueueToDesktop(ws)
      }
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.SET_META && attachment.role === 'desktop') {
      const meta = await this.state.storage.get<RoomMeta>('meta')
      const patch = envelope.args?.[0] as { desktopWorkspaceId?: string; vaultName?: string } | undefined
      if (meta && patch?.desktopWorkspaceId) {
        await this.state.storage.put('meta', {
          ...meta,
          desktopWorkspaceId: patch.desktopWorkspaceId,
          vaultName: patch.vaultName ?? meta.vaultName,
        } satisfies RoomMeta)
      }
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.SNAPSHOT && attachment.role === 'desktop') {
      await this.storeSnapshot(envelope)
      this.forward('device', JSON.stringify(envelope))
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.EVENT && attachment.role === 'desktop') {
      await this.storeAndForwardRelayEvent(envelope, attachment.deviceId)
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.WRITE && attachment.role === 'device') {
      await this.handleDeviceWrite(envelope, attachment.deviceId)
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.ACK && attachment.role === 'desktop') {
      await this.handleDesktopAck(envelope)
      return
    }

    if (envelope.channel === RPC_CHANNELS.relay.ACK && attachment.role === 'device') {
      return
    }

    this.forward(attachment.role === 'desktop' ? 'device' : 'desktop', raw)
  }

  async webSocketClose(): Promise<void> {}

  async webSocketError(): Promise<void> {}

  private async requireToken(request: Request, kind: 'desktop' | 'device'): Promise<SignedTokenPayload | null> {
    const token = bearerToken(request)
    if (!token) return null
    const payload = await verifyToken(token, this.env.RELAY_HMAC_KEY)
    if (!payload || payload.kind !== kind) return null
    return payload
  }

  private async storeSnapshot(envelope: MessageEnvelope): Promise<void> {
    const snapshot = envelope.args?.[0] as RelaySnapshot | undefined
    if (!snapshot || !['tasks', 'inbox', 'day'].includes(snapshot.kind)) return
    const key = snapshot.kind === 'day'
      ? `snap/days/${snapshot.key}`
      : `snap/${snapshot.kind}`
    if (snapshot.kind === 'day' && !snapshot.key) return
    await this.state.storage.put(key, snapshot)
  }

  private async sendSnapshots(ws: WebSocket): Promise<void> {
    const snapshots = await this.state.storage.list<RelaySnapshot>({ prefix: 'snap/' })
    for (const snapshot of snapshots.values()) {
      const envelope: MessageEnvelope = {
        id: crypto.randomUUID(),
        type: 'event',
        channel: RPC_CHANNELS.relay.SNAPSHOT,
        args: [snapshot],
        serverId: 'relay',
      }
      ws.send(JSON.stringify(envelope))
    }
  }

  private async storeAndForwardRelayEvent(envelope: MessageEnvelope, originDeviceId: string): Promise<void> {
    const incoming = envelope.args?.[0] as Partial<RelayEvent> | undefined
    if (!incoming?.envelope?.channel) return

    const serverSeq = await this.nextSeq('counters/eventSeq')
    const event: RelayEventLogRecord = {
      originDeviceId,
      serverSeq,
      envelope: incoming.envelope,
      capturedAt: new Date().toISOString(),
    }
    await this.state.storage.put(`log/${padSeq(serverSeq)}`, event)

    const relayEnvelope: MessageEnvelope = {
      id: envelope.id || crypto.randomUUID(),
      type: 'event',
      channel: RPC_CHANNELS.relay.EVENT,
      args: [{ originDeviceId, serverSeq, envelope: incoming.envelope } satisfies RelayEvent],
      serverId: 'relay',
    }
    this.forward('device', JSON.stringify(relayEnvelope))
    await this.compactEventLog()
  }

  private async handleDeviceWrite(envelope: MessageEnvelope, deviceId: string): Promise<void> {
    const meta = await this.state.storage.get<RoomMeta>('meta')
    if (!meta?.desktopWorkspaceId) {
      this.sendWriteAck(deviceId, envelope.id, {
        kind: 'write',
        writeId: readWriteId(envelope) ?? 'unknown',
        status: 'rejected',
        error: { code: 'HANDLER_ERROR', message: 'Room metadata is not ready' },
      })
      return
    }

    const incoming = envelope.args?.[0] as RelayWriteFromDevice | undefined
    if (!incoming?.writeId || !incoming.targetChannel || !Array.isArray(incoming.args)) return

    const statusKey = `writeStatus/${deviceId}/${incoming.writeId}`
    const existing = await this.state.storage.get<WriteStatusRecord>(statusKey)
    if (existing) {
      this.sendWriteAck(deviceId, envelope.id, existing.ack)
      return
    }

    const write: RelayWrite = {
      ...incoming,
      deviceId,
      workspaceId: meta.desktopWorkspaceId,
    }
    const outgoing: MessageEnvelope = {
      ...envelope,
      args: [write],
    }

    const desktop = this.firstSocket('desktop')
    if (desktop) {
      desktop.send(JSON.stringify(outgoing))
      return
    }

    const queueSeq = await this.nextSeq('counters/queueSeq')
    const queued: QueuedWriteRecord = {
      ...write,
      queueSeq,
      attempts: 0,
    }
    await this.state.storage.put(`queue/${padSeq(queueSeq)}`, queued)
  }

  private async handleDesktopAck(envelope: MessageEnvelope): Promise<void> {
    const ack = envelope.args?.[0] as RelayAck | undefined
    if (!ack || ack.kind !== 'write') return

    const queued = await this.findQueuedWrite(ack.writeId)
    const deviceId = queued?.deviceId
    if (deviceId) {
      await this.state.storage.put(`writeStatus/${deviceId}/${ack.writeId}`, {
        deviceId,
        writeId: ack.writeId,
        ack,
        updatedAt: new Date().toISOString(),
      } satisfies WriteStatusRecord)
      await this.state.storage.delete(`queue/${padSeq(queued.queueSeq)}`)
      this.sendWriteAck(deviceId, envelope.id, ack)
      return
    }

    this.forward('device', JSON.stringify(envelope))
  }

  private async drainQueueToDesktop(ws: WebSocket): Promise<void> {
    const queued = await this.state.storage.list<QueuedWriteRecord>({ prefix: 'queue/' })
    for (const [key, write] of queued) {
      const nextWrite = { ...write, attempts: write.attempts + 1 }
      await this.state.storage.put(key, nextWrite)
      const envelope: MessageEnvelope = {
        id: crypto.randomUUID(),
        type: 'event',
        channel: RPC_CHANNELS.relay.WRITE,
        args: [nextWrite],
        serverId: 'relay',
      }
      ws.send(JSON.stringify(envelope))
    }
  }

  private async findQueuedWrite(writeId: string): Promise<QueuedWriteRecord | null> {
    const queued = await this.state.storage.list<QueuedWriteRecord>({ prefix: 'queue/' })
    for (const write of queued.values()) {
      if (write.writeId === writeId) return write
    }
    return null
  }

  private sendWriteAck(deviceId: string, id: string, ack: Extract<RelayAck, { kind: 'write' }>): void {
    const envelope: MessageEnvelope = {
      id,
      type: 'event',
      channel: RPC_CHANNELS.relay.ACK,
      args: [ack],
      serverId: 'relay',
    }
    const raw = JSON.stringify(envelope)
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment<SocketAttachment | undefined>()
      if (attachment?.role === 'device' && attachment.deviceId === deviceId) ws.send(raw)
    }
  }

  private async nextSeq(key: string): Promise<number> {
    const current = await this.state.storage.get<number>(key) ?? 0
    const next = current + 1
    await this.state.storage.put(key, next)
    return next
  }

  private firstSocket(role: SocketRole): WebSocket | null {
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment<SocketAttachment | undefined>()
      if (attachment?.role === role) return ws
    }
    return null
  }

  private async compactEventLog(): Promise<void> {
    const logs = await this.state.storage.list<RelayEventLogRecord>({ prefix: 'log/' })
    const entries = [...logs.entries()]
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000
    const overCount = Math.max(0, entries.length - 5000)
    let compactedThroughSeq = 0

    for (let i = 0; i < entries.length; i++) {
      const [key, event] = entries[i]!
      const shouldDropForCount = i < overCount
      const shouldDropForAge = Date.parse(event.capturedAt) < cutoffTime
      if (!shouldDropForCount && !shouldDropForAge) continue
      await this.state.storage.delete(key)
      compactedThroughSeq = Math.max(compactedThroughSeq, event.serverSeq)
    }

    if (compactedThroughSeq > 0) {
      const meta = await this.state.storage.get<RoomMeta>('meta')
      if (meta) {
        await this.state.storage.put('meta', {
          ...meta,
          compactedThroughSeq: Math.max(meta.compactedThroughSeq ?? 0, compactedThroughSeq),
        } satisfies RoomMeta)
      }
    }
  }

  private forward(role: SocketRole, raw: string): void {
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment<SocketAttachment | undefined>()
      if (attachment?.role === role) ws.send(raw)
    }
  }

  private broadcastToRole(role: SocketRole, envelope: MessageEnvelope): void {
    const raw = JSON.stringify(envelope)
    this.forward(role, raw)
  }
}

function readWriteId(envelope: MessageEnvelope): string | null {
  const write = envelope.args?.[0] as { writeId?: unknown } | undefined
  return typeof write?.writeId === 'string' ? write.writeId : null
}

function padSeq(seq: number): string {
  return String(seq).padStart(16, '0')
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
