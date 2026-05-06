import React, { useEffect, useRef, useState } from 'react'
import type { DayRecord } from '@craft-agent/shared/days'

interface Props {
  day: DayRecord | null
  dateISO: string
  onUpdateFile: (content: string) => void
}

const SAVE_DEBOUNCE_MS = 500

export function NotesTab({ day, dateISO, onUpdateFile }: Props) {
  const [value, setValue] = useState('')
  const lastSaved = useRef('')
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const next = day?.files.journal ?? ''
    setValue(next)
    lastSaved.current = next
    dirty.current = false
  }, [day, dateISO])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirty.current && value !== lastSaved.current) {
        onUpdateFile(value)
      }
    }
  }, [value, onUpdateFile])

  const onChange = (next: string) => {
    setValue(next)
    dirty.current = next !== lastSaved.current
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (next !== lastSaved.current) {
        lastSaved.current = next
        dirty.current = false
        onUpdateFile(next)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  return (
    <div className="h-full p-3">
      <textarea
        className="h-full w-full resize-none rounded-md border border-border bg-background p-2 font-mono text-[12.5px] leading-6 outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Reflect on the day…"
      />
    </div>
  )
}
