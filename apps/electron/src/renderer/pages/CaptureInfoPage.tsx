import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { CaptureMenu } from '@/components/app-shell/CaptureMenu'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { routes, navigate } from '@/lib/navigate'
import * as storage from '@/lib/local-storage'
import type { CaptureItem } from '@craft-agent/shared/capture'

interface CaptureInfoPageProps {
  item: CaptureItem | null
  workspaceId?: string
}

export default function CaptureInfoPage({ item, workspaceId }: CaptureInfoPageProps) {
  const { t, i18n } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer

  const handleOpenUrl = useCallback(() => {
    if (item?.url) window.electronAPI.openUrl(item.url)
  }, [item?.url])

  const handleShowInFinder = useCallback(() => {
    if (!item || !canRevealLocally) return
    void window.electronAPI.showInFolder(item.filePath)
  }, [canRevealLocally, item])

  const handleDelete = useCallback(async () => {
    if (!item || !workspaceId) return
    try {
      await window.electronAPI.deleteCapture(workspaceId, item.id)
      const lastId = storage.get<string | null>(storage.KEYS.lastSelectedCaptureId, null, workspaceId)
      if (lastId === item.id) {
        storage.remove(storage.KEYS.lastSelectedCaptureId, workspaceId)
      }
      toast.success(t('captureInfo.deletedCapture'))
      navigate(routes.view.capture())
    } catch (err) {
      toast.error(t('captureInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [item, workspaceId, t])

  const title = item?.title || item?.url || t('captureInfo.untitled')

  const formattedDate = React.useMemo(() => {
    if (!item?.capturedAt) return ''
    const parsed = new Date(item.capturedAt)
    if (Number.isNaN(parsed.getTime())) return item.capturedAt
    return format(parsed, 'PPpp', { locale: getDateLocale(i18n.resolvedLanguage ?? 'en') })
  }, [item?.capturedAt, i18n.resolvedLanguage])

  return (
    <Info_Page empty={!item ? t('captureInfo.selectACapture') : undefined}>
      <Info_Page.Header
        title={title}
        titleMenu={item ? (
          <CaptureMenu
            itemId={item.id}
            itemUrl={item.url}
            onOpenUrl={item.url ? handleOpenUrl : undefined}
            onShowInFinder={canRevealLocally ? handleShowInFinder : undefined}
            onDelete={handleDelete}
            canShowInFinder={canRevealLocally}
          />
        ) : undefined}
      />

      {item && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={
              <div className="h-full w-full flex items-center justify-center bg-foreground/5 text-muted-foreground">
                <Inbox className="h-4 w-4" />
              </div>
            }
            title={title}
            tagline={item.url ?? formattedDate}
          />

          <Info_Section title={t('captureInfo.metadata')}>
            <Info_Table>
              <Info_Table.Row label={t('common.source')} value={item.source} />
              <Info_Table.Row label={t('captureInfo.capturedAt')} value={formattedDate} />
              {item.url && (
                <Info_Table.Row label={t('common.url')}>
                  <button
                    onClick={handleOpenUrl}
                    className="hover:underline cursor-pointer text-left break-all"
                  >
                    {item.url}
                  </button>
                </Info_Table.Row>
              )}
              {item.tags.length > 0 && (
                <Info_Table.Row label={t('captureInfo.tags')} value={item.tags.join(', ')} />
              )}
              <Info_Table.Row label={t('common.location')}>
                {canRevealLocally ? (
                  <button
                    onClick={handleShowInFinder}
                    className="hover:underline cursor-pointer text-left break-all"
                  >
                    {item.filePath}
                  </button>
                ) : (
                  <span className="break-all">{item.filePath}</span>
                )}
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          <Info_Section title={t('captureInfo.content')}>
            <Info_Markdown maxHeight={540} fullscreen>
              {item.body || t('captureInfo.noContent')}
            </Info_Markdown>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
