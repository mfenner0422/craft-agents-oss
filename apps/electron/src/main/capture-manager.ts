import { globalShortcut } from 'electron'
import { mainLog } from './logger'

export interface CaptureManagerOptions {
  initialHotkey: string
  onCapture?: () => void
}

export class CaptureManager {
  private hotkey: string
  private readonly onCapture?: () => void

  constructor(options: CaptureManagerOptions) {
    this.hotkey = options.initialHotkey
    this.onCapture = options.onCapture
  }

  start(): void {
    const result = this.bind(this.hotkey)
    if (!result.ok) {
      mainLog.warn('[capture] Failed to register capture hotkey:', result.error)
    }
  }

  setHotkey(accelerator: string): { ok: boolean; error?: string } {
    const previous = this.hotkey
    globalShortcut.unregister(previous)
    const result = this.bind(accelerator)
    if (!result.ok) {
      this.bind(previous)
      return result
    }
    this.hotkey = accelerator
    return { ok: true }
  }

  refreshTargetWorkspaces(): void {
    // Capture workspace targeting is added with the full capture window workflow.
  }

  dispose(): void {
    globalShortcut.unregister(this.hotkey)
  }

  private bind(accelerator: string): { ok: boolean; error?: string } {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        this.onCapture?.()
      })
      return registered ? { ok: true } : { ok: false, error: 'conflict' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'invalid' }
    }
  }
}
