import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle, CircleDot, Forward, Plus, X } from 'lucide-react'
import type { DayTask, DayTaskStatus, DaysBoardRecord } from '@craft-agent/shared/days'

interface Props {
  day: DaysBoardRecord | null
  carryForward: DayTask[]
  onDismissCarryForward: () => void
  onPullForward: () => void
  onUpdateTaskLists: (payload: DaysBoardRecord['tasks']) => void
}

const STATUS_ORDER: DayTaskStatus[] = ['todo', 'in_progress', 'delegated', 'completed', 'canceled']
const STATUS_META: Record<DayTaskStatus, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  todo: { label: 'To do', icon: Circle },
  in_progress: { label: 'In progress', icon: CircleDot },
  delegated: { label: 'Delegated', icon: Forward },
  completed: { label: 'Completed', icon: Check },
  canceled: { label: 'Canceled', icon: X },
}

export function TasksTab({ day, carryForward, onDismissCarryForward, onPullForward, onUpdateTaskLists }: Props) {
  const [tasks, setTasks] = useState<DayTask[]>([])
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTasks(day?.tasks.today ?? [])
  }, [day])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const saveTasks = useCallback((next: DayTask[], immediate = false) => {
    if (!day) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const payload = {
      ...day.tasks,
      today: next.filter(task => task.text.trim().length > 0),
    }
    if (immediate) onUpdateTaskLists(payload)
    else saveTimer.current = setTimeout(() => onUpdateTaskLists(payload), 500)
  }, [day, onUpdateTaskLists])

  const updateTasks = useCallback((updater: (current: DayTask[]) => DayTask[], immediate = false) => {
    setTasks(current => {
      const next = updater(current)
      saveTasks(next, immediate)
      return next
    })
  }, [saveTasks])

  const addTask = useCallback(() => {
    const task: DayTask = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: '',
      status: 'todo',
    }
    updateTasks(current => [...current, task])
    setFocusedTaskId(task.id)
  }, [updateTasks])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">
        {carryForward.length > 0 && (
          <div className="mb-2.5 rounded-md border border-border bg-foreground/[0.03] px-2.5 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium">
                {carryForward.length} task{carryForward.length === 1 ? '' : 's'} from yesterday
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {carryForward.map(t => t.text).join(', ')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-foreground/[0.05]"
                onClick={onPullForward}
              >
                Pull forward
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                onClick={onDismissCarryForward}
                aria-label="Dismiss pull-forward suggestion"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {tasks.length === 0 ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[8px] bg-background px-3 py-4 text-left text-[13px] text-muted-foreground shadow-minimal hover:bg-foreground/[0.03] hover:text-foreground"
            onClick={addTask}
          >
            <Plus className="h-4 w-4" />
            Add a task
          </button>
        ) : (
          <div className="overflow-hidden rounded-[8px] bg-background shadow-minimal">
            <div className="grid divide-y divide-border/70">
              {tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  shouldFocus={focusedTaskId === task.id}
                  onFocusTask={setFocusedTaskId}
                  onUpdate={(patch, immediate) => {
                    updateTasks(current => current.map(item => item.id === task.id ? { ...item, ...patch } : item), immediate)
                  }}
                  onRemove={() => {
                    updateTasks(current => current.filter(item => item.id !== task.id), true)
                    setFocusedTaskId(null)
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-2 flex items-center justify-end shrink-0">
        <button
          type="button"
          className="h-8 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-foreground/[0.05]"
          onClick={addTask}
        >
          <Plus className="h-3.5 w-3.5" />
          Add task
        </button>
      </div>
    </div>
  )
}

function TaskRow({
  task,
  shouldFocus,
  onFocusTask,
  onUpdate,
  onRemove,
}: {
  task: DayTask
  shouldFocus: boolean
  onFocusTask: (taskId: string | null) => void
  onUpdate: (patch: Partial<DayTask>, immediate?: boolean) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!shouldFocus) return
    inputRef.current?.focus()
  }, [shouldFocus])

  const cycleStatus = () => {
    const currentIndex = STATUS_ORDER.indexOf(task.status)
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length] ?? 'todo'
    onUpdate({ status: nextStatus }, true)
  }

  const isMuted = task.status === 'completed' || task.status === 'canceled'
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.todo
  const StatusIcon = statusMeta.icon

  return (
    <div className={['group/task flex items-center gap-2 px-2 py-1.5', isMuted ? 'opacity-55' : ''].join(' ')}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        onClick={cycleStatus}
        title={statusMeta.label}
        aria-label={`Status: ${statusMeta.label}`}
      >
        <StatusIcon className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        className={['h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none', isMuted ? 'line-through' : ''].join(' ')}
        value={task.text}
        placeholder="Task"
        onFocus={() => onFocusTask(task.id)}
        onChange={event => onUpdate({ text: event.target.value })}
        onBlur={() => onUpdate({ text: task.text.trim() }, true)}
        onKeyDown={event => {
          if (event.key === 'Backspace' && task.text.length === 0) {
            event.preventDefault()
            onRemove()
          }
        }}
      />
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.05] hover:text-foreground group-hover/task:opacity-100 focus:opacity-100"
        onClick={onRemove}
        aria-label="Remove task"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
