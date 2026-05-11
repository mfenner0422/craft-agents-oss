import { describe, expect, test } from 'bun:test'
import { signToken, verifyToken } from '../auth'

const SECRET = 'relay-test-secret-with-enough-entropy'

describe('relay token auth', () => {
  test('round-trips a signed desktop token', async () => {
    const token = await signToken({
      kind: 'desktop',
      roomId: 'room-test',
      deviceId: 'desktop-test',
    }, SECRET)

    await expect(verifyToken(token, SECRET)).resolves.toEqual({
      kind: 'desktop',
      roomId: 'room-test',
      deviceId: 'desktop-test',
    })
  })

  test('rejects tampered token payloads', async () => {
    const token = await signToken({
      kind: 'device',
      roomId: 'room-test',
      deviceId: 'phone-test',
    }, SECRET)
    const [payload, signature] = token.split('.')
    const tampered = `${payload?.replace(/.$/, payload.endsWith('A') ? 'B' : 'A')}.${signature}`

    await expect(verifyToken(tampered, SECRET)).resolves.toBeNull()
  })

  test('rejects expired tokens', async () => {
    const token = await signToken({
      kind: 'pairing',
      roomId: 'room-test',
      exp: Math.floor(Date.now() / 1000) - 1,
    }, SECRET)

    await expect(verifyToken(token, SECRET)).resolves.toBeNull()
  })
})
