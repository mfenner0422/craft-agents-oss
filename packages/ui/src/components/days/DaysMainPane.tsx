import type { DayRecord } from '@craft-agent/shared/days';
import { Markdown } from '../markdown';

export interface DaysMainPaneProps {
  day?: DayRecord | null;
}

export function DaysMainPane({ day }: DaysMainPaneProps) {
  if (!day) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a day</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">{day.dateISO}</h1>
        <ModePill />
      </div>
      <div className="grid gap-5">
        {(['tasks', 'scratch', 'journal'] as const).map(kind => (
          <section key={kind} className="min-w-0">
            <h2 className="text-sm font-semibold capitalize mb-2">{kind}</h2>
            <Markdown mode="minimal" className="text-sm leading-6">
              {day.files[kind]}
            </Markdown>
          </section>
        ))}
      </div>
    </div>
  );
}

function ModePill() {
  const hour = new Date().getHours();
  const mode = hour < 15 ? 'Plan' : 'Reflect';
  return (
    <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-xs">
      <span className={`px-2 py-1 ${mode === 'Plan' ? 'bg-foreground/[0.07]' : ''}`}>Plan</span>
      <span className={`px-2 py-1 ${mode === 'Reflect' ? 'bg-foreground/[0.07]' : ''}`}>Reflect</span>
    </div>
  );
}
