import { describe, expect, it } from 'bun:test'
import {
  hasVisibleUnmanagedWindow,
  selectWorkspaceForEmptyAppActivation,
  selectWorkspaceForHiddenWindowActivation,
} from '../window-activation'

function win({ visible, destroyed = false }: { visible: boolean; destroyed?: boolean }) {
  return {
    isVisible: () => visible,
    isDestroyed: () => destroyed,
  }
}

describe('window activation helpers', () => {
  it('restores an empty app to the runtime-focused workspace before stale saved state', () => {
    expect(selectWorkspaceForEmptyAppActivation({
      workspaceIds: ['default', 'current'],
      lastFocusedWorkspaceId: 'current',
      savedLastFocusedWorkspaceId: 'default',
    })).toBe('current')
  })

  it('restores hidden managed windows without preferring stale saved state', () => {
    expect(selectWorkspaceForHiddenWindowActivation({
      managedWindows: [{ window: win({ visible: false }), workspaceId: 'current' }],
      workspaceIds: ['default', 'current'],
      lastFocusedWorkspaceId: null,
    })).toBe('current')
  })

  it('detects visible capture or tray windows separately from managed main windows', () => {
    const managedWindow = win({ visible: false })
    const captureWindow = win({ visible: true })

    expect(hasVisibleUnmanagedWindow(
      [managedWindow, captureWindow],
      [{ window: managedWindow, workspaceId: 'current' }],
    )).toBe(true)
  })
})
