import * as React from 'react'
import { AlertTriangle, Calendar, CheckCircle2, Inbox, Layers, ListTodo, Sun, X } from 'lucide-react'
import type { TaskRecord } from '@craft-agent/shared/tasks'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import type { TasksGroupId } from '../../../shared/types'

interface Props {
  workspaceId: string | null
  selectedGroup: TasksGroupId | null
  onSelectGroup: (group: TasksGroupId) => void
}

interface GroupConfig {
  id: TasksGroupId
  label: string
  icon: React.ComponentType<{ className?: string }>
  matches: (task: TaskRecord, today: string, tomorrow: string) => boolean
}

const GROUPS: GroupConfig[] = [
  {
    id: 'all',
    label: 'All active',
    icon: ListTodo,
    matches: t => t.status === 'todo' || t.status === 'in_progress' || t.status === 'delegated',
  },
  {
    id: 'today',
    label: 'Today',
    icon: Sun,
    matches: (t, today) => t.day === today && (t.status === 'todo' || t.status === 'in_progress' || t.status === 'delegated'),
  },
  {
    id: 'lingering',
    label: 'Lingering',
    icon: AlertTriangle,
    matches: (t, today) => !!t.day && t.day < today && (t.status === 'todo' || t.status === 'in_progress' || t.status === 'delegated'),
  },
  {
    id: 'next',
    label: 'Next',
    icon: Calendar,
    matches: t => t.list === 'next' && (t.status === 'todo' || t.status === 'in_progress' || t.status === 'delegated'),
  },
  {
    id: 'someday',
    label: 'Someday',
    icon: Layers,
    matches: t => t.list === 'someday' && (t.status === 'todo' || t.status === 'in_progress' || t.status === 'delegated'),
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    matches: t => t.status === 'completed',
  },
  {
    id: 'canceled',
    label: 'Canceled',
    icon: X,
    matches: t => t.status === 'canceled' && !t.dropped_at,
  },
]

export function TasksListPanel({ workspaceId, selectedGroup, onSelectGroup }: Props) {
  const [tasks, setTasks] = React.useState<TaskRecord[]>([])

  const reload = React.useCallback(async () => {
    if (!workspaceId) {
      setTasks([])
      return
    }
    try {
      const list = await window.electronAPI.listTasks(workspaceId)
      setTasks(list)
    } catch {
      setTasks([])
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

  const counts = React.useMemo(() => {
    const map = new Map<TasksGroupId, number>()
    for (const group of GROUPS) {
      map.set(group.id, tasks.filter(t => group.matches(t, today, tomorrow)).length)
    }
    return map
  }, [tasks, today, tomorrow])

  const effectiveSelected: TasksGroupId = selectedGroup ?? 'all'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="px-1.5 py-2 space-y-0.5">
          {GROUPS.map(group => {
            const Icon = group.icon
            const count = counts.get(group.id) ?? 0
            const isActive = effectiveSelected === group.id
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  className={`group/row w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                    isActive
                      ? 'bg-foreground/[0.07] text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{group.label}</span>
                  </span>
                  {count > 0 && (
                    <span className={`text-[11px] tabular-nums ${isActive ? 'text-foreground/70' : 'text-muted-foreground/70'}`}>
                      {count}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
