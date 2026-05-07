import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Inbox, ListTodo, Undo2, X } from 'lucide-react'
import type { CaptureItem } from '@craft-agent/shared/capture'
import type { TaskRecord, TaskListKind } from '@craft-agent/shared/tasks'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'

interface Props {
  workspaceId: string
  onDone: () => void
}

type DropAction =
  | { kind: 'capture'; itemId: string }
  | { kind: 'task'; task: TaskRecord }

const UNDO_TIMEOUT_MS = 6000

export function TriageView({ workspaceId, onDone }: Props) {
  const [captures, setCaptures] = useState<CaptureItem[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [undoBanner, setUndoBanner] = useState<{ label: string; action: DropAction } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const today = todayDateISO()

  const reload = useCallback(async () => {
    try {
      const [captureItems, taskItems] = await Promise.all([
        window.electronAPI.listCaptureInbox(workspaceId, 100),
        window.electronAPI.listTasks(workspaceId, { activeOnly: true }),
      ])
      setCaptures(captureItems.filter(item => !item.triagedAt))
      setTasks(taskItems)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const offTasks = window.electronAPI.onTasksChanged?.((payload) => {
      if (payload.workspaceId !== workspaceId) return
      void reload()
    })
    const offCaptures = window.electronAPI.onCaptureSaved?.((payload) => {
      if (payload.workspaceId !== workspaceId) return
      void reload()
    })
    return () => {
      offTasks?.()
      offCaptures?.()
    }
  }, [workspaceId, reload])

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
    }
  }, [])

  const lingering = useMemo(() => {
    const cutoff = addDays(today, -1)
    const floor = addDays(today, -7)
    return tasks
      .filter(task => task.day && task.day < cutoff && task.day >= floor)
      .sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '') || (a.slot ?? 0) - (b.slot ?? 0))
  }, [tasks, today])

  const scheduleUndo = useCallback((label: string, action: DropAction) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoBanner({ label, action })
    undoTimer.current = setTimeout(() => setUndoBanner(null), UNDO_TIMEOUT_MS)
  }, [])

  const promoteCapture = useCallback(async (item: CaptureItem, kind: 'day' | 'next' | 'someday' | 'drop') => {
    setCaptures(prev => prev.filter(c => c.id !== item.id))
    setError(null)
    try {
      await window.electronAPI.promoteCapture(
        workspaceId,
        item.id,
        kind === 'day' ? { kind: 'day', dateISO: today } : { kind },
      )
      if (kind === 'drop') scheduleUndo(`Dropped "${captureLabel(item)}"`, { kind: 'capture', itemId: item.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      void reload()
    }
  }, [workspaceId, today, reload, scheduleUndo])

  const promoteTask = useCallback(async (task: TaskRecord, kind: 'day' | 'next' | 'someday' | 'drop') => {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    setError(null)
    try {
      await window.electronAPI.promoteTask(
        workspaceId,
        task.id,
        kind === 'day' ? { kind: 'day', dateISO: today } : { kind },
      )
      if (kind === 'drop') scheduleUndo(`Dropped "${task.title}"`, { kind: 'task', task })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      void reload()
    }
  }, [workspaceId, today, reload, scheduleUndo])

  const undoLastDrop = useCallback(async () => {
    if (!undoBanner) return
    const action = undoBanner.action
    setUndoBanner(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    try {
      if (action.kind === 'task') {
        const restoreList: TaskListKind = (action.task.list ?? 'next') as TaskListKind
        await window.electronAPI.updateTask(workspaceId, action.task.id, {
          status: action.task.status,
          ...(action.task.day ? { day: action.task.day, list: null } : { day: null, list: restoreList }),
          ...(action.task.slot != null ? { slot: action.task.slot } : {}),
          dropped_at: undefined,
          canceled_at: undefined,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      void reload()
    }
  }, [undoBanner, workspaceId, reload])

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Triage</h1>
          <button className="h-8 rounded-md border border-border px-3 text-sm hover:bg-foreground/[0.05]" onClick={onDone}>Skip</button>
        </div>
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Section icon={Inbox} title="Inbox" empty="Nothing to triage. New captures appear here.">
          {captures.map(item => (
            <TriageRow
              key={item.id}
              title={captureLabel(item)}
              meta={item.capturedAt}
              onAction={(kind) => void promoteCapture(item, kind)}
            />
          ))}
        </Section>
        <Section icon={ListTodo} title="Lingering" empty="No lingering tasks from earlier this week.">
          {lingering.map(task => (
            <TriageRow
              key={task.id}
              title={task.title}
              meta={task.day ?? ''}
              onAction={(kind) => void promoteTask(task, kind)}
            />
          ))}
        </Section>
      </div>
      {undoBanner && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center">
          <button
            type="button"
            onClick={() => void undoLastDrop()}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm shadow-strong hover:bg-foreground/[0.05]"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{undoBanner.label}</span>
            <span className="text-muted-foreground">· Undo</span>
          </button>
        </div>
      )}
    </div>
  )
}

function captureLabel(item: CaptureItem): string {
  if (item.title?.trim()) return item.title.trim()
  for (const line of item.body.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*#+\s*/, '').trim()
    if (cleaned) return cleaned
  }
  return 'Capture'
}

function Section({ icon: Icon, title, empty, children }: { icon: React.ComponentType<{ className?: string }>; title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="overflow-hidden rounded-[8px] bg-background shadow-minimal">
        {hasChildren ? children : <div className="px-3 py-4 text-sm text-muted-foreground">{empty}</div>}
      </div>
    </section>
  )
}

function TriageRow({ title, meta, onAction }: { title: string; meta: string; onAction: (kind: 'day' | 'next' | 'someday' | 'drop') => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <button className="h-7 rounded-md border border-border px-2 text-xs hover:bg-foreground/[0.05]" onClick={() => onAction('day')}>Today</button>
      <button className="h-7 rounded-md border border-border px-2 text-xs hover:bg-foreground/[0.05]" onClick={() => onAction('next')}>Next</button>
      <button className="h-7 rounded-md border border-border px-2 text-xs hover:bg-foreground/[0.05]" onClick={() => onAction('someday')}>Someday</button>
      <button className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05]" onClick={() => onAction('drop')} aria-label="Drop">
        <X className="h-3.5 w-3.5" />
      </button>
      <Check className="hidden h-3.5 w-3.5" />
    </div>
  )
}
