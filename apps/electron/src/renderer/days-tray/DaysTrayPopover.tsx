import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { DayFileKind, DayRecord, DayTask, DaysBoardRecord } from '@craft-agent/shared/days'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import { WeekStrip } from './WeekStrip'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'

interface Props {
  initialWorkspaceId: string
}

type Mode = 'anchored' | 'detached'
type Tab = 'tasks' | 'notes'
type TaskLists = DaysBoardRecord['tasks']

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

  const onUpdateTaskLists = useCallback(async (payload: TaskLists) => {
    if (!workspaceId) return
    await window.electronAPI.ensureDay(workspaceId, selectedDate)
    const updated = await window.electronAPI.updateDayTaskLists(workspaceId, selectedDate, payload)
    setDay(updated)
  }, [workspaceId, selectedDate])

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
          <TasksTab
            day={day}
            carryForward={visibleCarryForward}
            onDismissCarryForward={() => setCarryForwardDismissedKey(carryForwardKey)}
            onPullForward={onPullForward}
            onUpdateTaskLists={onUpdateTaskLists}
          />
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
  if (window.electronAPI.isChannelAvailable('days:getBoard')) {
    try {
      return await window.electronAPI.getDaysBoard(workspaceId, dateISO)
    } catch {
      // The renderer can briefly outpace the main process during hot reload.
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

function parseFallbackTaskList(content: string): DayTask[] {
  const markerToStatus: Record<string, DayTask['status']> = {
    ' ': 'todo',
    '/': 'in_progress',
    '>': 'delegated',
    x: 'completed',
    X: 'completed',
    '-': 'canceled',
  }
  return content.split('\n').flatMap((line, index) => {
    const match = line.match(/^\s*-\s+\[([ xX/>-])\]\s+(.*?)(?:\s*<!--\s*task:([a-zA-Z0-9_-]+)\s*-->)?\s*$/)
    if (!match) return []
    const text = (match[2] ?? '').trim()
    if (!text) return []
    return [{
      id: match[3] ?? `${index}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      text,
      status: markerToStatus[match[1] ?? ' '] ?? 'todo',
      line,
    }]
  })
}

function formatHeaderDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
