export type TokenKind = 'desktop' | 'device' | 'pairing'

export interface SignedTokenPayload {
  kind: TokenKind
  roomId: string
  deviceId?: string
  exp?: number
  nonce?: string
}

const textEncoder = new TextEncoder()

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

export async function signToken(payload: SignedTokenPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)))
  const signature = await signBytes(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export async function verifyToken(token: string, secret: string): Promise<SignedTokenPayload | null> {
  const [encodedPayload, signature, extra] = token.split('.')
  if (!encodedPayload || !signature || extra != null) return null

  const expected = await signBytes(encodedPayload, secret)
  if (!timingSafeEqual(signature, expected)) return null

  let payload: SignedTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as SignedTokenPayload
  } catch {
    return null
  }

  if (payload.exp != null && payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

async function signBytes(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value))
  return base64UrlEncode(new Uint8Array(signature))
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = textEncoder.encode(left)
  const b = textEncoder.encode(right)
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
