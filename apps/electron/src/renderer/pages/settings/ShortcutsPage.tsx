/**
 * ShortcutsPage
 *
 * Displays keyboard shortcuts reference from the centralized action registry.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { isMac } from '@/lib/platform'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'
import { toast } from 'sonner'

const DEFAULT_CAPTURE_HOTKEY = 'CommandOrControl+Alt+Space'
const DEFAULT_CAPTURE_AUTOFILL_HOTKEY = 'CommandOrControl+Alt+Shift+Space'

type CaptureShortcutId = 'capture' | 'captureAutofill'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'shortcuts',
}

interface ShortcutItem {
  keys: string[]
  description: string
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutItem[]
}

// Component-specific shortcuts that aren't in the centralized registry
function useComponentSpecificSections(): ShortcutSection[] {
  const { t } = useTranslation()
  return [
    {
      title: t('shortcuts.listNavigation'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('shortcuts.navigateItems') },
        { keys: ['Home'], description: t('shortcuts.goToFirst') },
        { keys: ['End'], description: t('shortcuts.goToLast') },
      ],
    },
    {
      title: t('shortcuts.sessionList'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.focusChatInput') },
        { keys: ['Right-click'], description: t('shortcuts.openContextMenu') },
        { keys: [isMac ? '⌥' : 'Alt', 'Click'], description: t('shortcuts.addFilterExcluded') },
      ],
    },
    {
      title: t('shortcuts.chatInput'),
      shortcuts: [
        { keys: ['Enter'], description: t('shortcuts.sendMessage') },
        { keys: ['Shift', 'Enter'], description: t('shortcuts.newLine') },
        { keys: ['Esc'], description: t('shortcuts.closeDialogBlur') },
      ],
    },
  ]
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-medium font-sans bg-muted border border-border rounded">
      {children}
    </kbd>
  )
}

function formatAcceleratorKeys(accelerator: string): string[] {
  return accelerator.split('+').flatMap(part => {
    if (part === 'CommandOrControl') return [isMac ? '⌘' : 'Ctrl']
    if (part === 'Command') return ['⌘']
    if (part === 'Control' || part === 'Ctrl') return ['Ctrl']
    if (part === 'Alt' || part === 'Option') return [isMac ? '⌥' : 'Alt']
    if (part === 'Shift') return [isMac ? '⇧' : 'Shift']
    if (part === 'Space') return ['Space']
    if (part === 'Escape') return ['Esc']
    if (part === 'ArrowLeft' || part === 'Left') return ['←']
    if (part === 'ArrowRight' || part === 'Right') return ['→']
    if (part === 'ArrowUp' || part === 'Up') return ['↑']
    if (part === 'ArrowDown' || part === 'Down') return ['↓']
    return [part]
  })
}

function keyToAcceleratorPart(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  if (e.key === ' ') return 'Space'
  if (e.key === 'Esc') return 'Escape'
  if (e.key.startsWith('Arrow')) return e.key
  if (/^F\d{1,2}$/.test(e.key)) return e.key
  if (/^[a-zA-Z0-9]$/.test(e.key)) return e.key.toUpperCase()
  if (/^[A-Za-z]+$/.test(e.key)) return e.key
  return null
}

function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = keyToAcceleratorPart(e)
  if (!key) return null

  const modifiers: string[] = []
  if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl')
  if (e.altKey) modifiers.push('Alt')
  if (e.shiftKey) modifiers.push('Shift')

  return [...modifiers, key].join('+')
}

function CaptureShortcutRow({
  id,
  label,
  description,
  value,
  placeholder,
  isRecording,
  isSaving,
  onRecord,
}: {
  id: CaptureShortcutId
  label: string
  description?: string
  value: string
  placeholder: string
  isRecording: boolean
  isSaving: boolean
  onRecord: (id: CaptureShortcutId) => void
}) {
  const { t } = useTranslation()
  const keys = formatAcceleratorKeys(value || placeholder)

  return (
    <SettingsRow label={label} description={description}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {isRecording ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">{t('settings.capture.pressShortcut')}</span>
          ) : (
            keys.map((key, keyIndex) => (
              <Kbd key={keyIndex}>{key}</Kbd>
            ))
          )}
        </div>
        <Button
          type="button"
          variant={isRecording ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => onRecord(id)}
          disabled={isSaving}
          className="min-w-[92px]"
        >
          {isSaving
            ? t('common.saving')
            : isRecording
              ? t('common.cancel')
              : t('settings.capture.recordShortcut')}
        </Button>
      </div>
    </SettingsRow>
  )
}

/**
 * Renders a shortcut row for an action from the registry
 */
