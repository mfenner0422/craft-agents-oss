import { describe, expect, it } from 'bun:test'
import { formatForTelegram, splitTelegramMessages } from './format'

describe('Telegram MarkdownV2 formatter', () => {
  it('escapes plain text special characters', () => {
    expect(formatForTelegram('hello_world!')).toBe('hello\\_world\\!')
  })

  it('preserves inline code while escaping surrounding text', () => {
    expect(formatForTelegram('Run `npm test` now.')).toBe('Run `npm test` now\\.')
  })

  it('formats links with escaped label text', () => {
    expect(formatForTelegram('[Open docs](https://example.com/a-b)')).toBe('[Open docs](https://example.com/a-b)')
  })

  it('strips code block language tags', () => {
    expect(formatForTelegram('```ts\nconst x = 1\n```')).toBe('```\nconst x = 1\n```')
  })

  it('wraps markdown tables in code fences', () => {
    const formatted = formatForTelegram('| A | B |\n|---|---|\n| 1 | 2 |')

    expect(formatted).toContain('```')
    expect(formatted).toContain('| A | B |')
  })

  it('splits long messages below Telegram hard limit', () => {
    const chunks = splitTelegramMessages(`${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}`, 2500)

    expect(chunks).toHaveLength(2)
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true)
  })
})
