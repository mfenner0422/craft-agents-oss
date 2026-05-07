import { app, BrowserWindow, globalShortcut } from 'electron'
import type { Workspace } from '@craft-agent/shared/config/storage'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { mainLog } from './logger'

export interface CaptureManagerOptions {
  initialHotkey: string
  getWorkspaces: () => Workspace[]
  getWorkspaceForWindow: (webContentsId: number) => string | null
  openCaptureWindow: (workspaceId: string) => void
}

export class CaptureManager {
  private hotkey: string
  private readonly getWorkspaces: () => Workspace[]
  private readonly getWorkspaceForWindow: (webContentsId: number) => string | null
  private readonly openCaptureWindow: (workspaceId: string) => void
  private readonly mruWorkspaceIds: string[] = []
  private lastFocusedWebContentsId: number | null = null
  private activeWorkspaceId: string | null = null
  private bound = false
  private trackingInstalled = false

  constructor(options: CaptureManagerOptions) {
    this.hotkey = options.initialHotkey
    this.getWorkspaces = options.getWorkspaces
    this.getWorkspaceForWindow = options.getWorkspaceForWindow
    this.openCaptureWindow = options.openCaptureWindow
  }

  start(): void {
    this.installWindowFocusTracking()
    this.refreshTargetWorkspaces()
  }

  setHotkey(accelerator: string): { ok: boolean; error?: string } {
    const previous = this.hotkey
    const wasBound = this.bound
    if (wasBound) globalShortcut.unregister(previous)
    this.hotkey = accelerator
    const result = this.hasEnabledWorkspace() ? this.bind(accelerator) : { ok: true }
    if (!result.ok) {
      this.hotkey = previous
      if (wasBound) this.bind(previous)
      return result
    }
    return { ok: true }
  }

  setActiveWorkspaceId(workspaceId: string): void {
    this.activeWorkspaceId = workspaceId
    this.rememberWorkspace(workspaceId)
  }

  refreshTargetWorkspaces(): void {
    if (!this.hasEnabledWorkspace()) {
      if (this.bound) {
        globalShortcut.unregister(this.hotkey)
        this.bound = false
      }
      return
    }

    if (!this.bound) {
      const result = this.bind(this.hotkey)
      if (!result.ok) {
        mainLog.warn('[capture] Failed to register capture hotkey:', result.error)
      }
    }
  }

  dispose(): void {
    if (this.bound) {
      globalShortcut.unregister(this.hotkey)
      this.bound = false
    }
  }

  private bind(accelerator: string): { ok: boolean; error?: string } {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        const workspaceId = this.resolveTargetWorkspaceId()
        if (workspaceId) this.openCaptureWindow(workspaceId)
      })
      this.bound = registered
      return registered ? { ok: true } : { ok: false, error: 'conflict' }
    } catch (error) {
      this.bound = false
      return { ok: false, error: error instanceof Error ? error.message : 'invalid' }
    }
  }

  private installWindowFocusTracking(): void {
    if (this.trackingInstalled) return
    this.trackingInstalled = true
    for (const window of BrowserWindow.getAllWindows()) {
      this.trackWindow(window)
    }
    app.on('browser-window-created', (_event, window) => this.trackWindow(window))
  }

  private trackWindow(window: BrowserWindow): void {
    window.on('focus', () => this.rememberWindow(window))
  }

  private rememberWindow(window: BrowserWindow): void {
    this.lastFocusedWebContentsId = window.webContents.id
    const workspaceId = this.getWorkspaceForWindow(window.webContents.id)
    if (!workspaceId) return
    this.rememberWorkspace(workspaceId)
  }

  private rememberWorkspace(workspaceId: string): void {
    const index = this.mruWorkspaceIds.indexOf(workspaceId)
    if (index >= 0) this.mruWorkspaceIds.splice(index, 1)
    this.mruWorkspaceIds.unshift(workspaceId)
  }

  private resolveTargetWorkspaceId(): string | null {
    if (this.activeWorkspaceId) {
      return this.activeWorkspaceId
    }

    const focused = BrowserWindow.getFocusedWindow()
    if (focused) {
      const focusedWorkspaceId = this.getWorkspaceForWindow(focused.webContents.id)
      if (focusedWorkspaceId && this.isCaptureEnabled(focusedWorkspaceId)) {
        this.lastFocusedWebContentsId = focused.webContents.id
        this.rememberWorkspace(focusedWorkspaceId)
        return focusedWorkspaceId
      }
    }

    if (this.lastFocusedWebContentsId != null) {
      const lastFocusedWorkspaceId = this.getWorkspaceForWindow(this.lastFocusedWebContentsId)
      if (lastFocusedWorkspaceId && this.isCaptureEnabled(lastFocusedWorkspaceId)) {
        this.rememberWorkspace(lastFocusedWorkspaceId)
        return lastFocusedWorkspaceId
      }
    }

    for (const workspaceId of this.mruWorkspaceIds) {
      if (this.isCaptureEnabled(workspaceId)) return workspaceId
    }

    return this.getWorkspaces().find(workspace => this.isCaptureEnabled(workspace.id))?.id ?? null
  }

  private hasEnabledWorkspace(): boolean {
    return this.getWorkspaces().some(workspace => this.isCaptureEnabled(workspace.id))
  }

  private isCaptureEnabled(workspaceId: string): boolean {
    const workspace = this.getWorkspaces().find(item => item.id === workspaceId)
    if (!workspace?.rootPath) return false
    return loadWorkspaceConfig(workspace.rootPath)?.capture?.enabled === true
  }
}
