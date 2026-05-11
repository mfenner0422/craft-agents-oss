import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'

const registerMock = mock((_accelerator: string, _callback: () => void) => true)
const unregisterMock = mock((_accelerator: string) => {})
const loadWorkspaceConfigMock = mock((_rootPath: string) => ({ capture: { enabled: true } }))

mock.module('electron', () => ({
  app: { on: mock(() => {}) },
  BrowserWindow: {
    getAllWindows: mock(() => []),
    getFocusedWindow: mock(() => null),
  },
  globalShortcut: {
    register: registerMock,
    unregister: unregisterMock,
  },
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  loadWorkspaceConfig: loadWorkspaceConfigMock,
}))

const { CaptureManager } = await import('../capture-manager')

describe('CaptureManager', () => {
  beforeEach(() => {
    registerMock.mockClear()
    unregisterMock.mockClear()
    loadWorkspaceConfigMock.mockClear()
  })

  it('binds hotkeys for workspaces stored with expandable root paths', () => {
    const manager = new CaptureManager({
      initialHotkey: 'CommandOrControl+Alt+Space',
      getWorkspaces: () => [{
        id: 'workspace-1',
        name: 'Workspace 1',
        slug: 'workspace-1',
        rootPath: '~/capture-test',
        createdAt: Date.now(),
      }],
      getWorkspaceForWindow: () => null,
      openCaptureWindow: mock(() => {}),
    })

    manager.start()

    expect(loadWorkspaceConfigMock).toHaveBeenCalledWith(join(homedir(), 'capture-test'))
    expect(registerMock).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function))
  })
})
