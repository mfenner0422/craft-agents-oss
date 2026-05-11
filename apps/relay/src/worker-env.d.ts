interface DurableObjectId {
  toString(): string
}

interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId
  idFromString(id: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T = unknown>(options?: { prefix?: string; limit?: number; reverse?: boolean }): Promise<Map<string, T>>
}

interface DurableObjectState {
  storage: DurableObjectStorage
  acceptWebSocket(ws: WebSocket): void
  getWebSockets(): WebSocket[]
}

declare class WebSocketPair {
  0: WebSocket
  1: WebSocket
}

interface WebSocket {
  readonly OPEN: number
  send(message: string | ArrayBuffer): void
  close(code?: number, reason?: string): void
  serializeAttachment(value: unknown): void
  deserializeAttachment<T = unknown>(): T
}
