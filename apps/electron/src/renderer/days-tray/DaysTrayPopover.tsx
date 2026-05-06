import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import type { DayRecord, DayTask } from '@craft-agent/shared/days'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import { WeekStrip } from './WeekStrip'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'

interface Props {
  initialWorkspaceId: string
}

type Tab = 'tasks' | 'notes'
type Mode = 'anchored' | 'detached'

export function DaysTrayPopover({ initialWorkspaceId }: Props) {
  const [workspaceId] = useState(initialWorkspaceId)
  const [selectedDate, setSelectedDate] = useState(todayDateISO())
  const [day, setDay] = useState<DayRecord | null>(null)
  const [carryForward, setCarryForward] = useState<DayTask[]>([])
  const [tab, setTab] = useState<Tab>('tasks')
  const [weekOpen, setWeekOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('anchored')

  useEffect(() => {
    return window.electronAPI.onDaysTrayMode?.((value) => setMode(value))
  }, [])

  const reload = useCallback(async () => {
    if (!workspaceId) return
    try {
      const record = await window.electronAPI.getDay(workspaceId, selectedDate)
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
    await reload()
  }, [workspaceId, selectedDate, carryForward.length, reload])

  const onUpdateFile = useCallback(async (kind: 'tasks' | 'journal', content: string) => {
    if (!workspaceId) return
    await window.electronAPI.ensureDay(workspaceId, selectedDate)
    const updated = await window.electronAPI.updateDayFile(workspaceId, selectedDate, kind, content)
    setDay(updated)
  }, [workspaceId, selectedDate])

  const headerLabel = useMemo(() => formatHeaderDate(selectedDate), [selectedDate])
  const isToday = selectedDate === todayDateISO()

  return (
    <main className="h-screen w-screen bg-background text-foreground border border-border/60 shadow-2xl flex flex-col text-[13px]">
      <header className="h-11 px-3 flex items-center justify-between border-b border-border/60 [-webkit-app-region:drag] shrink-0">
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

      <div className="px-3 pt-2 border-b border-border/60 shrink-0">
        <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]">
          <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')}>Tasks</TabButton>
          <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>Notes</TabButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'tasks' ? (
          <TasksTab
            workspaceId={workspaceId}
            day={day}
            dateISO={selectedDate}
            carryForward={carryForward}
            onPullForward={onPullForward}
            onUpdateFile={(content) => onUpdateFile('tasks', content)}
          />
        ) : (
          <NotesTab
            day={day}
            dateISO={selectedDate}
            onUpdateFile={(content) => onUpdateFile('journal', content)}
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

function defaultDayRecord(dateISO: string): DayRecord {
  return {
    dateISO,
    files: {
      tasks: '# Tasks\n',
      scratch: '# Scratch\n',
      journal: '# Journal\n',
    },
  }
}

function formatHeaderDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
