export interface DaysListColumnProps {
  days: string[];
  selectedDate?: string | null;
  onSelectDay?: (dateISO: string) => void;
}

export function DaysListColumn({ days, selectedDate, onSelectDay }: DaysListColumnProps) {
  const calendarDays = buildCalendarDays(selectedDate ?? days[0] ?? new Date().toISOString().slice(0, 10), new Set(days));

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="grid grid-cols-7 gap-1 p-1 mb-2">
        {calendarDays.map(day => (
          <button
            key={day.dateISO}
            type="button"
            onClick={() => onSelectDay?.(day.dateISO)}
            className={`aspect-square rounded-md text-[11px] relative hover:bg-foreground/[0.04] ${selectedDate === day.dateISO ? 'bg-foreground/[0.07]' : ''} ${day.inMonth ? '' : 'text-muted-foreground/50'}`}
          >
            {day.label}
            {day.hasContent && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-foreground/40" />}
          </button>
        ))}
      </div>
      {days.length === 0 ? (
        <div className="px-3 py-8 text-sm text-muted-foreground">No days yet</div>
      ) : days.map(day => (
        <button
          key={day}
          type="button"
          onClick={() => onSelectDay?.(day)}
          className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-foreground/[0.04] ${selectedDate === day ? 'bg-foreground/[0.06]' : ''}`}
        >
          {day}
        </button>
      ))}
    </div>
  );
}

function buildCalendarDays(anchorDateISO: string, daysWithContent: Set<string>) {
  const anchor = new Date(`${anchorDateISO}T00:00:00`);
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateISO = date.toISOString().slice(0, 10);
    return {
      dateISO,
      label: String(date.getDate()),
      inMonth: date.getMonth() === anchor.getMonth(),
      hasContent: daysWithContent.has(dateISO),
    };
  });
}
