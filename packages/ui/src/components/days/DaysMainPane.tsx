import type { DayFileKind, DayTask, DaysBoardRecord } from '@craft-agent/shared/days';
import { addDays, parseDateISO, todayDateISO } from '@craft-agent/shared/days/date';
import * as React from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { TiptapMarkdownEditor } from '../markdown';
import { TaskBoard, type TaskBoardActions, type TaskBoardTasks, type TaskListKey } from './TaskBoard.tsx';

export type { TaskBoardActions, TaskBoardTasks, TaskListKey };

export interface DaysMainPaneProps {
  day?: DaysBoardRecord | null;
  carryForwardTasks?: DayTask[];
  actions: TaskBoardActions;
  onPullForward?: () => void;
  onUpdateFile?: (kind: DayFileKind, content: string) => void;
  onNavigateToDate?: (dateISO: string) => void;
  onOpenTriage?: () => void;
}

export function DaysMainPane({ day, carryForwardTasks = [], actions, onPullForward, onUpdateFile, onNavigateToDate, onOpenTriage }: DaysMainPaneProps) {
  const [tasks, setTasks] = React.useState<TaskBoardTasks>(() => day?.tasks ?? { today: [], next: [], someday: [] });
  const [activeTaskList, setActiveTaskList] = React.useState<TaskListKey>('today');
  const [scratch, setScratch] = React.useState(day?.bodies.scratch ?? '');
  const [journal, setJournal] = React.useState(day?.bodies.journal ?? '');
  const [carryForwardDismissed, setCarryForwardDismissed] = React.useState(false);
  const noteTimerRef = React.useRef<Record<'scratch' | 'journal', ReturnType<typeof setTimeout> | null>>({ scratch: null, journal: null });

  React.useEffect(() => {
    if (!day) return;
    setTasks(day.tasks);
    setScratch(day.bodies.scratch);
    setJournal(day.bodies.journal);
  }, [day]);

  React.useEffect(() => {
    setCarryForwardDismissed(false);
  }, [day?.dateISO, carryForwardTasks.length]);

  React.useEffect(() => () => {
    if (noteTimerRef.current.scratch) clearTimeout(noteTimerRef.current.scratch);
    if (noteTimerRef.current.journal) clearTimeout(noteTimerRef.current.journal);
  }, []);

  const saveNote = React.useCallback((kind: 'scratch' | 'journal', value: string, immediate = false) => {
    if (noteTimerRef.current[kind]) clearTimeout(noteTimerRef.current[kind]!);
    const run = () => onUpdateFile?.(kind, value);
    if (immediate) run();
    else noteTimerRef.current[kind] = setTimeout(run, 600);
  }, [onUpdateFile]);

  if (!day) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select a day</div>;
  }

  const dateTitle = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(parseDateISO(day.dateISO));
  const isToday = day.dateISO === todayDateISO();
  const navButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-6 pb-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold leading-tight">{dateTitle}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="mr-2 h-8 rounded-md border border-border px-3 text-sm hover:bg-foreground/[0.05]"
              onClick={onOpenTriage}
            >
              Triage
            </button>
            <button
              type="button"
              className={navButtonClass}
              onClick={() => onNavigateToDate?.(addDays(day.dateISO, -1))}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={navButtonClass}
              onClick={() => onNavigateToDate?.(todayDateISO())}
              disabled={isToday}
              aria-label="Today"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            </button>
            <button
              type="button"
              className={navButtonClass}
              onClick={() => onNavigateToDate?.(addDays(day.dateISO, 1))}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      {carryForwardTasks.length > 0 && !carryForwardDismissed && (
        <div className="mb-5 rounded-md border border-border bg-foreground/[0.03] px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{carryForwardTasks.length} unfinished task{carryForwardTasks.length === 1 ? '' : 's'} from yesterday</div>
            <div className="text-xs text-muted-foreground truncate">{carryForwardTasks.map(task => task.text).join(', ')}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/[0.05]" onClick={onPullForward}>
              Pull forward
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              onClick={() => setCarryForwardDismissed(true)}
              aria-label="Dismiss pull-forward suggestion"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
        <div className="grid gap-6">
          <TaskBoard
            dateISO={day.dateISO}
            tasks={tasks}
            setTasks={setTasks}
            actions={actions}
            activeList={activeTaskList}
            onActiveListChange={setActiveTaskList}
            density="comfortable"
            showCapacityWarning
          />
        <NoteSection
          title="Scratch"
          value={scratch}
          onChange={(value) => {
            setScratch(value);
            saveNote('scratch', value);
          }}
          onBlur={() => saveNote('scratch', scratch, true)}
        />
        <NoteSection
          title="Journal"
          value={journal}
          onChange={(value) => {
            setJournal(value);
            saveNote('journal', value);
          }}
          onBlur={() => saveNote('journal', journal, true)}
        />
        </div>
      </div>
    </div>
  );
}

function NoteSection({ title, value, onChange, onBlur }: { title: string; value: string; onChange: (value: string) => void; onBlur: () => void }) {
  return (
    <section className="space-y-3 pt-2">
      <div className="flex items-start justify-between pl-1">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="min-h-[180px] overflow-hidden rounded-[8px] bg-background p-4 shadow-minimal focus-within:ring-1 focus-within:ring-ring" onBlur={onBlur}>
        <TiptapMarkdownEditor
          content={value}
          onUpdate={onChange}
          preset="notes"
          markdownEngine="legacy"
          placeholder=""
          className="text-sm leading-6"
        />
      </div>
    </section>
  );
}
