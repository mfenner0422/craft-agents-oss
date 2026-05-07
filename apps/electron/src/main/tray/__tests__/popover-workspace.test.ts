import { describe, expect, it } from 'bun:test'
import { shouldReloadPopoverWorkspace } from '../popover-workspace'

describe('shouldReloadPopoverWorkspace', () => {
  it('does not reload when showing the same workspace again', () => {
    expect(shouldReloadPopoverWorkspace('workspace-1', 'workspace-1')).toBe(false)
  })

  it('reloads when the target workspace changes', () => {
    expect(shouldReloadPopoverWorkspace('workspace-1', 'workspace-2')).toBe(true)
    expect(shouldReloadPopoverWorkspace(null, 'workspace-1')).toBe(true)
  })
})
