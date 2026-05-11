import { signToken } from './auth'
export { VaultRoom } from './durable/VaultRoom'

export interface Env {
  VAULT_ROOM: DurableObjectNamespace
  RELAY_HMAC_KEY: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/room/create' && request.method === 'POST') {
      return await createRoom(request, env, url)
    }

    const roomId = url.searchParams.get('room')
    if (!roomId) return json({ error: 'Missing room' }, 400)

    let id: DurableObjectId
    try {
      id = env.VAULT_ROOM.idFromString(roomId)
    } catch {
      return json({ error: 'Invalid room' }, 400)
    }

    return await env.VAULT_ROOM.get(id).fetch(request)
  },
}

async function createRoom(request: Request, env: Env, url: URL): Promise<Response> {
  let body: { vaultName?: string }
  try {
    body = await request.json() as { vaultName?: string }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const vaultName = body.vaultName?.trim()
  if (!vaultName) return json({ error: 'vaultName is required' }, 400)

  const id = env.VAULT_ROOM.newUniqueId()
  const roomId = id.toString()
  const desktopDeviceId = `desktop_${crypto.randomUUID()}`
  const desktopToken = await signToken({
    kind: 'desktop',
    roomId,
    deviceId: desktopDeviceId,
  }, env.RELAY_HMAC_KEY)

  const relayWsUrl = new URL('/v1/desktop', url.origin)
  relayWsUrl.protocol = relayWsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  relayWsUrl.searchParams.set('room', roomId)

  const stub = env.VAULT_ROOM.get(id)
  const initResponse = await stub.fetch(new Request(new URL('/internal/init', url.origin).toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-relay-internal': env.RELAY_HMAC_KEY,
    },
    body: JSON.stringify({ vaultName, desktopDeviceId }),
  }))
  if (!initResponse.ok) return initResponse

  return json({ roomId, desktopToken, relayWsUrl: relayWsUrl.toString() })
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
