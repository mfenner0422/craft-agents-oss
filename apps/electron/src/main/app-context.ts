import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mainLog } from './logger'

const execFileAsync = promisify(execFile)

export interface AutofillContext {
  url?: string
  title?: string
  appName?: string
}

const loggedFailures = new Set<string>()

function logOnce(category: string, detail: string): void {
  if (loggedFailures.has(category)) return
  loggedFailures.add(category)
  mainLog.warn(`[autofill] ${category}: ${detail}`)
}

export const FRONTMOST_BROWSER_CONTEXT_JXA = `
(() => {
  const SystemEvents = Application('System Events')
  const currentApp = Application.currentApplication()
  currentApp.includeStandardAdditions = true
  const procs = SystemEvents.processes.whose({ frontmost: true })
  if (!procs || procs.length === 0) return JSON.stringify(null)
  const proc = procs[0]
  const bundleId = proc.bundleIdentifier()
  const appName = proc.name()

  const tryRead = (fn) => { try { return fn() } catch (_) { return undefined } }
  const looksLikeUrl = (value) => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(value)
  const readZenLocationBar = () => {
    const previousClipboard = tryRead(() => currentApp.theClipboard())
    const hadTextClipboard = typeof previousClipboard === 'string'
    try {
      const frontWindowTitle = tryRead(() => proc.windows[0].name())
      SystemEvents.keystroke('l', { using: 'command down' })
      delay(0.1)
      SystemEvents.keystroke('c', { using: 'command down' })
      delay(0.1)
      const copied = tryRead(() => currentApp.theClipboard())
      return {
        url: looksLikeUrl(copied) ? copied : undefined,
        title: frontWindowTitle,
      }
    } finally {
      if (hadTextClipboard) tryRead(() => currentApp.setTheClipboardTo(previousClipboard))
    }
  }

  let url, title
  switch (bundleId) {
    case 'com.apple.Safari': {
      const app = Application('Safari')
      url = tryRead(() => app.documents[0].url())
      title = tryRead(() => app.documents[0].name())
      break
    }
    case 'com.google.Chrome': {
      const app = Application('Google Chrome')
      url = tryRead(() => app.windows[0].activeTab.url())
      title = tryRead(() => app.windows[0].activeTab.title())
      break
    }
    case 'company.thebrowser.Browser': {
      const app = Application('Arc')
      url = tryRead(() => app.windows[0].activeTab.url())
      title = tryRead(() => app.windows[0].activeTab.title())
      break
    }
    case 'com.brave.Browser': {
      const app = Application('Brave Browser')
      url = tryRead(() => app.windows[0].activeTab.url())
      title = tryRead(() => app.windows[0].activeTab.title())
      break
    }
    case 'com.microsoft.edgemac': {
      const app = Application('Microsoft Edge')
      url = tryRead(() => app.windows[0].activeTab.url())
      title = tryRead(() => app.windows[0].activeTab.title())
      break
    }
    case 'app.zen-browser.zen': {
      const app = Application('Zen')
      url = tryRead(() => app.windows[0].activeTab.url())
      title = tryRead(() => app.windows[0].activeTab.title())
      if (!url && !title) {
        const fallback = readZenLocationBar()
        url = fallback.url
        title = fallback.title
      }
      break
    }
    default:
      return JSON.stringify(null)
  }

  if (!url && !title) return JSON.stringify(null)
  return JSON.stringify({ url, title, appName })
})()
`

export async function getFrontmostBrowserContext(timeoutMs: number = 1500): Promise<AutofillContext | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', FRONTMOST_BROWSER_CONTEXT_JXA], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
    })
    const trimmed = stdout.trim()
    if (!trimmed || trimmed === 'null') return null
    const parsed = JSON.parse(trimmed) as AutofillContext | null
    return parsed
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { signal?: string; stderr?: string }
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      logOnce('timeout', `JXA exceeded ${timeoutMs}ms`)
      return null
    }
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    if (stderr.includes('Not authorized') || stderr.includes('-1743')) {
      logOnce('permissionDenied', 'Apple Events permission denied — grant Automation access in System Settings')
      return null
    }
    logOnce('parseError', err.message ?? String(error))
    return null
  }
}
