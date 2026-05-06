import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const POPOVER_WIDTH = 360
const POPOVER_HEIGHT = 480
const DETACH_THRESHOLD_PX = 40

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
  private blurHandler: (() => void) | null = null
  private moveHandler: (() => void) | null = null

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

  toggleAtTrayBounds(workspaceId: string | null, trayBounds: Rectangle): void {
    if (this.isVisible() && this.mode === 'anchored') {
      this.hide()
      return
    }
    this.showAnchored(workspaceId, trayBounds)
  }

  showAnchored(workspaceId: string | null, trayBounds: Rectangle): void {
    this.ensureWindow(workspaceId)
    if (!this.window) return

    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    const targetX = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2)
    const targetY = trayBounds.y + trayBounds.height + 4
    const clampedX = Math.max(display.workArea.x + 4, Math.min(targetX, display.workArea.x + display.workArea.width - POPOVER_WIDTH - 4))

    this.anchoredOriginX = clampedX
    this.anchoredOriginY = targetY
    this.applyMode('anchored')
    this.window.setBounds({ x: clampedX, y: targetY, width: POPOVER_WIDTH, height: POPOVER_HEIGHT })
    this.window.show()
    this.window.focus()
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
    this.hide()
    if (this.mode === 'detached') {
      this.applyMode('anchored')
    }
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
      this.window.loadURL(buildUrl(workspaceId))
      return
    }

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
      if (this.mode !== 'anchored') return
      const bounds = this.window.getBounds()
      const dx = Math.abs(bounds.x - this.anchoredOriginX)
      const dy = Math.abs(bounds.y - this.anchoredOriginY)
      if (dx + dy >= DETACH_THRESHOLD_PX) {
        this.applyMode('detached')
      }
    }

    this.window.on('blur', blurHandler)
    this.window.on('move', moveHandler)
    this.blurHandler = blurHandler
    this.moveHandler = moveHandler
  }

  private detachListeners(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.blurHandler = null
      this.moveHandler = null
      return
    }
    if (this.blurHandler) this.window.removeListener('blur', this.blurHandler)
    if (this.moveHandler) this.window.removeListener('move', this.moveHandler)
    this.blurHandler = null
    this.moveHandler = null
  }

  private applyMode(mode: PopoverMode): void {
    if (mode === this.mode) return
    this.mode = mode
    if (!this.window || this.window.isDestroyed()) return

    if (mode === 'detached') {
      this.window.setAlwaysOnTop(this.options.getDetachedAlwaysOnTop(), 'floating')
      this.window.setVisibleOnAllWorkspaces(false)
    } else {
      this.window.setAlwaysOnTop(true, 'pop-up-menu')
    }

    this.window.webContents.send('daysTray:mode', mode)
    this.options.onModeChange?.(mode)
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
