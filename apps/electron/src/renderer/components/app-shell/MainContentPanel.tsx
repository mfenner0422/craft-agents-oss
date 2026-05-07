/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Panel } from './Panel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  useNavigationState,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isCaptureNavigation,
  isDaysNavigation,
  isTasksNavigation,
} from '@/contexts/NavigationContext'
import CaptureInfoPage from '@/pages/CaptureInfoPage'
import type { CaptureItem } from '@craft-agent/shared/capture'
import { DaysMainPane, type TaskBoardActions, type TaskListKey } from '@craft-agent/ui/days'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import { navigate, routes } from '@/lib/navigate'
import type { DayFileKind, DayRecord, DayTask, DaysBoardRecord, DayTaskStatus } from '@craft-agent/shared/days'
import type { TaskListKind, TaskRecord } from '@craft-agent/shared/tasks'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { SourceInfoPage, ChatPage, TasksPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { AutomationInfoPage } from '../automations/AutomationInfoPage'
import type { ExecutionEntry } from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { TriageView } from '../days/TriageView'
import * as storage from '@/lib/local-storage'

export interface MainContentPanelProps {
  /** Whether both sidebar and navigator are hidden (focus mode / CMD+.) */
  isSidebarAndNavigatorHidden?: boolean
  /** Optional className for the container */
  className?: string
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    onSessionStatusChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
    onTestAutomation,
    onToggleAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    onReplayAutomation,
    automationTestResults,
    getAutomationHistory,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)
  const [captureItems, setCaptureItems] = useState<CaptureItem[]>([])
  const [day, setDay] = useState<DaysBoardRecord | null>(null)
  const [isDayPlaceholder, setIsDayPlaceholder] = useState(false)
  const [carryForwardTasks, setCarryForwardTasks] = useState<DayTask[]>([])

  // Execution history for the selected automation
  const selectedAutomationId = isAutomationsNavigation(navState) ? navState.details?.automationId : undefined
  const [executions, setExecutions] = useState<ExecutionEntry[]>([])

  useEffect(() => {
    if (!selectedAutomationId || !getAutomationHistory) {
      setExecutions([])
      return
    }
    let stale = false

    // Initial fetch
    getAutomationHistory(selectedAutomationId).then(entries => {
      if (!stale) setExecutions(entries)
    })

    // Re-fetch on automation changes (live updates when automations fire)
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      if (!stale) {
        getAutomationHistory(selectedAutomationId).then(entries => {
          if (!stale) setExecutions(entries)
        })
      }
    })

    return () => { stale = true; cleanup() }
  }, [selectedAutomationId, getAutomationHistory])

  useEffect(() => {
    if (!activeWorkspaceId || !isCaptureNavigation(navState)) return
    window.electronAPI.listCaptureInbox(activeWorkspaceId).then(setCaptureItems).catch(() => setCaptureItems([]))
  }, [activeWorkspaceId, navState])

  useEffect(() => {
    if (!activeWorkspaceId) return
    return window.electronAPI.onCaptureSaved((payload) => {
      if (payload.workspaceId !== activeWorkspaceId) return
      window.electronAPI.listCaptureInbox(activeWorkspaceId)
        .then(setCaptureItems)
        .catch(() => {
          setCaptureItems(prev => {
            const withoutSaved = prev.filter(item => item.id !== payload.item.id)
            return [payload.item, ...withoutSaved]
          })
        })
    })
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!activeWorkspaceId || !isDaysNavigation(navState)) return
    if (!navState.details) {
      const today = todayDateISO()
      if (storage.get<string | null>(storage.KEYS.lastTriageShown, null, activeWorkspaceId) !== today) {
        storage.set(storage.KEYS.lastTriageShown, today, activeWorkspaceId)
        navigate(routes.view.daysTriage())
        return
      }
    }
    if (navState.details?.type === 'triage') return
    const dateISO = navState.details?.type === 'day' ? navState.details.id : todayDateISO()
    loadDaysBoard(activeWorkspaceId, dateISO).then(record => {
      if (record) {
        setDay(record)
        setIsDayPlaceholder(false)
      } else {
        // Day doesn't exist on disk yet — show in-memory default templates
        setDay(defaultDayRecord(dateISO))
        setIsDayPlaceholder(true)
      }
    }).catch(() => {
      setDay(defaultDayRecord(dateISO))
      setIsDayPlaceholder(true)
    })
    window.electronAPI.getIncompleteDayTasks(activeWorkspaceId, addDays(dateISO, -1)).then(setCarryForwardTasks).catch(() => setCarryForwardTasks([]))
  }, [activeWorkspaceId, navState])

  const handlePullForwardDayTasks = useCallback(async () => {
    if (!activeWorkspaceId || !day) return
    await window.electronAPI.pullForwardDayTasks(activeWorkspaceId, addDays(day.dateISO, -1), day.dateISO)
    setDay(await loadDaysBoard(activeWorkspaceId, day.dateISO))
    setCarryForwardTasks([])
  }, [activeWorkspaceId, day])

  const handleUpdateDayFile = useCallback(async (kind: DayFileKind, content: string) => {
    if (!activeWorkspaceId || !day) return
    if (isDayPlaceholder) {
      // First write to a placeholder day: create the vault page on disk, then update the file
      await window.electronAPI.ensureDay(activeWorkspaceId, day.dateISO)
      setIsDayPlaceholder(false)
    }
    await window.electronAPI.updateDayFile(activeWorkspaceId, day.dateISO, kind, content)
    setDay(await loadDaysBoard(activeWorkspaceId, day.dateISO))
  }, [activeWorkspaceId, day, isDayPlaceholder])

  const ensureDayPersisted = useCallback(async () => {
    if (!activeWorkspaceId || !day) return
    if (isDayPlaceholder) {
      await window.electronAPI.ensureDay(activeWorkspaceId, day.dateISO)
      setIsDayPlaceholder(false)
    }
  }, [activeWorkspaceId, day, isDayPlaceholder])

  const daysActions = useMemo<TaskBoardActions>(() => ({
    async add(list: TaskListKey) {
      if (!activeWorkspaceId || !day) return null
      await ensureDayPersisted()
      const dayISO = day.dateISO
      const placement = list === 'today'
        ? { day: dayISO, list: null }
        : { day: null, list: list as TaskListKind }
      const created = await window.electronAPI.createTask(activeWorkspaceId, {
        title: '',
        status: 'todo',
        ...placement,
      })
      return taskRecordToDayTask(created)
    },
    async updateTitle(id: string, title: string) {
      if (!activeWorkspaceId) return
      // Treat empty title save as drop — keeps the renderer's "blur empty title" flow tidy.
      if (!title.trim()) {
        await window.electronAPI.promoteTask(activeWorkspaceId, id, { kind: 'drop' })
        return
      }
      await window.electronAPI.updateTask(activeWorkspaceId, id, { title })
    },
    async setStatus(id: string, status: DayTaskStatus) {
      if (!activeWorkspaceId) return
      await window.electronAPI.updateTask(activeWorkspaceId, id, { status })
    },
    async moveToList(id: string, list: TaskListKind) {
      if (!activeWorkspaceId) return
      await window.electronAPI.promoteTask(activeWorkspaceId, id, { kind: list })
    },
    async moveToDate(id: string, dateISO: string) {
      if (!activeWorkspaceId) return
      await window.electronAPI.moveDayTask(activeWorkspaceId, id, { kind: 'day', dateISO })
    },
    async remove(id: string) {
      if (!activeWorkspaceId) return
      await window.electronAPI.promoteTask(activeWorkspaceId, id, { kind: 'drop' })
    },
    async reorderList(list: TaskListKey, orderedIds: string[]) {
      if (!activeWorkspaceId || !day) return
      await ensureDayPersisted()
      await window.electronAPI.updateDayTaskLists(activeWorkspaceId, day.dateISO, { [list]: orderedIds })
    },
    async setDue(id: string, due: string | null) {
      if (!activeWorkspaceId) return
      await window.electronAPI.updateTask(activeWorkspaceId, id, due === null ? { due: undefined } : { due })
    },
  }), [activeWorkspaceId, day, ensureDayPersisted])

  // Reconcile day state when the server pushes task changes (other windows, watcher, etc.).
  useEffect(() => {
    if (!activeWorkspaceId || !isDaysNavigation(navState)) return
    if (navState.details?.type !== 'day' && !navState.details) return
    return window.electronAPI.onTasksChanged?.((payload) => {
      if (payload.workspaceId !== activeWorkspaceId) return
      if (!day) return
      // Reload if the changed task's day matches what we're viewing, or if the
      // task no longer has a day (likely demoted to next/someday from this day).
      if (payload.task.day === day.dateISO || (payload.task.day == null && day.tasks.today.some(t => t.id === payload.task.id))) {
        loadDaysBoard(activeWorkspaceId, day.dateISO).then(record => { if (record) setDay(record) }).catch(() => {})
      }
    })
  }, [activeWorkspaceId, navState, day])

  /** Default in-memory day record for placeholder dates (not yet on disk) */
  function defaultDayRecord(dateISO: string): DaysBoardRecord {
    return {
      dateISO,
      files: {
        tasks: '# Today\n',
        scratch: '# Scratch\n',
        journal: '# Journal\n',
      },
      bodies: {
        tasks: '',
        scratch: '',
        journal: '',
      },
      tasks: {
        today: [],
        next: [],
        someday: [],
      },
    }
  }

  async function loadDaysBoard(workspaceId: string, dateISO: string): Promise<DaysBoardRecord | null> {
    if (window.electronAPI.isChannelAvailable('days:getBoard')) {
      try {
        return await window.electronAPI.getDaysBoard(workspaceId, dateISO)
      } catch {
        // Running app may still have an older main/server process during hot reload.
      }
    }
    const record = await window.electronAPI.getDay(workspaceId, dateISO)
    return record ? dayRecordToBoard(record) : null
  }

  function dayRecordToBoard(record: DayRecord): DaysBoardRecord {
    const bodies = record.bodies ?? {
      tasks: stripManagedTitle(record.files.tasks),
      scratch: stripManagedTitle(record.files.scratch),
      journal: stripManagedTitle(record.files.journal),
    }
    return {
      ...record,
      bodies,
      tasks: {
        today: parseFallbackTaskList(bodies.tasks),
        next: [],
        someday: [],
      },
    }
  }

  function stripManagedTitle(content: string): string {
    return content.replace(/^\s*#\s+[^\n]*\n?/, '').replace(/^\n/, '')
  }

  function taskRecordToDayTask(task: TaskRecord): DayTask {
    return {
      id: task.id,
      text: task.title,
      status: task.status,
      ...(task.tags && task.tags.length > 0 ? { tags: task.tags } : {}),
      source: task.source,
      ...(task.source_ref ? { source_ref: task.source_ref } : {}),
      ...(task.due ? { due: task.due } : {}),
      ...(task.body ? { body: task.body } : {}),
    }
  }

  function parseFallbackTaskList(content: string): DayTask[] {
    const markerToStatus: Record<string, DayTask['status']> = {
      ' ': 'todo',
      '/': 'in_progress',
      '>': 'delegated',
      x: 'completed',
      X: 'completed',
      '-': 'canceled',
    }
    return content.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s*-\s+\[([ xX/>\-])\]\s+(.+?)\s*$/)
      if (!match?.[1] || !match[2]) return []
      const text = match[2].replace(/\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->\s*$/, '').trim()
      if (!text) return []
      const id = line.match(/<!--\s*task:([a-zA-Z0-9_-]+)\s*-->/)?.[1] ?? `legacy-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
      return [{ id, text, status: markerToStatus[match[1]] ?? 'todo', line }]
    })
  }

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Skill multi-select state
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()

  // Automation multi-select state
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const selectedMetas = useMemo(() => {
    const metas: SessionMeta[] = []
    selectedIds.forEach((id) => {
      const meta = sessionMetaMap.get(id)
      if (meta) metas.push(meta)
    })
    return metas
  }, [selectedIds, sessionMetaMap])

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  // Batch operations for multi-select
  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode.
  // Also renders the Send to Workspace dialog (portal-based, so it overlays regardless of position).
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      {content}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
    </StoplightProvider>
  )

  // Settings navigator - uses component map from settings-pages.ts
  if (isSettingsNavigation(navState)) {
    const SettingsPageComponent = getSettingsPageComponent(navState.subpage)
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceInfoPage
            sourceSlug={navState.details.sourceSlug}
            workspaceId={activeWorkspaceId || ''}
          />
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("sourcesList.noSourcesConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Skills navigator - show skill info, multi-select panel, or empty state
  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("skillsList.noSkillsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Automations navigator - show automation info, multi-select panel, or empty state
  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      const automation = automations.find(h => h.id === navState.details!.automationId)
      if (automation) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AutomationInfoPage
              automation={automation}
              executions={executions}
              testResult={automationTestResults?.[automation.id]}
              onTest={onTestAutomation ? () => onTestAutomation(automation.id) : undefined}
              onToggleEnabled={onToggleAutomation ? () => onToggleAutomation(automation.id) : undefined}
              onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(automation.id) : undefined}
              onDelete={onDeleteAutomation ? () => onDeleteAutomation(automation.id) : undefined}
              onReplay={onReplayAutomation}
            />
          </Panel>
        )
      }
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("automations.noAutomationsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  if (isCaptureNavigation(navState)) {
    const selected = navState.details ? captureItems.find(item => item.id === navState.details!.id) : null
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <CaptureInfoPage item={selected ?? null} workspaceId={activeWorkspaceId ?? undefined} />
      </Panel>
    )
  }

  if (isTasksNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <TasksPage
          workspaceId={activeWorkspaceId ?? null}
          selectedGroup={navState.details?.type === 'group' ? navState.details.id : null}
        />
      </Panel>
    )
  }

  if (isDaysNavigation(navState)) {
    if (navState.details?.type === 'triage' && activeWorkspaceId) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <TriageView workspaceId={activeWorkspaceId} onDone={() => navigate(routes.view.days(todayDateISO()))} />
        </Panel>
      )
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <DaysMainPane
          day={day}
          carryForwardTasks={carryForwardTasks}
          actions={daysActions}
          onPullForward={handlePullForwardDayTasks}
          onUpdateFile={handleUpdateDayFile}
          onNavigateToDate={(dateISO) => navigate(routes.view.days(dateISO))}
          onOpenTriage={() => navigate(routes.view.daysTriage())}
        />
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={selectionCount}
            sessionStatuses={sessionStatuses}
            activeStatusId={activeStatusId}
            onSetStatus={handleBatchSetStatus}
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleBatchToggleLabel}
            onArchive={handleBatchArchive}
            onClearSelection={clearMultiSelect}
          />
        </Panel>
      )
    }

    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }
    // No session selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.noSessionSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.selectConversation")}</p>
      </div>
    </Panel>
  )
}
