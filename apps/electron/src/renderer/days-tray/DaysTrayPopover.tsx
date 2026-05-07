import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { DayFileKind, DayRecord, DayTask, DayTaskStatus, DaysBoardRecord } from '@craft-agent/shared/days'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import type { TaskListKind, TaskRecord } from '@craft-agent/shared/tasks'
import { TaskBoard, type TaskBoardActions, type TaskBoardTasks, type TaskListKey } from '@craft-agent/ui/days'
import { WeekStrip } from './WeekStrip'
import { NotesTab } from './NotesTab'

interface Props {
  initialWorkspaceId: string
}

type Mode = 'anchored' | 'detached'
type Tab = 'tasks' | 'notes'

export function DaysTrayPopover({ initialWorkspaceId }: Props) {
  const [workspaceId] = useState(initialWorkspaceId)
  const [selectedDate, setSelectedDate] = useState(todayDateISO())
  const [day, setDay] = useState<DaysBoardRecord | null>(null)
  const [carryForward, setCarryForward] = useState<DayTask[]>([])
  const [tab, setTab] = useState<Tab>('tasks')
  const [weekOpen, setWeekOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('anchored')
  const [carryForwardDismissedKey, setCarryForwardDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    return window.electronAPI.onDaysTrayMode?.((value) => setMode(value))
  }, [])

  const reload = useCallback(async () => {
    if (!workspaceId) return
    try {
      const record = await loadDaysBoard(workspaceId, selectedDate)
      setDay(record ?? defaultDayRecord(selectedDate))
    } catch {
      setDay(defaultDayRecord(selectedDate))
    }
    try {
      const incomplete = await window.electronAPI.getIncompleteDayTasks(workspaceId, addDays(selectedDate, -1))
      setCarryForward(incomplete)
    } catch {
      setCarryForward([])
    }
  }, [workspaceId, selectedDate])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onDaysChanged?.((payload: { workspaceId: string; dateISO: string }) => {
      if (payload.workspaceId !== workspaceId) return
      if (payload.dateISO === selectedDate || payload.dateISO === addDays(selectedDate, -1)) {
        void reload()
      }
    })
  }, [workspaceId, selectedDate, reload])

  const onPullForward = useCallback(async () => {
    if (!workspaceId || carryForward.length === 0) return
    await window.electronAPI.pullForwardDayTasks(workspaceId, addDays(selectedDate, -1), selectedDate)
    setCarryForward([])
    setCarryForwardDismissedKey(null)
    await reload()
  }, [workspaceId, selectedDate, carryForward.length, reload])

  const onUpdateFile = useCallback(async (kind: DayFileKind, content: string) => {
    if (!workspaceId) return
    await window.electronAPI.ensureDay(workspaceId, selectedDate)
    await window.electronAPI.updateDayFile(workspaceId, selectedDate, kind, content)
    setDay(await loadDaysBoard(workspaceId, selectedDate))
  }, [workspaceId, selectedDate])

  const [tasks, setTasks] = useState<TaskBoardTasks>({ today: [], next: [], someday: [] })
  const [activeList, setActiveList] = useState<TaskListKey>('today')

  useEffect(() => {
    setTasks(day?.tasks ?? { today: [], next: [], someday: [] })
  }, [day])

  const ensureDayPersisted = useCallback(async () => {
    if (!workspaceId) return
    await window.electronAPI.ensureDay(workspaceId, selectedDate)
  }, [workspaceId, selectedDate])

  const trayActions = useMemo<TaskBoardActions>(() => ({
    async add(list: TaskListKey) {
      if (!workspaceId) return null
      await ensureDayPersisted()
      const placement = list === 'today'
        ? { day: selectedDate, list: null }
        : { day: null, list: list as TaskListKind }
      const created = await window.electronAPI.createTask(workspaceId, { title: '', status: 'todo', ...placement })
      return taskRecordToDayTask(created)
    },
    async updateTitle(id: string, title: string) {
      if (!workspaceId) return
      if (!title.trim()) {
        await window.electronAPI.promoteTask(workspaceId, id, { kind: 'drop' })
        return
      }
      await window.electronAPI.updateTask(workspaceId, id, { title })
    },
    async setStatus(id: string, status: DayTaskStatus) {
      if (!workspaceId) return
      await window.electronAPI.updateTask(workspaceId, id, { status })
    },
    async moveToList(id: string, list: TaskListKind) {
      if (!workspaceId) return
      await window.electronAPI.promoteTask(workspaceId, id, { kind: list })
    },
    async moveToDate(id: string, dateISO: string) {
      if (!workspaceId) return
      await window.electronAPI.moveDayTask(workspaceId, id, { kind: 'day', dateISO })
    },
    async remove(id: string) {
      if (!workspaceId) return
      await window.electronAPI.promoteTask(workspaceId, id, { kind: 'drop' })
    },
    async reorderList(list: TaskListKey, orderedIds: string[]) {
      if (!workspaceId) return
      await ensureDayPersisted()
      await window.electronAPI.updateDayTaskLists(workspaceId, selectedDate, { [list]: orderedIds })
    },
    async setDue(id: string, due: string | null) {
      if (!workspaceId) return
      await window.electronAPI.updateTask(workspaceId, id, due === null ? { due: undefined } : { due })
    },
  }), [workspaceId, selectedDate, ensureDayPersisted])

  const headerLabel = useMemo(() => formatHeaderDate(selectedDate), [selectedDate])
  const isToday = selectedDate === todayDateISO()
  const carryForwardKey = `${selectedDate}:${carryForward.map(task => task.id).join(',')}`
  const visibleCarryForward = carryForwardDismissedKey === carryForwardKey ? [] : carryForward

  return (
    <main className="h-screen w-screen bg-background text-foreground border border-border/60 shadow-strong flex flex-col text-[13px]">
      <header
        className="h-12 px-3 flex items-center justify-between border-b border-border/60 [-webkit-app-region:drag] cursor-move shrink-0"
        onContextMenu={(event) => {
          event.preventDefault()
          void window.electronAPI.showDaysTrayPopoverMenu?.()
        }}
      >
        <button
          type="button"
          className="[-webkit-app-region:no-drag] flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-foreground/[0.05] text-left"
          onClick={() => setWeekOpen(open => !open)}
          aria-expanded={weekOpen}
        >
          <span className="font-medium">{headerLabel}</span>
          {!isToday && (
            <span className="text-[11px] text-muted-foreground">({selectedDate})</span>
          )}
        </button>
        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            title="Open Days in main window"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/[0.05]"
            onClick={() => window.electronAPI.openDaysInWorkspace?.(workspaceId, selectedDate)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {mode === 'detached' && (
            <button
              type="button"
              title="Close"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/[0.05]"
              onClick={() => window.electronAPI.closeDaysTrayPopover?.()}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      {weekOpen && (
        <WeekStrip
          workspaceId={workspaceId}
          selectedDate={selectedDate}
          onSelect={(d) => setSelectedDate(d)}
        />
      )}

      <div className="px-3 py-2 border-b border-border/60 shrink-0">
        <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]">
          <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')}>Tasks</TabButton>
          <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>Notes</TabButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'tasks' ? (
          <div className="px-3 py-2.5">
            {visibleCarryForward.length > 0 && (
              <div className="mb-2.5 rounded-md border border-border bg-foreground/[0.03] px-2.5 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{visibleCarryForward.length} task{visibleCarryForward.length === 1 ? '' : 's'} from yesterday</div>
                  <div className="text-[11px] text-muted-foreground truncate">{visibleCarryForward.map(t => t.text).join(', ')}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-foreground/[0.05]" onClick={onPullForward}>Pull forward</button>
                  <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={() => setCarryForwardDismissedKey(carryForwardKey)} aria-label="Dismiss pull-forward suggestion">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            <TaskBoard
              dateISO={selectedDate}
              tasks={tasks}
              setTasks={setTasks}
              actions={trayActions}
              activeList={activeList}
              onActiveListChange={setActiveList}
              density="compact"
              showCapacityWarning
            />
          </div>
        ) : (
          <NotesTab
            day={day}
            dateISO={selectedDate}
            onUpdateFile={onUpdateFile}
          />
        )}
      </div>
    </main>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-3 py-1.5 ${active ? 'bg-foreground/[0.07] font-medium' : 'text-muted-foreground hover:text-foreground'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function defaultDayRecord(dateISO: string): DaysBoardRecord {
  return {
    dateISO,
    files: {
      tasks: '# Tasks\n',
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
  try {
    return await window.electronAPI.getDaysBoard(workspaceId, dateISO)
  } catch {
    return null
  }
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

function formatHeaderDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
