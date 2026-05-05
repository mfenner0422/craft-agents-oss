import type { DayRecord } from '@craft-agent/shared/days';

export interface DaysMainPaneProps {
  day?: DayRecord | null;
}

export function DaysMainPane({ day }: DaysMainPaneProps) {
  if (!day) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a day</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <h1 className="text-xl font-semibold mb-5">{day.dateISO}</h1>
      {(['tasks', 'scratch', 'journal'] as const).map(kind => (
        <section key={kind} className="mb-6">
          <h2 className="text-sm font-semibold capitalize mb-2">{kind}</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{day.files[kind]}</pre>
        </section>
      ))}
    </div>
  );
}
