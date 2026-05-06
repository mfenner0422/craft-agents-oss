import React, { useCallback, useMemo, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import type { DayRecord, DayTask } from '@craft-agent/shared/days'

interface Props {
  workspaceId: string
  day: DayRecord | null
  dateISO: string
  carryForward: DayTask[]
  onPullForward: () => void
  onUpdateFile: (content: string) => void
}

interface TaskLine {
  raw: string
  index: number
  done: boolean
  text: string
}

export function TasksTab({ day, carryForward, onPullForward, onUpdateFile }: Props) {
  const [draft, setDraft] = useState('')
  const tasks = useMemo(() => parseTaskLines(day?.files.tasks ?? ''), [day])

  const toggleTask = useCallback((index: number, done: boolean) => {
    if (!day) return
    const lines = day.files.tasks.split('\n')
    if (index < 0 || index >= lines.length) return
    const line = lines[index]
    lines[index] = done
      ? line.replace(/^(\s*-\s+\[)\s(\])/, '$1x$2')
      : line.replace(/^(\s*-\s+\[)x(\])/i, '$1 $2')
    onUpdateFile(lines.join('\n'))
  }, [day, onUpdateFile])

  const addTask = useCallback(() => {
    const text = draft.trim()
    if (!text || !day) return
    const current = day.files.tasks
    const separator = current.endsWith('\n') ? '' : '\n'
    onUpdateFile(`${current}${separator}- [ ] ${text}\n`)
    setDraft('')
  }, [draft, day, onUpdateFile])

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
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-foreground/[0.05]"
              onClick={onPullForward}
            >
              Pull forward
            </button>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3">
            No tasks yet — add one below.
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {tasks.map(t => (
              <li key={`${t.index}-${t.raw}`} className="flex items-start gap-2 py-1">
                <input
                  type="checkbox"
                  className="mt-[3px] h-3.5 w-3.5 cursor-pointer accent-foreground"
                  checked={t.done}
                  onChange={(e) => toggleTask(t.index, e.target.checked)}
                />
                <span className={[
                  'text-[13px] leading-snug min-w-0 break-words',
                  t.done ? 'line-through text-muted-foreground' : '',
                ].join(' ')}>
                  {t.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="border-t border-border/60 p-2 flex items-center gap-2 shrink-0"
        onSubmit={(e) => { e.preventDefault(); addTask() }}
      >
        <input
          className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus:ring-1 focus:ring-ring"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          autoFocus
        />
        <button
          type="submit"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-foreground/[0.05] disabled:opacity-40"
          disabled={!draft.trim()}
          aria-label="Add task"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}

function parseTaskLines(source: string): TaskLine[] {
  const out: TaskLine[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const open = raw.match(/^\s*-\s+\[\s\]\s+(.*?)(\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->)?\s*$/)
    if (open) {
      out.push({ raw, index: i, done: false, text: open[1] })
      continue
    }
    const done = raw.match(/^\s*-\s+\[x\]\s+(.*?)(\s*<!--\s*task:[a-zA-Z0-9_-]+\s*-->)?\s*$/i)
    if (done) {
      out.push({ raw, index: i, done: true, text: done[1] })
    }
  }
  return out
}
