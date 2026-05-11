import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'
import { format, isToday, isYesterday, startOfDay } from 'date-fns'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import type { EntityListGroup } from '@/components/ui/entity-list'
import { captureSelection } from '@/hooks/useEntitySelection'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getDateLocale } from '@craft-agent/shared/i18n'
import * as storage from '@/lib/local-storage'
import { CaptureMenu } from './CaptureMenu'
import type { CaptureItem } from '@craft-agent/shared/capture'

function formatDateGroupLabel(date: Date, t: (key: string) => string, lang: string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'MMM d', { locale: getDateLocale(lang) })
}

export interface CaptureListPanelProps {
  items: CaptureItem[]
  selectedItemId?: string | null
  onSelectItem: (item: CaptureItem) => void
  onDeleteCapture: (itemId: string) => void
  className?: string
}

export function CaptureListPanel({
  items,
  selectedItemId,
  onSelectItem,
  onDeleteCapture,
  className,
}: CaptureListPanelProps) {
  const { t, i18n } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const collapseScope = activeWorkspace?.id

  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
    if (!collapseScope) return new Set()
    return new Set(storage.get<string[]>(storage.KEYS.collapsedCaptureGroups, [], collapseScope))
  })

  React.useEffect(() => {
    if (!collapseScope) {
      setCollapsedGroups(new Set())
      return
    }
    setCollapsedGroups(new Set(storage.get<string[]>(storage.KEYS.collapsedCaptureGroups, [], collapseScope)))
  }, [collapseScope])

  React.useEffect(() => {
    if (!collapseScope) return
    storage.set(storage.KEYS.collapsedCaptureGroups, Array.from(collapsedGroups), collapseScope)
  }, [collapsedGroups, collapseScope])

  const toggleGroupCollapse = React.useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  const { groups, flatItems } = React.useMemo(() => {
    if (items.length === 0) return { groups: [] as EntityListGroup<CaptureItem>[], flatItems: items }
    const lang = i18n.resolvedLanguage ?? 'en'
    const byKey = new Map<string, EntityListGroup<CaptureItem>>()
    const dateByKey = new Map<string, Date>()
    for (const item of items) {
      const parsed = item.capturedAt ? new Date(item.capturedAt) : null
      const day = parsed && !Number.isNaN(parsed.getTime()) ? startOfDay(parsed) : new Date(0)
      const key = day.toISOString()
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: formatDateGroupLabel(day, t, lang),
          items: [],
          collapsible: true,
        })
        dateByKey.set(key, day)
      }
      byKey.get(key)!.items.push(item)
    }
    let ordered = Array.from(dateByKey.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([key]) => byKey.get(key)!)

    if (ordered.length === 1) {
      ordered = [{ ...ordered[0]!, collapsible: false }]
    } else {
      ordered = ordered.map(g => collapsedGroups.has(g.key)
        ? { ...g, items: [], collapsedCount: g.items.length }
        : g)
    }

    return { groups: ordered, flatItems: ordered.flatMap(g => g.items) }
  }, [items, i18n.resolvedLanguage, t, collapsedGroups])

  const collapseAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set(groups.filter(g => g.collapsible).map(g => g.key)))
  }, [groups])

  const expandAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  return (
    <EntityPanel<CaptureItem>
      items={flatItems}
      groups={groups}
      collapsedGroups={collapsedGroups}
      onToggleCollapse={toggleGroupCollapse}
      onCollapseAll={collapseAllGroups}
      onExpandAll={expandAllGroups}
      getId={(item) => item.id}
      selection={captureSelection}
      selectedId={selectedItemId}
      onItemClick={onSelectItem}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Inbox />}
          title={t('captureList.noCapturesYet')}
          description={t('captureList.emptyDescription')}
        />
      }
      mapItem={(item) => ({
        title: item.title || item.url || 'Untitled capture',
        badges: (
          <span className="flex items-center gap-1.5 min-w-0">
            {item.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            <span className="truncate">{item.body.trim() || item.capturedAt}</span>
          </span>
        ),
        menu: (
          <CaptureMenu
            itemId={item.id}
            itemUrl={item.url}
            onOpenUrl={item.url ? () => window.electronAPI.openUrl(item.url!) : undefined}
            onShowInFinder={canRevealLocally ? () => window.electronAPI.showInFolder(item.filePath) : undefined}
            onDelete={() => onDeleteCapture(item.id)}
            canShowInFinder={canRevealLocally}
          />
        ),
      })}
    />
  )
}
