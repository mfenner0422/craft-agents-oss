import React, { useEffect, useRef, useState } from 'react'
import { TiptapMarkdownEditor } from '@craft-agent/ui'
import type { DayFileKind, DayRecord } from '@craft-agent/shared/days'
import { DebouncedTextSaver } from './notes-autosave'

interface Props {
  day: DayRecord | null
  dateISO: string
  onUpdateFile: (kind: DayFileKind, content: string) => void
}

const SAVE_DEBOUNCE_MS = 500
type NotesKind = 'scratch' | 'journal'

export function NotesTab({ day, dateISO, onUpdateFile }: Props) {
  const [kind, setKind] = useState<NotesKind>('scratch')
  const [value, setValue] = useState('')
  const saver = useRef<DebouncedTextSaver | null>(null)

  if (!saver.current) {
    saver.current = new DebouncedTextSaver({
      initialValue: '',
      delayMs: SAVE_DEBOUNCE_MS,
      onSave: (next) => onUpdateFile(kind, next),
    })
  }

  useEffect(() => {
    saver.current?.setOnSave((next) => onUpdateFile(kind, next))
  }, [kind, onUpdateFile])

  useEffect(() => {
    const next = day?.bodies[kind] ?? ''
    setValue(next)
    saver.current?.reset(next)
  }, [day, dateISO, kind])

  useEffect(() => {
    return () => {
      saver.current?.dispose()
    }
  }, [])

  const onChange = (next: string) => {
    setValue(next)
    saver.current?.update(next)
  }

  const selectKind = (nextKind: NotesKind) => {
    if (nextKind === kind) return
    saver.current?.flush()
    setKind(nextKind)
  }

  return (
    <div className="h-full p-3 flex flex-col min-h-0">
      <div className="mb-2 flex items-center justify-between gap-3 shrink-0">
        <div className="text-[12px] font-semibold capitalize">{kind}</div>
        <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-[12px]">
          <NoteKindButton active={kind === 'scratch'} onClick={() => selectKind('scratch')}>Scratch</NoteKindButton>
          <NoteKindButton active={kind === 'journal'} onClick={() => selectKind('journal')}>Journal</NoteKindButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[8px] bg-background p-3 shadow-minimal focus-within:ring-1 focus-within:ring-ring">
        <TiptapMarkdownEditor
          content={value}
          onUpdate={onChange}
          preset="notes"
          markdownEngine="legacy"
          placeholder=""
          className="text-[13px] leading-6"
        />
      </div>
    </div>
  )
}

function NoteKindButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`px-2 py-1 ${active ? 'bg-foreground/[0.07] font-medium' : 'text-muted-foreground hover:text-foreground'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
