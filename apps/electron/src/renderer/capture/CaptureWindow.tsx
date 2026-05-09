import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Inbox, Calendar, Layers, X } from 'lucide-react'
import '../index.css'

type CaptureTarget = 'inbox' | 'next' | 'someday'

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
  const urlInputRef = useRef<HTMLInputElement>(null)
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const hasPrefill = !!(prefill.url || prefill.title)

  useEffect(() => {
    if (hasPrefill) bodyTextareaRef.current?.focus()
    else urlInputRef.current?.focus()
  }, [hasPrefill])

  const hasContent = !!(url.trim() || title.trim() || body.trim())

  const save = useCallback(async (target: CaptureTarget) => {
    if (!workspaceId || saving || !hasContent) return
    setSaving(true)
    setError(null)
    try {
      const tags: string[] = target === 'inbox' ? [] : [target, 'triaged']
      await window.electronAPI.saveCapture({
        workspaceId,
        source: 'global-hotkey',
        url: url.trim() || undefined,
        title: title.trim() || undefined,
        body: body.trim(),
        tags,
      })
      window.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save capture')
    } finally {
      setSaving(false)
    }
  }, [body, hasContent, saving, title, url, workspaceId])

  return (
    <main className="h-screen w-screen bg-background text-foreground border border-border/60 shadow-strong">
      <header className="h-10 px-3 flex items-center justify-between border-b border-border/60 [-webkit-app-region:drag]">
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
      <section className="p-3 flex flex-col gap-2">
        <input
          ref={urlInputRef}
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="URL"
        />
        <input
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          ref={bodyTextareaRef}
          className="min-h-[118px] resize-none rounded-md border border-border bg-background p-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Note"
        />
        {error && <div className="text-[12px] text-destructive">{error}</div>}
        <div className="flex items-center justify-end gap-1.5">
          <SaveButton
            label="Inbox"
            icon={<Inbox className="h-3.5 w-3.5" />}
            onClick={() => save('inbox')}
            disabled={saving || !hasContent}
            variant="secondary"
          />
          <SaveButton
            label="Someday"
            icon={<Layers className="h-3.5 w-3.5" />}
            onClick={() => save('someday')}
            disabled={saving || !hasContent}
            variant="secondary"
          />
          <SaveButton
            label="Next"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => save('next')}
            disabled={saving || !hasContent}
            variant="primary"
          />
        </div>
      </section>
    </main>
  )
}

function SaveButton({
  label,
  icon,
  onClick,
  disabled,
  variant,
}: {
  label: string
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
    </button>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaptureWindow />
  </React.StrictMode>,
)
