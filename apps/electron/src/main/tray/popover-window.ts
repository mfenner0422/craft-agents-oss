import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { shouldReloadPopoverWorkspace } from './popover-workspace'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const POPOVER_WIDTH = 360
const POPOVER_HEIGHT = 480
const DETACH_THRESHOLD_PX = 40
const MAX_DRAG_DELTA_PX = 200

export type PopoverMode = 'anchored' | 'detached'

export interface PopoverOptions {
  getDetachedAlwaysOnTop: () => boolean
  onModeChange?: (mode: PopoverMode) => void
}

export class TrayPopoverWindow {
  private window: BrowserWindow | null = null
  private mode: PopoverMode = 'anchored'
  private anchoredOriginX = 0
  private anchoredOriginY = 0
  private workspaceId: string | null = null
  private blurHandler: (() => void) | null = null
  private moveHandler: (() => void) | null = null
  private movedHandler: (() => void) | null = null
  private detachPending: boolean = false

  constructor(private readonly options: PopoverOptions) {}

  isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  isAnchored(): boolean {
    return this.mode === 'anchored'
  }

  hide(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.hide()
  }

  dragBy(senderWebContentsId: number, deltaX: number, deltaY: number): void {
    if (!this.window || this.window.isDestroyed()) return
    if (this.window.webContents.id !== senderWebContentsId) return
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return
    if (Math.abs(deltaX) > MAX_DRAG_DELTA_PX || Math.abs(deltaY) > MAX_DRAG_DELTA_PX) return

    const bounds = this.window.getBounds()
    this.window.setPosition(Math.round(bounds.x + deltaX), Math.round(bounds.y + deltaY), false)
  }

  toggleAtTrayBounds(workspaceId: string | null, trayBounds: Rectangle, options: { focusOnShow?: boolean } = {}): void {
    if (this.isVisible() && this.mode === 'anchored') {
      this.hide()
      return
    }
    this.showAnchored(workspaceId, trayBounds, options)
  }

  showAnchored(workspaceId: string | null, trayBounds: Rectangle, options: { focusOnShow?: boolean } = {}): void {
    this.ensureWindow(workspaceId)
    if (!this.window) return

    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    const targetX = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2)
    const targetY = trayBounds.y + trayBounds.height + 4
    const clampedX = Math.max(display.workArea.x + 4, Math.min(targetX, display.workArea.x + display.workArea.width - POPOVER_WIDTH - 4))

    this.anchoredOriginX = clampedX
    this.anchoredOriginY = targetY
    this.applyMode('anchored', { forceNotify: true })
    this.window.setBounds({ x: clampedX, y: targetY, width: POPOVER_WIDTH, height: POPOVER_HEIGHT })
    this.window.setMovable(true)
    this.window.setFocusable(options.focusOnShow ?? true)
    this.window.showInactive()
    if (options.focusOnShow ?? true) {
      this.window.focus()
    }
  }

  detach(): void {
    if (this.mode === 'detached') return
    this.applyMode('detached')
  }

  applyDetachedAlwaysOnTopPreference(): void {
    if (this.mode !== 'detached' || !this.window || this.window.isDestroyed()) return
    this.window.setAlwaysOnTop(this.options.getDetachedAlwaysOnTop(), 'floating')
  }

  closeFromRenderer(): void {
    if (this.mode === 'detached') {
      // Reset while visible so Chromium recalculates the header's native
      // app-region before the same BrowserWindow is shown from the menubar.
      this.applyMode('anchored')
    }
    this.hide()
  }

  destroy(): void {
    this.detachListeners()
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private ensureWindow(workspaceId: string | null): void {
    if (this.window && !this.window.isDestroyed()) {
      if (shouldReloadPopoverWorkspace(this.workspaceId, workspaceId)) {
        this.workspaceId = workspaceId
        void this.window.loadURL(buildUrl(workspaceId))
      }
      return
    }

    this.workspaceId = workspaceId
    this.window = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: true,
      title: 'Days',
      backgroundColor: '#00000000',
      transparent: false,
      webPreferences: {
        preload: join(__dirname, 'bootstrap-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    this.window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    this.window.on('closed', () => {
      this.detachListeners()
      this.window = null
    })

    void this.window.loadURL(buildUrl(workspaceId))
    this.attachListeners()
  }

  private attachListeners(): void {
    if (!this.window) return
    this.detachListeners()

    const blurHandler = () => {
      if (this.mode === 'anchored') this.hide()
    }
    const moveHandler = () => {
      if (!this.window || this.window.isDestroyed()) return
      const bounds = this.window.getBounds()
      if (this.mode !== 'anchored') return
      const dx = Math.abs(bounds.x - this.anchoredOriginX)
      const dy = Math.abs(bounds.y - this.anchoredOriginY)
      if (dx + dy >= DETACH_THRESHOLD_PX) {
        // Do not notify the renderer or mutate NSWindow chrome while macOS is
        // using the header's app-region as the active drag source.
        this.detachPending = true
      }
    }
    const movedHandler = () => {
      if (!this.detachPending) return
      this.detachPending = false
      setTimeout(() => {
        if (!this.window || this.window.isDestroyed()) return
        if (this.mode !== 'anchored') {
          return
        }
        this.applyMode('detached')
      }, 0)
    }
    this.window.on('blur', blurHandler)
    this.window.on('move', moveHandler)
    this.window.on('moved', movedHandler)
    this.blurHandler = blurHandler
    this.moveHandler = moveHandler
    this.movedHandler = movedHandler
  }

  private detachListeners(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.blurHandler = null
      this.moveHandler = null
      this.movedHandler = null
      this.detachPending = false
      return
    }
    if (this.blurHandler) this.window.removeListener('blur', this.blurHandler)
    if (this.moveHandler) this.window.removeListener('move', this.moveHandler)
    if (this.movedHandler) this.window.removeListener('moved', this.movedHandler)
    this.blurHandler = null
    this.moveHandler = null
    this.movedHandler = null
    this.detachPending = false
  }

  private applyMode(mode: PopoverMode, options: { forceNotify?: boolean } = {}): void {
    if (mode === this.mode && !options.forceNotify) return
    this.mode = mode
    if (!this.window || this.window.isDestroyed()) return

    this.applyWindowChrome(mode)
    this.window.webContents.send('daysTray:mode', mode)
    this.options.onModeChange?.(mode)
  }

  private applyWindowChrome(mode: PopoverMode): void {
    if (!this.window || this.window.isDestroyed()) return
    if (mode === 'detached') {
      this.window.setAlwaysOnTop(this.options.getDetachedAlwaysOnTop(), 'floating')
      this.window.setVisibleOnAllWorkspaces(false)
    } else {
      this.window.setAlwaysOnTop(true, 'pop-up-menu')
    }
    this.window.setMovable(true)
  }
}

function buildUrl(workspaceId: string | null): string {
  const params = new URLSearchParams()
  if (workspaceId) params.set('workspaceId', workspaceId)
  const query = params.toString()
  if (VITE_DEV_SERVER_URL) {
    return `${VITE_DEV_SERVER_URL}/days-tray.html${query ? `?${query}` : ''}`
  }
  return `file://${join(__dirname, 'renderer/days-tray.html')}${query ? `?${query}` : ''}`
}
