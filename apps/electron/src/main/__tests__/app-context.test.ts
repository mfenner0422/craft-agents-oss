import { describe, expect, it } from 'bun:test'
import { FRONTMOST_BROWSER_CONTEXT_JXA } from '../app-context'

describe('frontmost browser context script', () => {
  it('supports Zen Browser autofill with a clipboard-restoring fallback', () => {
    expect(FRONTMOST_BROWSER_CONTEXT_JXA).toContain("case 'app.zen-browser.zen'")
    expect(FRONTMOST_BROWSER_CONTEXT_JXA).toContain("Application('Zen')")
    expect(FRONTMOST_BROWSER_CONTEXT_JXA).toContain('readZenLocationBar()')
    expect(FRONTMOST_BROWSER_CONTEXT_JXA).toContain('setTheClipboardTo(previousClipboard)')
  })
})