// Map action IDs to i18n keys for translated labels
const ACTION_LABEL_KEYS: Partial<Record<ActionId, string>> = {
  'app.newChat': 'shortcuts.action.newChat',
  'app.newChatInPanel': 'shortcuts.action.newChatInPanel',
  'app.settings': 'shortcuts.action.settings',
  'app.toggleTheme': 'shortcuts.action.toggleTheme',
  'app.search': 'shortcuts.action.search',
  'app.keyboardShortcuts': 'shortcuts.action.keyboardShortcuts',
  'app.newWindow': 'shortcuts.action.newWindow',
  'app.quit': 'shortcuts.action.quit',
  'nav.focusSidebar': 'shortcuts.action.focusSidebar',
  'nav.focusNavigator': 'shortcuts.action.focusNavigator',
  'nav.focusChat': 'shortcuts.action.focusChat',
  'nav.nextZone': 'shortcuts.action.focusNextZone',
  'nav.goBack': 'shortcuts.action.goBack',
  'nav.goForward': 'shortcuts.action.goForward',
  'nav.goBackAlt': 'shortcuts.action.goBack',
  'nav.goForwardAlt': 'shortcuts.action.goForward',
  'view.toggleSidebar': 'shortcuts.action.toggleSidebar',
  'view.toggleFocusMode': 'shortcuts.action.toggleFocusMode',
  'navigator.selectAll': 'shortcuts.action.selectAll',
  'navigator.clearSelection': 'shortcuts.action.clearSelection',
  'panel.focusNext': 'shortcuts.action.focusNextPanel',
  'panel.focusPrev': 'shortcuts.action.focusPrevPanel',
  'chat.stopProcessing': 'shortcuts.action.stopProcessing',
  'chat.cyclePermissionMode': 'shortcuts.action.cyclePermissionMode',
  'chat.nextSearchMatch': 'shortcuts.action.nextSearchMatch',
  'chat.prevSearchMatch': 'shortcuts.action.prevSearchMatch',
}

function ActionShortcutRow({ actionId }: { actionId: ActionId }) {
  const { t } = useTranslation()
  const { label, hotkey } = useActionLabel(actionId)

  if (!hotkey) return null

  // Split hotkey into individual keys for display
  // Mac: symbols are concatenated (⌘⇧N) - need smart splitting
  // Windows: separated by + (Ctrl+Shift+N) - split on +
  const keys = isMac
    ? hotkey.match(/[⌘⇧⌥←→]|Tab|Esc|./g) || []
    : hotkey.split('+')

  return (
    <SettingsRow label={ACTION_LABEL_KEYS[actionId] ? t(ACTION_LABEL_KEYS[actionId]!) : label}>
      <div className="flex items-center gap-1">
        {keys.map((key, keyIndex) => (
          <Kbd key={keyIndex}>{key}</Kbd>
        ))}
      </div>
    </SettingsRow>
  )
}

