import { describe, expect, it } from 'bun:test'
import { isRockyOnePasswordReference } from './rocky-1password-resolver'

describe('Rocky 1Password resolver', () => {
  it('recognizes Rocky op references', () => {
    expect(isRockyOnePasswordReference('op://Rocky/ANTHROPIC_API_KEY/token')).toBe(true)
  })

  it('rejects non-Rocky vault references', () => {
    expect(isRockyOnePasswordReference('op://Personal/ANTHROPIC_API_KEY/token')).toBe(false)
  })

  it('rejects partial references', () => {
    expect(isRockyOnePasswordReference('op://Rocky/ANTHROPIC_API_KEY')).toBe(false)
  })
})
