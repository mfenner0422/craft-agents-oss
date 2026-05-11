import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export interface CapturePrefill {
  url?: string
  title?: string
  body?: string
}

let captureWindow: BrowserWindow | null = null
let openedFromAppWindow = false

export function openCaptureWindow(workspaceId: string, prefill?: CapturePrefill): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    if (!prefill) {
      captureWindow.close()
      return
    }
    captureWindow.loadURL(buildCaptureUrl(workspaceId, prefill))
    showCaptureWindow()
    return
  }

  openedFromAppWindow = BrowserWindow.getFocusedWindow() !== null
  captureWindow = new BrowserWindow({
    width: 480,
    height: 268,
    minWidth: 420,
    minHeight: 268,
    title: 'Capture',
    show: false,
    frame: false,
    useContentSize: true,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, 'bootstrap-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  captureWindow.once('ready-to-show', () => {
    showCaptureWindow()
  })
  captureWindow.on('closed', () => {
    captureWindow = null
    if (process.platform === 'darwin' && !openedFromAppWindow) {
      app.hide()
    }
    openedFromAppWindow = false
  })
  captureWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  void captureWindow.loadURL(buildCaptureUrl(workspaceId, prefill))
}

function showCaptureWindow(): void {
  if (!captureWindow || captureWindow.isDestroyed()) return

  captureWindow.show()
  keepMainWindowsHiddenIfNeeded()
  captureWindow.focus()
  captureWindow.webContents.focus()
}

function keepMainWindowsHiddenIfNeeded(): void {
  if (openedFromAppWindow) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (window !== captureWindow && !window.isDestroyed()) {
      window.hide()
    }
  }
}

function buildCaptureUrl(workspaceId: string, prefill?: CapturePrefill): string {
  const params = new URLSearchParams({ workspaceId })
  if (prefill?.url) params.set('url', prefill.url)
  if (prefill?.title) params.set('title', prefill.title)
  if (prefill?.body) params.set('body', prefill.body)
  const query = params.toString()
  if (VITE_DEV_SERVER_URL) return `${VITE_DEV_SERVER_URL}/capture.html?${query}`
  return `file://${join(__dirname, 'renderer/capture.html')}?${query}`
}
