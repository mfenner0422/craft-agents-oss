export interface DaysListColumnProps {
  days: string[];
  selectedDate?: string | null;
  onSelectDay?: (dateISO: string) => void;
}

export function DaysListColumn({ days, selectedDate, onSelectDay }: DaysListColumnProps) {
  return (
    <div className="h-full overflow-y-auto p-2">
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