export default function ShortcutsPage() {
  const { t } = useTranslation()
  const componentSpecificSections = useComponentSpecificSections()
  const [captureHotkey, setCaptureHotkey] = React.useState(DEFAULT_CAPTURE_HOTKEY)
  const [captureAutofillHotkey, setCaptureAutofillHotkey] = React.useState(DEFAULT_CAPTURE_AUTOFILL_HOTKEY)
  const [recordingShortcut, setRecordingShortcut] = React.useState<CaptureShortcutId | null>(null)
  const [savingShortcut, setSavingShortcut] = React.useState<CaptureShortcutId | null>(null)

  const loadCaptureShortcuts = React.useCallback(async () => {
    const [captureAccelerator, captureAutofillAccelerator] = await Promise.all([
      window.electronAPI.getCaptureHotkey(),
      window.electronAPI.getCaptureAutofillHotkey(),
    ])
    setCaptureHotkey(captureAccelerator)
    setCaptureAutofillHotkey(captureAutofillAccelerator)
  }, [])

  React.useEffect(() => {
    loadCaptureShortcuts().catch(error => {
      console.error('Failed to load capture shortcuts:', error)
    })
  }, [loadCaptureShortcuts])

  React.useEffect(() => {
    const cleanupChanged = window.electronAPI.onCaptureHotkeyChanged?.((accelerator) => {
      setCaptureHotkey(accelerator)
    })
    const cleanupAutofillChanged = window.electronAPI.onCaptureAutofillHotkeyChanged?.((accelerator) => {
      setCaptureAutofillHotkey(accelerator)
    })
    return () => {
      cleanupChanged?.()
      cleanupAutofillChanged?.()
    }
  }, [])

  const saveCaptureShortcut = React.useCallback(async (id: CaptureShortcutId, accelerator: string) => {
    setSavingShortcut(id)
    try {
      const result = id === 'capture'
        ? await window.electronAPI.setCaptureHotkey(accelerator)
        : await window.electronAPI.setCaptureAutofillHotkey(accelerator)

      if (!result.ok) {
        toast.error(
          id === 'capture'
            ? t('settings.capture.hotkeyFailed')
            : t('settings.capture.autofillHotkeyFailed'),
          { description: result.error }
        )
      }

      const persisted = id === 'capture'
        ? await window.electronAPI.getCaptureHotkey()
        : await window.electronAPI.getCaptureAutofillHotkey()

      if (id === 'capture') {
        setCaptureHotkey(persisted)
      } else {
        setCaptureAutofillHotkey(persisted)
      }
    } finally {
      setSavingShortcut(null)
      setRecordingShortcut(null)
    }
  }, [t])

  React.useEffect(() => {
    if (!recordingShortcut) return
    document.body.dataset.hotkeyRecording = 'true'

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecordingShortcut(null)
        return
      }

      const accelerator = eventToAccelerator(event)
      if (!accelerator) return

      void saveCaptureShortcut(recordingShortcut, accelerator)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      delete document.body.dataset.hotkeyRecording
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [recordingShortcut, saveCaptureShortcut])

  const handleRecordShortcut = React.useCallback((id: CaptureShortcutId) => {
    setRecordingShortcut(current => current === id ? null : id)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.shortcuts.title")} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            <SettingsSection title={t('settings.capture.shortcuts')}>
              <SettingsCard>
                <CaptureShortcutRow
                  id="capture"
                  label={t('settings.capture.hotkey')}
                  value={captureHotkey}
                  placeholder={DEFAULT_CAPTURE_HOTKEY}
                  isRecording={recordingShortcut === 'capture'}
                  isSaving={savingShortcut === 'capture'}
                  onRecord={handleRecordShortcut}
                />
                <CaptureShortcutRow
                  id="captureAutofill"
                  label={t('settings.capture.autofillHotkey')}
                  description={t('settings.capture.autofillHotkeyDesc')}
                  value={captureAutofillHotkey}
                  placeholder={DEFAULT_CAPTURE_AUTOFILL_HOTKEY}
                  isRecording={recordingShortcut === 'captureAutofill'}
                  isSaving={savingShortcut === 'captureAutofill'}
                  onRecord={handleRecordShortcut}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Registry-driven sections */}
            {Object.entries(actionsByCategory).map(([category, actions]) => (
              <SettingsSection key={category} title={t(`shortcuts.category.${category.toLowerCase()}`)}>
                <SettingsCard>
                  {actions.map(action => (
                    <ActionShortcutRow key={action.id} actionId={action.id as ActionId} />
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}

            {/* Component-specific sections */}
            {componentSpecificSections.map((section) => (
              <SettingsSection key={section.title} title={section.title}>
                <SettingsCard>
                  {section.shortcuts.map((shortcut, index) => (
                    <SettingsRow key={index} label={shortcut.description}>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <Kbd key={keyIndex}>{key}</Kbd>
                        ))}
                      </div>
                    </SettingsRow>
                  ))}
                </SettingsCard>
              </SettingsSection>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
