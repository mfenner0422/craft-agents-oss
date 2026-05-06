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
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'

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
  const listRef = useRef<HTMLDivElement>(null)
  const selectedWeekRef = useRef<HTMLDivElement | null>(null)
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

  const groups = useMemo(
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
      const raw = storage.getRaw(storage.KEYS.collapsedSessionGroups, scope)
      if (raw === null) {
        const expandedKeys = defaultExpandedWeekKeys(locale)
        return new Set(groups.filter((g) => !expandedKeys.has(g.key)).map((g) => g.key))
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
    [groups, locale],
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
    storage.set(storage.KEYS.collapsedSessionGroups, Array.from(collapsedGroups), scopeKey)
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

  useEffect(() => {
    const row = selectedWeekRef.current
    const list = listRef.current
    if (!row || !list) return
    list.scrollTop = row.offsetTop - list.offsetTop
  }, [selectedDate, groups, collapsedGroups])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    setCollapsedGroups(new Set(groups.map((g) => g.key)))
  }, [groups])

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

  return (
    <div className="h-full min-h-0 flex flex-col">
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
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={showPreviousWeeks}
          className="mb-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {t('day.showPreviousWeeks')}
        </button>
        {groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.key)
          return (
            <div
              key={group.key}
              ref={selectedDate && group.items.some((day) => day.dateISO === selectedDate) ? selectedWeekRef : undefined}
            >
              <CollapsibleWeekHeader
                label={group.label}
                isCollapsed={isCollapsed}
                onToggle={() => toggleGroup(group.key)}
                onCollapseAll={collapseAll}
                onExpandAll={expandAll}
              />
              {!isCollapsed && (
                <div className="flex flex-col">
                  {group.items.map((day) => (
                    <DayRowButton
                      key={day.dateISO}
                      dateISO={day.dateISO}
                      hasContent={day.hasContent}
                      selected={selectedDate === day.dateISO}
                      locale={locale}
                      t={t}
                      onSelect={onSelectDay}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={showNextWeeks}
          className="mt-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          {t('day.showNextWeeks')}
        </button>
      </div>
    </div>
  )
}

function DayRowButton({
  dateISO,
  hasContent,
  selected,
  locale,
  t,
  onSelect,
}: {
  dateISO: string
  hasContent: boolean
  selected: boolean
  locale: Locale
  t: (key: string) => string
  onSelect?: (dateISO: string) => void
}) {
  const date = parseDateISO(dateISO)
  const label = formatDateGroupLabel(date, locale, t)

  return (
    <button
      type="button"
      onClick={() => onSelect?.(dateISO)}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md text-sm hover:bg-foreground/[0.04] flex items-center gap-2',
        selected && 'bg-foreground/[0.06]',
      )}
    >
      <span className="flex-1">
        {label}
      </span>
      {hasContent && <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />}
    </button>
  )
}

function CollapsibleWeekHeader({
  label,
  isCollapsed,
  onToggle,
  onCollapseAll,
  onExpandAll,
}: {
  label: string
  isCollapsed: boolean
  onToggle: () => void
  onCollapseAll: () => void
  onExpandAll: () => void
}) {
  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <button
          onClick={onToggle}
          className="w-full py-2 px-3 rounded-md flex items-center gap-1.5 cursor-pointer hover:bg-foreground/[0.04]"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 text-muted-foreground/60 transition-transform',
              !isCollapsed && 'rotate-90',
            )}
          />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={onToggle}>
          {isCollapsed ? 'Expand' : 'Collapse'}
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={onCollapseAll}>Collapse All</StyledContextMenuItem>
        <StyledContextMenuItem onClick={onExpandAll}>Expand All</StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
