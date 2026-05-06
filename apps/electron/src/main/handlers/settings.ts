import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { DEFAULT_CAPTURE_HOTKEY } from '@craft-agent/shared/config/preferences'

let captureHotkeyBinder: ((accelerator: string) => { ok: boolean; error?: string }) | null = null

export function setCaptureHotkeyBinder(binder: ((accelerator: string) => { ok: boolean; error?: string }) | null): void {
  captureHotkeyBinder = binder
}

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.app.GET_CAPTURE_HOTKEY,
  RPC_CHANNELS.app.SET_CAPTURE_HOTKEY,
] as const

// ============================================================
// GUI-only settings (require Electron-specific APIs)
// ============================================================

export function registerSettingsGuiHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Set keep awake while running setting (requires Electron power-manager)
  server.handle(RPC_CHANNELS.power.SET_KEEP_AWAKE, async (_ctx, enabled: boolean) => {
    const { setKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    const { setKeepAwakeSetting } = await import('../power-manager')
    // Save to config
    setKeepAwakeWhileRunning(enabled)
    // Update the power manager's cached value and power state
    setKeepAwakeSetting(enabled)
  })

  // Set network proxy settings (requires Electron session proxy)
  server.handle(RPC_CHANNELS.settings.SET_NETWORK_PROXY, async (_ctx, settings: import('@craft-agent/shared/config/types').NetworkProxySettings) => {
    const { updateConfiguredProxySettings } = await import('../network-proxy')
    await updateConfiguredProxySettings(settings)
  })

  server.handle(RPC_CHANNELS.app.GET_CAPTURE_HOTKEY, async () => {
    const { loadPreferences } = await import('@craft-agent/shared/config/preferences')
    return loadPreferences().captureHotkey ?? DEFAULT_CAPTURE_HOTKEY
  })

  server.handle(RPC_CHANNELS.app.SET_CAPTURE_HOTKEY, async (_ctx, accelerator: string) => {
    const trimmed = accelerator.trim()
    if (!trimmed || !/^[A-Za-z0-9+ -]+$/.test(trimmed)) {
      return { ok: false, error: 'invalid' }
    }

    const bindResult = captureHotkeyBinder?.(trimmed) ?? { ok: true }
    if (!bindResult.ok) {
      server.push(RPC_CHANNELS.app.CAPTURE_HOTKEY_CONFLICT, { to: 'all' }, { accelerator: trimmed, error: bindResult.error ?? 'conflict' })
      return bindResult
    }

    const { loadPreferences, savePreferences } = await import('@craft-agent/shared/config/preferences')
    const prefs = loadPreferences()
    savePreferences({ ...prefs, captureHotkey: trimmed })
    server.push(RPC_CHANNELS.app.CAPTURE_HOTKEY_CHANGED, { to: 'all' }, trimmed)
    return { ok: true }
  })
}
