import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from 'date-fns'
import {
  isToday,
  isYesterday,
  format,
  startOfWeek,
  endOfWeek,
  startOfDay,
  subWeeks,
  isSameWeek,
} from 'date-fns'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { addDays, formatLocalDateISO, parseDateISO } from '@craft-agent/shared/days/date'
import * as storage from '@/lib/local-storage'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list'

export interface DaysListProps {
  /** ISO date strings that already have vault pages */
  days: string[]
  /** Currently selected date ISO */
  selectedDate?: string | null
  /** Workspace ID for scoped collapse persistence */
  workspaceId?: string
  /** Called when a day row is clicked */
  onSelectDay?: (dateISO: string) => void
}

const WEEKS_PER_LOAD = 8
const INITIAL_WEEKS = 8

function todayStart(): Date {
  return startOfDay(new Date())
}

function addDaysToDate(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

function addMonthsToDate(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function localeWeekDistance(later: Date, earlier: Date, locale: Locale): number {
  const laterWeek = startOfWeek(later, { locale })
  const earlierWeek = startOfWeek(earlier, { locale })
  return Math.round((laterWeek.getTime() - earlierWeek.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

function weekKeyForDate(date: Date, locale: Locale): string {
  return formatLocalDateISO(startOfWeek(date, { locale }))
}

function defaultExpandedWeekKeys(locale: Locale): Set<string> {
  const today = todayStart()
  const thisWeek = startOfWeek(today, { locale })
  return new Set([
    formatLocalDateISO(addDaysToDate(thisWeek, -7)),
    formatLocalDateISO(thisWeek),
    formatLocalDateISO(addDaysToDate(thisWeek, 7)),
  ])
}

/** Build calendar days for the mini month grid (same logic as DaysListColumn) */
function buildCalendarDays(anchorDateISO: string, daysWithContent: Set<string>, locale: Locale) {
  const anchor = parseDateISO(anchorDateISO)
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(first, { locale })
  return Array.from({ length: 42 }, (_, index) => {
    const dateISO = addDays(formatLocalDateISO(start), index)
    const date = parseDateISO(dateISO)
    return {
      dateISO,
      label: String(date.getDate()),
      inMonth: date.getMonth() === anchor.getMonth(),
      hasContent: daysWithContent.has(dateISO),
    }
  })
}

function buildWeekdayLabels(anchorDateISO: string, locale: Locale) {
  const anchor = parseDateISO(anchorDateISO)
  const weekStart = startOfWeek(anchor, { locale })
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDaysToDate(weekStart, index)
    return {
      key: formatLocalDateISO(day),
      label: format(day, 'EEE', { locale }),
    }
  })
}

/** Build week groups: oldest loaded week first, each group contains dates in chronological order */
function buildWeekGroups(
  loadedPastWeeks: number,
  loadedFutureWeeks: number,
  setOfDaysWithContent: Set<string>,
  locale: Locale,
  t: (key: string, options?: Record<string, unknown>) => string,
): WeekGroup[] {
  const today = todayStart()
  const groups: WeekGroup[] = []

  for (let weekOffset = loadedPastWeeks - 1; weekOffset >= -loadedFutureWeeks; weekOffset--) {
    const weekStart = subWeeks(startOfWeek(today, { locale }), weekOffset)
    const weekDates: DayRow[] = []
    const endDate = endOfWeek(weekStart, { locale })

    // Generate days within this week from start to end so scrolling down moves forward in time.
    let current = new Date(weekStart)
    while (current <= endDate) {
      const dateISO = formatLocalDateISO(current)
      const isPlaceholder = !setOfDaysWithContent.has(dateISO)
      weekDates.push({
        dateISO,
        hasContent: !isPlaceholder,
      })
      current = addDaysToDate(current, 1)
    }

    if (weekDates.length === 0) continue

    let label: string
    if (isSameWeek(weekStart, today, { locale })) {
      label = t('day.thisWeek')
    } else if (localeWeekDistance(today, weekStart, locale) === 1) {
      label = t('day.lastWeek')
    } else if (localeWeekDistance(today, weekStart, locale) === -1) {
      label = t('day.nextWeek')
    } else {
      label = t('day.weekOf', { date: format(weekStart, 'MMM d', { locale }) })
    }

    groups.push({
      key: formatLocalDateISO(weekStart),
      label,
      items: weekDates,
    })
  }

  return groups
}

interface DayRow {
  dateISO: string
  hasContent: boolean
}

interface WeekGroup {
  key: string
  label: string
  items: DayRow[]
}

function formatDateGroupLabel(date: Date, locale: Locale, t: (key: string) => string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'EEEE, MMM d', { locale })
}

export function DaysList({ days, selectedDate, workspaceId, onSelectDay }: DaysListProps) {
  const { t, i18n } = useTranslation()
  const locale = getDateLocale(i18n.resolvedLanguage ?? 'en')

  const setOfDaysWithContent = useMemo(() => new Set(days), [days])

  const [loadedPastWeeks, setLoadedPastWeeks] = useState(INITIAL_WEEKS)
  const [loadedFutureWeeks, setLoadedFutureWeeks] = useState(INITIAL_WEEKS)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [calendarMonthISO, setCalendarMonthISO] = useState(
    () => selectedDate ?? formatLocalDateISO(new Date()),
  )

  useEffect(() => {
    setLoadedPastWeeks(INITIAL_WEEKS)
    setLoadedFutureWeeks(INITIAL_WEEKS)
  }, [workspaceId])

  useEffect(() => {
    if (selectedDate) setCalendarMonthISO(formatLocalDateISO(parseDateISO(selectedDate)))
  }, [selectedDate])

  useEffect(() => {
    if (!selectedDate) return
    const selected = parseDateISO(selectedDate)
    const distance = localeWeekDistance(todayStart(), selected, locale)
    if (distance >= 0) {
      setLoadedPastWeeks((prev) => Math.max(prev, distance + 1))
    } else {
      setLoadedFutureWeeks((prev) => Math.max(prev, Math.abs(distance)))
    }
  }, [selectedDate, locale])

  const weekGroups = useMemo(
    () => buildWeekGroups(loadedPastWeeks, loadedFutureWeeks, setOfDaysWithContent, locale, t),
    [loadedPastWeeks, loadedFutureWeeks, setOfDaysWithContent, locale, t],
  )

  // Collapsed group state — persisted per workspace
  const scopeKey = useMemo(
    () => (workspaceId ? `days:${workspaceId}` : 'days'),
    [workspaceId],
  )

  const readCollapsedGroups = useCallback(
    (scope: string): Set<string> => {
      const raw = storage.getRaw(storage.KEYS.collapsedDayGroups, scope)
      if (raw === null) {
        const expandedKeys = defaultExpandedWeekKeys(locale)
        return new Set(weekGroups.filter((g) => !expandedKeys.has(g.key)).map((g) => g.key))
      }
      try {
        const parsed = JSON.parse(raw)
        const collapsed = new Set<string>(Array.isArray(parsed) ? parsed : [])
        for (const expandedKey of defaultExpandedWeekKeys(locale)) {
          collapsed.delete(expandedKey)
        }
        return collapsed
      } catch {
        return new Set()
      }
    },
    [weekGroups, locale],
  )

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => readCollapsedGroups(scopeKey),
  )
  const scopeKeyRef = useRef(scopeKey)

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    setCollapsedGroups(readCollapsedGroups(scopeKey))
    scopeKeyRef.current = scopeKey
  }, [scopeKey, readCollapsedGroups])

  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey) return
    storage.set(storage.KEYS.collapsedDayGroups, Array.from(collapsedGroups), scopeKey)
  }, [collapsedGroups, scopeKey])

  useEffect(() => {
    if (!selectedDate) return
    const selectedWeekKey = weekKeyForDate(parseDateISO(selectedDate), locale)
    setCollapsedGroups((prev) => {
      if (!prev.has(selectedWeekKey)) return prev
      const next = new Set(prev)
      next.delete(selectedWeekKey)
      return next
    })
  }, [selectedDate, locale])

  // Scroll the selected day's week into view when selection changes.
  // We depend on weekGroups/collapsedGroups so this re-runs after auto-load expands
  // far-away dates into the DOM, but a ref prevents re-scrolling on every group
  // rebuild (e.g. when the user clicks "Show previous/next weeks" to load more).
  const lastScrolledDateRef = useRef<string | null>(null)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !selectedDate) return
    if (lastScrolledDateRef.current === selectedDate) return
    const weekKey = weekKeyForDate(parseDateISO(selectedDate), locale)
    const target = viewport.querySelector<HTMLElement>(`[data-week-key="${weekKey}"]`)
    if (target) {
      viewport.scrollTop = target.offsetTop
      lastScrolledDateRef.current = selectedDate
    }
  }, [selectedDate, weekGroups, collapsedGroups, locale])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    setCollapsedGroups(new Set(weekGroups.map((g) => g.key)))
  }, [weekGroups])

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const showPreviousWeeks = useCallback(() => {
    setLoadedPastWeeks((prev) => prev + WEEKS_PER_LOAD)
  }, [])

  const showNextWeeks = useCallback(() => {
    setLoadedFutureWeeks((prev) => prev + WEEKS_PER_LOAD)
  }, [])

  const calendarMonth = parseDateISO(calendarMonthISO)
  const calendarMonthLabel = format(calendarMonth, 'MMMM yyyy', { locale })
  const weekdayLabels = buildWeekdayLabels(calendarMonthISO, locale)
  const calendarDays = buildCalendarDays(calendarMonthISO, setOfDaysWithContent, locale)

  const shiftCalendarMonth = useCallback((amount: number) => {
    setCalendarMonthISO((current) => formatLocalDateISO(addMonthsToDate(parseDateISO(current), amount)))
  }, [])

  // Build EntityList groups: when collapsed, hide items but keep the count.
  const entityGroups = useMemo<EntityListGroup<DayRow>[]>(
    () =>
      weekGroups.map((group) => {
        const isCollapsed = collapsedGroups.has(group.key)
        return {
          key: group.key,
          label: group.label,
          items: isCollapsed ? [] : group.items,
          collapsible: true,
          collapsedCount: group.items.length,
        }
      }),
    [weekGroups, collapsedGroups],
  )

  const flatItems = useMemo(() => entityGroups.flatMap((g) => g.items), [entityGroups])

  const calendar = (
    <div className="shrink-0 border-b border-border/60 p-2 pb-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-sm font-medium text-foreground">
          {calendarMonthLabel}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftCalendarMonth(-1)}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <ChevronLeft className="mx-auto h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftCalendarMonth(1)}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <ChevronRight className="mx-auto h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 px-1 pb-1">
        {weekdayLabels.map(day => (
          <div key={day.key} className="text-center text-[11px] font-medium text-muted-foreground">
            {day.label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 p-1">
        {calendarDays.map(day => (
          <button
            key={day.dateISO}
            type="button"
            onClick={() => onSelectDay?.(day.dateISO)}
            className={cn(
              'relative aspect-square rounded-md text-[11px] hover:bg-foreground/[0.04]',
              selectedDate === day.dateISO && 'bg-foreground/[0.07]',
            )}
          >
            {day.label}
            {day.inMonth && day.hasContent && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/40" />}
          </button>
        ))}
      </div>
    </div>
  )

  const renderItem = (day: DayRow, indexInGroup: number, isFirstInGroup: boolean) => {
    const date = parseDateISO(day.dateISO)
    const label = formatDateGroupLabel(date, locale, t)
    const selected = selectedDate === day.dateISO
    const weekKey = weekKeyForDate(date, locale)
    return (
      <div data-week-key={isFirstInGroup ? weekKey : undefined}>
        {!isFirstInGroup && (
          <div className="px-4">
            <Separator />
          </div>
        )}
        <div className="relative pl-2 mr-2">
          {selected && (
            <div className="absolute left-0 inset-y-0 w-[2px] bg-accent" />
          )}
          <button
            type="button"
            onClick={() => onSelectDay?.(day.dateISO)}
            className={cn(
              'w-full text-left px-2 py-3 rounded-[8px] text-sm flex items-center gap-2 transition-[background-color] duration-75',
              selected ? 'bg-foreground/3' : 'hover:bg-foreground/2',
            )}
          >
            <span className="flex-1">{label}</span>
            {day.hasContent && <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <EntityList<DayRow>
      items={flatItems}
      groups={entityGroups}
      getKey={(day) => day.dateISO}
      renderItem={renderItem}
      header={calendar}
      viewportRef={viewportRef}
      collapsedGroups={collapsedGroups}
      onToggleCollapse={toggleGroup}
      onCollapseAll={collapseAll}
      onExpandAll={expandAll}
      listPrepend={
        <button
          type="button"
          onClick={showPreviousWeeks}
          className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {t('day.showPreviousWeeks')}
        </button>
      }
      footer={
        <button
          type="button"
          onClick={showNextWeeks}
          className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {t('day.showNextWeeks')}
        </button>
      }
    />
  )
}
