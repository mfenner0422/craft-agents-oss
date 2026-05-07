import React, { useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Save, X } from 'lucide-react'
import '../index.css'

function getWorkspaceId(): string {
  return new URLSearchParams(window.location.search).get('workspaceId') ?? ''
}

function CaptureWindow() {
  const workspaceId = useMemo(getWorkspaceId, [])
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasUrlOrTitle = !!(url.trim() || title.trim())

  const save = useCallback(async () => {
    if (!workspaceId || saving || !hasUrlOrTitle) return
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.saveCapture({
        workspaceId,
        source: 'global-hotkey',
        url: url.trim() || undefined,
        title: title.trim() || undefined,
        body: body.trim() || url.trim() || title.trim(),
        tags: [],
      })
      window.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save capture')
    } finally {
      setSaving(false)
    }
  }, [body, hasUrlOrTitle, saving, title, url, workspaceId])

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
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="URL"
          autoFocus
        />
        <input
          className="h-9 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          className="min-h-[118px] resize-none rounded-md border border-border bg-background p-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Note"
        />
        {error && <div className="text-[12px] text-destructive">{error}</div>}
        <div className="flex justify-end">
          <button
            type="button"
            className="h-8 px-3 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-[13px] disabled:opacity-50"
            disabled={saving || !hasUrlOrTitle}
            onClick={save}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaptureWindow />
  </React.StrictMode>,
)
