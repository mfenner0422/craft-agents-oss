import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export interface CapturePrefill {
  url?: string
  title?: string
  body?: string
}

let captureWindow: BrowserWindow | null = null

export function openCaptureWindow(workspaceId: string, prefill?: CapturePrefill): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.loadURL(buildCaptureUrl(workspaceId, prefill))
    captureWindow.show()
    captureWindow.focus()
    return
  }

  captureWindow = new BrowserWindow({
    width: 480,
    height: 320,
    minWidth: 420,
    minHeight: 280,
    title: 'Capture',
    show: false,
    frame: false,
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
    captureWindow?.show()
    captureWindow?.focus()
  })
  captureWindow.on('closed', () => {
    captureWindow = null
  })
  captureWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  void captureWindow.loadURL(buildCaptureUrl(workspaceId, prefill))
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
