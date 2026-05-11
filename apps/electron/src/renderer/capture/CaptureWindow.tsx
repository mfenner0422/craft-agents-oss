import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Inbox, Calendar, X } from 'lucide-react'
import { todayDateISO } from '@craft-agent/shared/days/date'
import '../index.css'

type CaptureTarget = 'today' | 'inbox'

function getWorkspaceId(): string {
  return new URLSearchParams(window.location.search).get('workspaceId') ?? ''
}

function getPrefill(): { url: string; title: string; body: string } {
  const params = new URLSearchParams(window.location.search)
  return {
    url: params.get('url') ?? '',
    title: params.get('title') ?? '',
    body: params.get('body') ?? '',
  }
}

function CaptureWindow() {
  const workspaceId = useMemo(getWorkspaceId, [])
  const prefill = useMemo(getPrefill, [])
  const [url, setUrl] = useState(prefill.url)
  const [title, setTitle] = useState(prefill.title)
  const [body, setBody] = useState(prefill.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusTitle = () => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
    focusTitle()
    const frame = window.requestAnimationFrame(focusTitle)
    const timeout = window.setTimeout(focusTitle, 50)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [])

  const hasContent = !!(url.trim() || title.trim() || body.trim())

  const save = useCallback(async (target: CaptureTarget) => {
    if (!workspaceId || saving || !hasContent) return
    setSaving(true)
    setError(null)
    try {
      if (target === 'today') {
        await window.electronAPI.createTask(workspaceId, {
          title: deriveTaskTitle({ title, body, url }),
          day: todayDateISO(),
          list: null,
          source: 'capture',
          body: buildTaskBody({ body, url }),
        })
      } else {
        await window.electronAPI.saveCapture({
          workspaceId,
          url: url.trim() || undefined,
          title: title.trim() || undefined,
          body: body.trim(),
          tags: [],
        })
      }
      window.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save capture')
    } finally {
      setSaving(false)
    }
  }, [body, hasContent, saving, title, url, workspaceId])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      window.close()
      return
    }
    if (event.key !== 'Enter') return
    if (event.altKey && !event.metaKey) {
      event.preventDefault()
      void save('today')
    } else if (event.metaKey && !event.altKey) {
      event.preventDefault()
      void save('inbox')
    }
  }, [save])

  return (
    <main
      className="h-screen w-screen bg-background text-foreground border border-border/60 shadow-strong"
      onKeyDown={handleKeyDown}
    >
      <header className="h-9 px-3 flex items-center justify-between border-b border-border/60 [-webkit-app-region:drag]">
        <div className="text-[13px] font-medium">Capture</div>
        <button
          type="button"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-sidebar-hover [-webkit-app-region:no-drag]"
          onClick={() => window.close()}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <section className="p-2.5 flex flex-col gap-1.5">
        <input
          ref={titleInputRef}
          autoFocus
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <input
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="URL"
        />
        <textarea
          className="h-[88px] resize-none rounded-md border border-border bg-background p-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Note"
        />
        {error && <div className="text-[12px] text-destructive">{error}</div>}
        <div className="flex items-center justify-end gap-1.5">
          <SaveButton
            label="Today"
            shortcut="⌥ Enter"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => save('today')}
            disabled={saving || !hasContent}
            variant="primary"
          />
          <SaveButton
            label="Inbox"
            shortcut="⌘ Enter"
            icon={<Inbox className="h-3.5 w-3.5" />}
            onClick={() => save('inbox')}
            disabled={saving || !hasContent}
            variant="secondary"
          />
        </div>
      </section>
    </main>
  )
}

function deriveTaskTitle({ title, body, url }: { title: string; body: string; url: string }): string {
  const explicitTitle = title.trim()
  if (explicitTitle) return explicitTitle

  for (const line of body.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*#+\s*/, '').trim()
    if (cleaned) return cleaned
  }

  if (url.trim()) {
    try {
      return new URL(url.trim()).hostname.replace(/^www\./, '')
    } catch {
      return url.trim()
    }
  }

  return 'Capture'
}

function buildTaskBody({ body, url }: { body: string; url: string }): string {
  return [body.trim(), url.trim()].filter(Boolean).join('\n\n')
}

function SaveButton({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
  variant,
}: {
  label: string
  shortcut: string
  icon: React.ReactNode
  onClick: () => void
  disabled: boolean
  variant: 'primary' | 'secondary'
}) {
  const className = variant === 'primary'
    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : 'border border-border bg-background hover:bg-foreground/[0.05]'
  return (
    <button
      type="button"
      className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] disabled:opacity-50 ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
      <span className="text-[11px] opacity-70">{shortcut}</span>
    </button>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaptureWindow />
  </React.StrictMode>,
)
