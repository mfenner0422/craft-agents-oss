import * as React from 'react'
import { Calendar, Check, Circle, CircleDot, Forward, ListTodo, X } from 'lucide-react'
import type { TaskRecord, TaskStatus } from '@craft-agent/shared/tasks'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import { navigate, routes } from '@/lib/navigate'
import type { TasksGroupId } from '../../shared/types'

interface Props {
  workspaceId: string | null
  selectedGroup: TasksGroupId | null
}

const STATUS_META: Record<TaskStatus, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  todo: { label: 'To do', icon: Circle },
  in_progress: { label: 'In progress', icon: CircleDot },
  delegated: { label: 'Delegated', icon: Forward },
  completed: { label: 'Completed', icon: Check },
  canceled: { label: 'Canceled', icon: X },
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'delegated', 'completed', 'canceled']

const GROUP_TITLES: Record<TasksGroupId, string> = {
  all: 'All active',
  today: 'Today',
  lingering: 'Lingering',
  next: 'Next',
  someday: 'Someday',
  completed: 'Completed',
  canceled: 'Canceled',
}

const GROUP_DESCRIPTIONS: Record<TasksGroupId, string> = {
  all: 'Every active task across days, Next, and Someday.',
  today: "Tasks committed to today.",
  lingering: 'Active tasks committed to a past day.',
  next: 'Tasks queued in the Next list.',
  someday: 'Tasks deferred to Someday.',
  completed: 'Tasks marked completed.',
  canceled: 'Tasks marked canceled (not dropped).',
}

const EMPTY_COPY: Record<TasksGroupId, string> = {
  all: 'Nothing on the board. Add tasks from the Days view.',
  today: 'No tasks committed to today yet.',
  lingering: 'No lingering tasks.',
  next: 'Next list is empty.',
  someday: 'Someday list is empty.',
  completed: 'No completed tasks.',
  canceled: 'No canceled tasks.',
}

