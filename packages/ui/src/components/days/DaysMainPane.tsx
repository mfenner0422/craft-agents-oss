import type { DayFileKind, DayRecord, DayTask } from '@craft-agent/shared/days';
import * as React from 'react';
import { Markdown } from '../markdown';

export interface DaysMainPaneProps {
  day?: DayRecord | null;
  carryForwardTasks?: DayTask[];
  onPullForward?: () => void;
  onUpdateFile?: (kind: DayFileKind, content: string) => void;
}

export function DaysMainPane({ day, carryForwardTasks = [], onPullForward, onUpdateFile }: DaysMainPaneProps) {
  const [mode, setMode] = React.useState<'plan' | 'reflect'>(() => new Date().getHours() < 15 ? 'plan' : 'reflect');
  const [editing, setEditing] = React.useState<DayFileKind | null>(null);
  const [draft, setDraft] = React.useState('');

  if (!day) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a day</div>;
  }

  const startEditing = (kind: DayFileKind) => {
    setEditing(kind);
    setDraft(day.files[kind]);
  };

  const saveEditing = () => {
    if (!editing) return;
    onUpdateFile?.(editing, draft);
    setEditing(null);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">{day.dateISO}</h1>
        <ModePill mode={mode} onChange={setMode} />
      </div>
      {carryForwardTasks.length > 0 && (
        <div className="mb-5 rounded-md border border-border bg-foreground/[0.03] px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{carryForwardTasks.length} unfinished task{carryForwardTasks.length === 1 ? '' : 's'} from yesterday</div>
            <div className="text-xs text-muted-foreground truncate">{carryForwardTasks.map(task => task.text).join(', ')}</div>
          </div>
          <button type="button" className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/[0.05]" onClick={onPullForward}>
            Pull forward
          </button>
        </div>
      )}
      <div className="grid gap-5">
        {(['tasks', 'scratch', 'journal'] as const).map(kind => (
          <section key={kind} className="min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold capitalize">{kind}</h2>
              {editing === kind ? (
                <div className="flex items-center gap-2">
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditing(null)}>Cancel</button>
                  <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/[0.05]" onClick={saveEditing}>Save</button>
                </div>
              ) : (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => startEditing(kind)}>Edit</button>
              )}
            </div>
            {editing === kind ? (
              <textarea
                className="min-h-[180px] w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-sm leading-6 outline-none focus:ring-1 focus:ring-ring"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            ) : (
              <Markdown mode="minimal" className="text-sm leading-6">
                {day.files[kind]}
              </Markdown>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ModePill({ mode, onChange }: { mode: 'plan' | 'reflect'; onChange: (mode: 'plan' | 'reflect') => void }) {
  return (
    <div className="inline-flex rounded-md border border-border/70 overflow-hidden text-xs">
      <button type="button" className={`px-2 py-1 ${mode === 'plan' ? 'bg-foreground/[0.07]' : ''}`} onClick={() => onChange('plan')}>Plan</button>
      <button type="button" className={`px-2 py-1 ${mode === 'reflect' ? 'bg-foreground/[0.07]' : ''}`} onClick={() => onChange('reflect')}>Reflect</button>
    </div>
  );
}
