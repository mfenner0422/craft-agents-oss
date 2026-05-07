import React, { useEffect, useMemo, useState } from 'react'
import { addDays, todayDateISO } from '@craft-agent/shared/days/date'

interface Props {
  workspaceId: string
  selectedDate: string
  onSelect: (dateISO: string) => void
}

const VISIBLE_DAYS = 14

export function WeekStrip({ workspaceId, selectedDate, onSelect }: Props) {
  const [contentDays, setContentDays] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    window.electronAPI.listDays?.(workspaceId, 60).then((days: string[]) => {
      if (!cancelled) setContentDays(new Set(days))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, selectedDate])

  const days = useMemo(() => {
    const today = todayDateISO()
    const startOffset = -7
    const list: string[] = []
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      list.push(addDays(today, startOffset + i))
    }
    return list
  }, [])

  return (
    <div className="border-b border-border/60 px-2 py-2 overflow-x-auto shrink-0">
      <div className="flex items-stretch gap-1 min-w-max">
        {days.map(dateISO => {
          const isSelected = dateISO === selectedDate
          const isToday = dateISO === todayDateISO()
          const hasContent = contentDays.has(dateISO)
          const [, , dd] = dateISO.split('-')
          const date = new Date(dateISO + 'T12:00:00')
          const weekday = date.toLocaleDateString(undefined, { weekday: 'narrow' })
          return (
            <button
              key={dateISO}
              type="button"
              onClick={() => onSelect(dateISO)}
              className={[
                'flex flex-col items-center justify-center w-9 h-12 rounded-md border text-[11px] shrink-0',
                isSelected
                  ? 'bg-foreground text-background border-foreground'
                  : isToday
                    ? 'border-foreground/40 hover:bg-foreground/[0.05]'
                    : 'border-border hover:bg-foreground/[0.05]',
              ].join(' ')}
            >
              <span className="opacity-70">{weekday}</span>
              <span className="font-medium text-[13px] leading-tight">{Number(dd)}</span>
              <span
                className={[
                  'mt-0.5 h-1 w-1 rounded-full',
                  hasContent ? (isSelected ? 'bg-background' : 'bg-foreground/60') : 'bg-transparent',
                ].join(' ')}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
