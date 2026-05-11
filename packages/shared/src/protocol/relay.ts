import type { MessageEnvelope, WireError } from './types'

export type RelayDeviceKind = 'desktop' | 'phone' | 'pad'

export interface RelayWriteFromDevice {
  writeId: string
  targetChannel: string
  args: unknown[]
  createdAt: string
}

export interface RelayWrite extends RelayWriteFromDevice {
  deviceId: string
  workspaceId: string
}

export type RelaySnapshotKind = 'tasks' | 'inbox' | 'day'

export interface RelaySnapshot {
  kind: RelaySnapshotKind
  key?: string
  payload: unknown
  version: number
  capturedAt: string
}

export interface RelayEvent {
  originDeviceId: string
  serverSeq: number
  envelope: MessageEnvelope
}

export type RelayAck =
  | { kind: 'event'; upToSeq: number }
  | { kind: 'write'; writeId: string; status: 'applied' | 'rejected'; error?: WireError }

export interface RelaySetMeta {
  desktopWorkspaceId: string
  vaultName?: string
}

export interface RelayDevicePaired {
  deviceId: string
  kind: Exclude<RelayDeviceKind, 'desktop'>
  name: string
  pairedAt: string
}

export interface RelayRoomCreateRequest {
  vaultName: string
}

export interface RelayRoomCreateResponse {
  roomId: string
  desktopToken: string
  relayWsUrl: string
}

export interface RelayPairStartResponse {
  pairingToken: string
  roomId: string
  relayUrl: string
  expiresAt: string
}

export interface RelayPairCompleteRequest {
  pairingToken: string
  deviceName: string
  kind: Exclude<RelayDeviceKind, 'desktop'>
}

export interface RelayPairCompleteResponse {
  deviceId: string
  deviceToken: string
  roomId: string
  relayWsUrl: string
}
