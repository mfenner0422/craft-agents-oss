import { Menu, Tray, app } from 'electron'
import { buildCalendarIcon } from './calendar-icon'
import { TrayPopoverWindow } from './popover-window'

export interface DaysTrayOptions {
  getActiveWorkspaceId: () => string | null
  getDetachedAlwaysOnTop: () => boolean
  setDetachedAlwaysOnTop: (enabled: boolean) => void
  openDays: (workspaceId: string | null) => void
  onPopoverOpenedFromHiddenApp?: () => void
}

export class DaysTray {
  private tray: Tray | null = null
  private popover: TrayPopoverWindow
  private midnightTimeout: NodeJS.Timeout | null = null
  private currentDayOfMonth = -1

  constructor(private readonly options: DaysTrayOptions) {
    this.popover = new TrayPopoverWindow({
      getDetachedAlwaysOnTop: this.options.getDetachedAlwaysOnTop,
    })
  }

  start(): void {
    if (this.tray) return

    this.tray = new Tray(buildCalendarIcon(new Date().getDate()))
    this.tray.setToolTip('Days')
    this.currentDayOfMonth = new Date().getDate()

    this.tray.on('click', () => {
      const wasAppHidden = app.isHidden()
      const bounds = this.tray?.getBounds()
      if (!bounds) return
      if (wasAppHidden) {
        this.options.onPopoverOpenedFromHiddenApp?.()
      }
      this.popover.toggleAtTrayBounds(this.options.getActiveWorkspaceId(), bounds, {
        focusOnShow: true,
      })
    })
    this.tray.on('right-click', () => {
      this.tray?.popUpContextMenu(this.buildContextMenu())
    })

    this.scheduleMidnightRefresh()
  }

  stop(): void {
    if (this.midnightTimeout) {
      clearTimeout(this.midnightTimeout)
      this.midnightTimeout = null
    }
    this.popover.destroy()
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  refreshIcon(): void {
    if (!this.tray) return
    const dayOfMonth = new Date().getDate()
    if (dayOfMonth === this.currentDayOfMonth) return
    this.currentDayOfMonth = dayOfMonth
    this.tray.setImage(buildCalendarIcon(dayOfMonth))
  }

  notifyDetachedAlwaysOnTopChanged(): void {
    this.popover.applyDetachedAlwaysOnTopPreference()
  }

  closePopoverFromRenderer(): void {
    this.popover.closeFromRenderer()
  }

  dragPopoverBy(senderWebContentsId: number, deltaX: number, deltaY: number): void {
    this.popover.dragBy(senderWebContentsId, deltaX, deltaY)
  }

  showPopoverContextMenu(): void {
    this.tray?.popUpContextMenu(this.buildContextMenu())
  }

  private buildContextMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: 'Open Days',
        click: () => this.options.openDays(this.options.getActiveWorkspaceId()),
      },
      { type: 'separator' },
      {
        label: 'Detached: Always on top',
        type: 'checkbox',
        checked: this.options.getDetachedAlwaysOnTop(),
        click: (item) => {
          this.options.setDetachedAlwaysOnTop(item.checked)
          this.popover.applyDetachedAlwaysOnTopPreference()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => app.quit(),
      },
    ])
  }

  private scheduleMidnightRefresh(): void {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30)
    const delay = Math.max(60_000, nextMidnight.getTime() - now.getTime())
    this.midnightTimeout = setTimeout(() => {
      this.refreshIcon()
      this.scheduleMidnightRefresh()
    }, delay)
  }
}