export function TasksPage({ workspaceId, selectedGroup }: Props) {
  const [tasks, setTasks] = React.useState<TaskRecord[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const group: TasksGroupId = selectedGroup ?? 'all'

  const reload = React.useCallback(async () => {
    if (!workspaceId) {
      setTasks([])
      return
    }
    try {
      const list = await window.electronAPI.listTasks(workspaceId)
      setTasks(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [workspaceId])

  React.useEffect(() => { void reload() }, [reload])

  React.useEffect(() => {
    if (!workspaceId) return
    return window.electronAPI.onTasksChanged?.((payload) => {
      if (payload.workspaceId !== workspaceId) return
      void reload()
    })
  }, [workspaceId, reload])

  const today = todayDateISO()
  const tomorrow = addDays(today, 1)

  const visible = React.useMemo(() => filterTasks(tasks, group, today), [tasks, group, today])
  const sorted = React.useMemo(() => sortForGroup(visible, group), [visible, group])

  const setStatus = async (id: string, status: TaskStatus) => {
    if (!workspaceId) return
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    try { await window.electronAPI.updateTask(workspaceId, id, { status }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); void reload() }
  }

  const cycleStatus = (task: TaskRecord) => {
    const i = STATUS_ORDER.indexOf(task.status)
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length] ?? 'todo'
    void setStatus(task.id, next)
  }

  const promote = async (id: string, kind: 'next' | 'someday' | 'drop' | 'today') => {
    if (!workspaceId) return
    setTasks(prev => prev.filter(t => t.id !== id))
    try {
      if (kind === 'today') await window.electronAPI.moveDayTask(workspaceId, id, { kind: 'day', dateISO: today })
      else await window.electronAPI.promoteTask(workspaceId, id, { kind })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); void reload() }
  }

  const navigateToTask = (task: TaskRecord) => {
    if (task.day) navigate(routes.view.days(task.day))
    else navigate(routes.view.days(today))
  }

  if (!workspaceId) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a workspace</div>
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 pb-10">
        <div className="mb-6">
          <h1 className="text-xl font-semibold leading-tight inline-flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-muted-foreground" />
            {GROUP_TITLES[group]}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{GROUP_DESCRIPTIONS[group]}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="rounded-[8px] bg-background shadow-minimal px-4 py-10 text-center text-sm text-muted-foreground">
            {EMPTY_COPY[group]}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] bg-background shadow-minimal">
            <div className="grid divide-y divide-border/70">
              {sorted.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  tomorrow={tomorrow}
                  onCycleStatus={() => cycleStatus(task)}
                  onPromoteToday={() => void promote(task.id, 'today')}
                  onPromoteNext={() => void promote(task.id, 'next')}
                  onPromoteSomeday={() => void promote(task.id, 'someday')}
                  onDrop={() => void promote(task.id, 'drop')}
                  onOpen={() => navigateToTask(task)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function filterTasks(tasks: TaskRecord[], group: TasksGroupId, today: string): TaskRecord[] {
  switch (group) {
    case 'all':
      return tasks.filter(t => isActive(t.status))
    case 'today':
      return tasks.filter(t => t.day === today && isActive(t.status))
    case 'lingering':
      return tasks.filter(t => !!t.day && t.day < today && isActive(t.status))
    case 'next':
      return tasks.filter(t => t.list === 'next' && isActive(t.status))
    case 'someday':
      return tasks.filter(t => t.list === 'someday' && isActive(t.status))
    case 'completed':
      return tasks.filter(t => t.status === 'completed')
    case 'canceled':
      return tasks.filter(t => t.status === 'canceled' && !t.dropped_at)
  }
}

function sortForGroup(tasks: TaskRecord[], group: TasksGroupId): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    if (group === 'completed' || group === 'canceled') {
      return b.updated_at.localeCompare(a.updated_at)
    }
    const aDay = a.day ?? ''
    const bDay = b.day ?? ''
    if (aDay !== bDay) return aDay.localeCompare(bDay)
    return (a.slot ?? 0) - (b.slot ?? 0) || a.updated_at.localeCompare(b.updated_at)
  })
}

function isActive(status: TaskStatus): boolean {
  return status === 'todo' || status === 'in_progress' || status === 'delegated'
}

function TaskRow({
  task,
  today,
  tomorrow,
  onCycleStatus,
  onPromoteToday,
  onPromoteNext,
  onPromoteSomeday,
  onDrop,
  onOpen,
}: {
  task: TaskRecord
  today: string
  tomorrow: string
  onCycleStatus: () => void
  onPromoteToday: () => void
  onPromoteNext: () => void
  onPromoteSomeday: () => void
  onDrop: () => void
  onOpen: () => void
}) {
  const isMuted = task.status === 'completed' || task.status === 'canceled'
  const StatusIcon = STATUS_META[task.status].icon
  const isOverdue = task.due && !isMuted && task.due < today

  const placement = task.day
    ? task.day === today ? 'Today' : task.day === tomorrow ? 'Tomorrow' : formatShortDate(task.day)
    : task.list === 'next' ? 'Next' : task.list === 'someday' ? 'Someday' : ''

  return (
    <div className={`group/task flex items-center gap-2 px-3 py-2${isMuted ? ' opacity-55' : ''}`}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        onClick={onCycleStatus}
        aria-label={`Status: ${STATUS_META[task.status].label}`}
        title={STATUS_META[task.status].label}
      >
        <StatusIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className={`flex-1 min-w-0 text-left text-sm truncate hover:underline${isMuted ? ' line-through' : ''}`}
        title={task.title}
      >
        {task.title || <span className="text-muted-foreground">Untitled</span>}
      </button>
      {task.due && (
        <span
          className={`inline-flex items-center gap-1 rounded-md border border-border/60 bg-foreground/[0.03] px-1.5 py-0.5 text-[10px] tabular-nums${isOverdue ? ' text-destructive border-destructive/40 bg-destructive/[0.05]' : ' text-muted-foreground'}`}
          title={`Deadline ${task.due}`}
        >
          <Calendar className="h-3 w-3" />
          {formatDueLabel(task.due, today, tomorrow)}
        </span>
      )}
      {placement && (
        <span className="hidden md:inline text-[10px] uppercase tracking-wide text-muted-foreground/70 px-1.5">
          {placement}
        </span>
      )}
      <div className="flex items-center opacity-0 group-hover/task:opacity-100 transition-opacity">
        {task.day !== today && task.status !== 'completed' && task.status !== 'canceled' && (
          <button type="button" className="h-7 rounded-md border border-border px-2 text-[11px] hover:bg-foreground/[0.05]" onClick={onPromoteToday}>Today</button>
        )}
        {task.list !== 'next' && task.status !== 'completed' && task.status !== 'canceled' && (
          <button type="button" className="ml-1 h-7 rounded-md border border-border px-2 text-[11px] hover:bg-foreground/[0.05]" onClick={onPromoteNext}>Next</button>
        )}
        {task.list !== 'someday' && task.status !== 'completed' && task.status !== 'canceled' && (
          <button type="button" className="ml-1 h-7 rounded-md border border-border px-2 text-[11px] hover:bg-foreground/[0.05]" onClick={onPromoteSomeday}>Someday</button>
        )}
        <button type="button" className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground" onClick={onDrop} aria-label="Drop">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDueLabel(due: string, today: string, tomorrow: string): string {
  if (due === today) return 'Today'
  if (due === tomorrow) return 'Tmrw'
  return formatShortDate(due)
}

export default TasksPage
