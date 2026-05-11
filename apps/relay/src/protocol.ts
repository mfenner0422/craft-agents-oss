import type {
  RelayAck,
  RelayDevicePaired,
  RelayEvent,
  RelaySetMeta,
  RelaySnapshot,
  RelayWrite,
  RelayWriteFromDevice,
} from '@craft-agent/shared/protocol'

export type RelayMessagePayload =
  | RelayWrite
  | RelayWriteFromDevice
  | RelaySnapshot
  | RelayEvent
  | RelayAck
  | RelaySetMeta
  | RelayDevicePaired

export interface RoomMeta {
  vaultName: string
  ownerDeviceId: string
  desktopWorkspaceId?: string
  createdAt: string
  compactedThroughSeq?: number
}

export interface RelayDeviceRecord {
  kind: 'desktop' | 'phone' | 'pad'
  name: string
  pairedAt: string
  lastSeenAt?: string
  revokedAt?: string
}

export interface PairingRecord {
  roomId: string
  token: string
  createdAt: string
  expiresAt: string
}

export interface QueuedWriteRecord extends RelayWrite {
  queueSeq: number
  attempts: number
}

export interface WriteStatusRecord {
  deviceId: string
  writeId: string
  ack: Extract<RelayAck, { kind: 'write' }>
  updatedAt: string
}

export interface RelayEventLogRecord extends RelayEvent {
  capturedAt: string
}
