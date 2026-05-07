import type { DayFileKind, DayTask, DayTaskStatus, DaysBoardRecord } from '@craft-agent/shared/days';
import { addDays, parseDateISO, todayDateISO } from '@craft-agent/shared/days/date';
import * as React from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  MeasuringStrategy,
  type DragStartEvent,
  type DragEndEvent,
  type DropAnimation,
  type MeasuringConfiguration,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as chrono from 'chrono-node';
import { Check, ChevronLeft, ChevronRight, Circle, CircleDot, Forward, MoreHorizontal, Plus, X } from 'lucide-react';
import { TiptapMarkdownEditor } from '../markdown';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';
import {
  DropdownMenu,
  DropdownMenuSub,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubContent,
  StyledDropdownMenuSubTrigger,
} from '../ui';
import { cn } from '../../lib/utils';

type TaskListKey = 'today' | 'next' | 'someday';

export interface DaysMainPaneProps {
  day?: DaysBoardRecord | null;
  carryForwardTasks?: DayTask[];
  onPullForward?: () => void;
  onUpdateFile?: (kind: DayFileKind, content: string) => void;
  onUpdateTaskLists?: (payload: { today: DayTask[]; next: DayTask[]; someday: DayTask[] }) => void;
  onMoveTaskToDate?: (task: DayTask, dateISO: string) => Promise<void> | void;
  onNavigateToDate?: (dateISO: string) => void;
}

const STATUS_OPTIONS: Array<{ value: DayTaskStatus; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'todo', label: 'To do', icon: Circle },
  { value: 'in_progress', label: 'In progress', icon: CircleDot },
  { value: 'delegated', label: 'Delegated', icon: Forward },
  { value: 'completed', label: 'Completed', icon: Check },
  { value: 'canceled', label: 'Canceled', icon: X },
];
const STATUS_ORDER: DayTaskStatus[] = STATUS_OPTIONS.map(option => option.value);
const DEFAULT_STATUS_OPTION = STATUS_OPTIONS[0]!;
const TASK_LISTS: TaskListKey[] = ['today', 'next', 'someday'];
const MENU_ITEM_CLASS = 'relative flex cursor-default items-center gap-2 rounded-[4px] px-2 py-1.5 pr-4 text-sm outline-hidden select-none hover:bg-foreground/[0.03] focus:bg-foreground/[0.03] data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

// ---------------------------------------------------------------------------
// @dnd-kit config — mirrors apps/electron/.../sortable-list.tsx
// ---------------------------------------------------------------------------

function hasNoDndAncestor(element: HTMLElement | null): boolean {
  while (element) {
    if (element.dataset?.noDnd === 'true') return true;
    element = element.parentElement;
  }
  return false;
}

class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        if (hasNoDndAncestor(nativeEvent.target as HTMLElement)) return false;
        return true;
      },
    },
  ];
}

class SmartKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (event: React.KeyboardEvent<Element>, ...rest: unknown[]) => {
        if (hasNoDndAncestor(event.target as HTMLElement)) return false;
        const baseHandler = (KeyboardSensor.activators[0] as { handler: Function }).handler;
        return baseHandler(event, ...rest);
      },
    },
  ];
}

const DROP_DURATION = 250;

const dropAnimationConfig: DropAnimation = {
  keyframes({ transform }) {
    return [
      { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
      { opacity: 0, transform: CSS.Transform.toString(transform.final) },
    ];
  },
  duration: DROP_DURATION,
  easing: 'ease',
  sideEffects({ active }) {
    active.node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: DROP_DURATION,
      easing: 'ease',
    });
  },
};

const measuringConfig: MeasuringConfiguration = {
  droppable: { strategy: MeasuringStrategy.Always },
};

// ---------------------------------------------------------------------------

function makeTask(): DayTask {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: random, text: '', status: 'todo' };
}

export function DaysMainPane({ day, carryForwardTasks = [], onPullForward, onUpdateFile, onUpdateTaskLists, onMoveTaskToDate, onNavigateToDate }: DaysMainPaneProps) {
  const [tasks, setTasks] = React.useState(() => day?.tasks ?? { today: [], next: [], someday: [] });
  const [activeTaskList, setActiveTaskList] = React.useState<TaskListKey>('today');
  const [scratch, setScratch] = React.useState(day?.bodies.scratch ?? '');
  const [journal, setJournal] = React.useState(day?.bodies.journal ?? '');
  const [focusedTaskId, setFocusedTaskId] = React.useState<string | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = React.useRef<Record<'scratch' | 'journal', ReturnType<typeof setTimeout> | null>>({ scratch: null, journal: null });

  React.useEffect(() => {
    if (!day) return;
    setTasks(day.tasks);
    setScratch(day.bodies.scratch);
    setJournal(day.bodies.journal);
  }, [day]);

  React.useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (noteTimerRef.current.scratch) clearTimeout(noteTimerRef.current.scratch);
    if (noteTimerRef.current.journal) clearTimeout(noteTimerRef.current.journal);
  }, []);

  const saveTasks = React.useCallback((nextTasks: typeof tasks, immediate = false) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const persistedTasks = {
      today: nextTasks.today.filter(task => task.text.trim().length > 0),
      next: nextTasks.next.filter(task => task.text.trim().length > 0),
      someday: nextTasks.someday.filter(task => task.text.trim().length > 0),
    };
    const run = () => onUpdateTaskLists?.(persistedTasks);
    if (immediate) run();
    else saveTimerRef.current = setTimeout(run, 500);
  }, [onUpdateTaskLists]);

  const updateTasks = React.useCallback((updater: (current: typeof tasks) => typeof tasks, immediate = false) => {
    setTasks(current => {
      const next = updater(current);
      saveTasks(next, immediate);
      return next;
    });
  }, [saveTasks]);

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
        <div className="grid gap-6">
          <TaskBoard
            activeList={activeTaskList}
            tasks={tasks}
            onActiveListChange={setActiveTaskList}
            focusedTaskId={focusedTaskId}
            onFocusTask={setFocusedTaskId}
            updateTasks={updateTasks}
            onMoveTaskToDate={onMoveTaskToDate}
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

function TaskBoard({
  activeList,
  tasks,
  onActiveListChange,
  focusedTaskId,
  onFocusTask,
  updateTasks,
  onMoveTaskToDate,
}: {
  activeList: TaskListKey;
  tasks: Record<TaskListKey, DayTask[]>;
  onActiveListChange: (list: TaskListKey) => void;
  focusedTaskId: string | null;
  onFocusTask: (taskId: string | null) => void;
  updateTasks: (updater: (current: Record<TaskListKey, DayTask[]>) => Record<TaskListKey, DayTask[]>, immediate?: boolean) => void;
  onMoveTaskToDate?: (task: DayTask, dateISO: string) => Promise<void> | void;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(SmartKeyboardSensor),
  );

  const addTask = () => {
    const task = makeTask();
    updateTasks(current => ({ ...current, [activeList]: [...current[activeList], task] }));
    onFocusTask(task.id);
  };

  const activeTasks = tasks[activeList];
  const activeTask = React.useMemo(() => activeTasks.find(t => t.id === activeId), [activeTasks, activeId]);

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    updateTasks(current => {
      const list = current[activeList];
      const oldIndex = list.findIndex(item => item.id === active.id);
      const newIndex = list.findIndex(item => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      return { ...current, [activeList]: arrayMove(list, oldIndex, newIndex) };
    }, true);
  }, [activeList, updateTasks]);

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null);
  }, []);

  return (
    <section className="space-y-3 pt-2">
      <div className="flex items-center justify-between pl-1">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-base font-semibold">Tasks</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-border/70 text-xs">
            {TASK_LISTS.map(list => (
              <button
                key={list}
                type="button"
                className={cn('h-7 px-3 capitalize text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground', activeList === list && 'bg-foreground/[0.07] text-foreground')}
                onClick={() => onActiveListChange(list)}
              >
                {list}
              </button>
            ))}
          </div>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        measuring={measuringConfig}
      >
        <SortableContext items={activeTasks} strategy={verticalListSortingStrategy}>
          <div className="overflow-hidden rounded-[8px] bg-background shadow-minimal">
            <div className="grid gap-0 divide-y divide-border/70">
              {activeTasks.length === 0 ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-5 text-left text-sm text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  onClick={addTask}
                >
                  <Plus className="h-4 w-4" />
                  Add a task
                </button>
              ) : activeTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  listKey={activeList}
                  shouldFocus={focusedTaskId === task.id}
                  onFocusTask={onFocusTask}
                  updateTasks={updateTasks}
                  onMoveTaskToDate={onMoveTaskToDate}
                  isOverlayActive={activeId !== null}
                />
              ))}
            </div>
          </div>
        </SortableContext>
        <DragOverlay
          dropAnimation={dropAnimationConfig}
          style={{ zIndex: 'var(--z-floating-menu, 400)' as unknown as number }}
        >
          {activeTask ? (
            <div
              className="rounded-[6px] bg-background"
              style={{ boxShadow: '0 0 0 1px rgba(63, 63, 68, 0.05), 0px 15px 15px 0 rgba(34, 33, 81, 0.25)' }}
            >
              <TaskRowContent task={activeTask} listKey={activeList} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function TaskRow({
  task,
  listKey,
  shouldFocus,
  onFocusTask,
  updateTasks,
  onMoveTaskToDate,
  isOverlayActive,
}: {
  task: DayTask;
  listKey: TaskListKey;
  shouldFocus: boolean;
  onFocusTask: (taskId: string | null) => void;
  updateTasks: (updater: (current: Record<TaskListKey, DayTask[]>) => Record<TaskListKey, DayTask[]>, immediate?: boolean) => void;
  onMoveTaskToDate?: (task: DayTask, dateISO: string) => Promise<void> | void;
  isOverlayActive: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && isOverlayActive ? 0 : 1,
  };

  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!shouldFocus) return;
    inputRef.current?.focus();
    const length = inputRef.current?.value.length ?? 0;
    inputRef.current?.setSelectionRange(length, length);
  }, [shouldFocus]);

  const updateTask = (patch: Partial<DayTask>, immediate = false) => {
    updateTasks(current => ({
      ...current,
      [listKey]: current[listKey].map(item => item.id === task.id ? { ...item, ...patch } : item),
    }), immediate);
  };

  const removeTask = () => {
    updateTasks(current => ({ ...current, [listKey]: current[listKey].filter(item => item.id !== task.id) }), true);
    onFocusTask(null);
  };

  const removeTaskAndFocusPrevious = () => {
    let previousTaskId: string | null = null;
    updateTasks(current => {
      const list = current[listKey];
      const index = list.findIndex(item => item.id === task.id);
      previousTaskId = index > 0 ? list[index - 1]?.id ?? null : null;
      return { ...current, [listKey]: list.filter(item => item.id !== task.id) };
    }, true);
    onFocusTask(previousTaskId);
  };

  const cycleStatus = () => {
    const currentIndex = STATUS_ORDER.indexOf(task.status);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length] ?? 'todo';
    updateTask({ status: nextStatus }, true);
  };

  const insertTaskAfter = () => {
    const nextTask = makeTask();
    updateTasks(current => {
      const index = current[listKey].findIndex(item => item.id === task.id);
      const nextList = [...current[listKey]];
      nextList.splice(index === -1 ? nextList.length : index + 1, 0, nextTask);
      return { ...current, [listKey]: nextList };
    });
    onFocusTask(nextTask.id);
  };

  const moveTaskToList = (targetList: TaskListKey) => {
    if (targetList === listKey) return;
    updateTasks(current => ({
      ...current,
      [listKey]: current[listKey].filter(item => item.id !== task.id),
      [targetList]: [...current[targetList], task],
    }), true);
    onFocusTask(null);
  };

  const moveTaskToDate = (dateISO: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
    updateTasks(current => ({ ...current, [listKey]: current[listKey].filter(item => item.id !== task.id) }), true);
    void onMoveTaskToDate?.(task, dateISO);
    onFocusTask(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      insertTaskAfter();
      return;
    }
    if (event.key === 'Backspace' && task.text.length === 0) {
      event.preventDefault();
      removeTaskAndFocusPrevious();
    }
  };

  const isMuted = task.status === 'completed' || task.status === 'canceled';
  const statusMeta = STATUS_OPTIONS.find(option => option.value === task.status) ?? DEFAULT_STATUS_OPTION;
  const StatusIcon = statusMeta.icon;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div className={cn('group/task flex cursor-grab items-center gap-2 px-3 py-2 active:cursor-grabbing', isMuted && 'opacity-55')}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-no-dnd="true"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                    onClick={cycleStatus}
                    aria-label={`Status: ${statusMeta.label}`}
                  >
                    <StatusIcon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {statusMeta.label}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <input
              ref={inputRef}
              data-no-dnd="true"
              className={cn('h-8 min-w-[4ch] max-w-full bg-transparent text-sm outline-none', isMuted && 'line-through')}
              style={{ width: `${Math.max(task.text.length, 4) + 1}ch` }}
              value={task.text}
              placeholder="Task"
              onFocus={() => onFocusTask(task.id)}
              onChange={event => updateTask({ text: event.target.value })}
              onBlur={() => updateTask({ text: task.text.trim() }, true)}
              onKeyDown={handleKeyDown}
            />
            <div className="flex-1" />
            <TaskOverflowMenu
              task={task}
              currentList={listKey}
              onSetStatus={(status) => updateTask({ status }, true)}
              onMoveToList={moveTaskToList}
              onMoveToDate={moveTaskToDate}
              onRemove={removeTask}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="popover-styled z-dropdown flex w-fit min-w-44 flex-col gap-0.5 overflow-hidden p-1 font-sans text-xs">
            <TaskContextMenuItems
              task={task}
              currentList={listKey}
              onSetStatus={(status) => updateTask({ status }, true)}
              onMoveToList={moveTaskToList}
              onMoveToDate={moveTaskToDate}
              onRemove={removeTask}
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

function TaskRowContent({ task, listKey }: { task: DayTask; listKey: TaskListKey }) {
  const isMuted = task.status === 'completed' || task.status === 'canceled';
  const statusMeta = STATUS_OPTIONS.find(option => option.value === task.status) ?? DEFAULT_STATUS_OPTION;
  const StatusIcon = statusMeta.icon;

  return (
    <div className={cn('flex cursor-grabbing items-center gap-2 px-3 py-2', isMuted && 'opacity-55')}>
      <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground">
        <StatusIcon className="h-4 w-4" />
      </div>
      <div className={cn('h-8 flex items-center text-sm', isMuted && 'line-through')}>
        {task.text || <span className="text-muted-foreground">Task</span>}
      </div>
    </div>
  );
}

function parseDateInput(text: string): { dateISO: string; label: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T12:00:00');
    return { dateISO: trimmed, label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) };
  }
  const parsed = chrono.parseDate(trimmed);
  if (!parsed) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return { dateISO: `${y}-${m}-${d}`, label: parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) };
}

function DateMoveInput({ onMove }: { onMove: (dateISO: string) => void }) {
  const [text, setText] = React.useState('');
  const result = React.useMemo(() => parseDateInput(text), [text]);

  const handleSubmit = () => {
    if (result) onMove(result.dateISO);
  };

  return (
    <div
      className="w-48 px-2 py-1.5"
      data-no-dnd="true"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="text-xs text-muted-foreground mb-1.5">Move to date</div>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder="tomorrow, next friday, jun 15..."
        className="mb-1.5 h-7 w-full rounded-md border border-border/70 bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {text && (result ? result.label : 'unrecognized date')}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!result}
          className="h-6 shrink-0 rounded-md bg-foreground/[0.07] px-2.5 text-xs font-medium hover:bg-foreground/[0.12] disabled:opacity-40"
        >
          Move
        </button>
      </div>
    </div>
  );
}

function TaskOverflowMenu({
  task,
  currentList,
  onSetStatus,
  onMoveToList,
  onMoveToDate,
  onRemove,
}: {
  task: DayTask;
  currentList: TaskListKey;
  onSetStatus: (status: DayTaskStatus) => void;
  onMoveToList: (list: TaskListKey) => void;
  onMoveToDate: (dateISO: string) => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-no-dnd="true"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.05] hover:text-foreground group-hover/task:opacity-100 data-[state=open]:opacity-100"
          aria-label="Task actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" minWidth="min-w-44">
        <DropdownMenuSub>
          <StyledDropdownMenuSubTrigger>Status</StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
            {STATUS_OPTIONS.map(option => (
              <StyledDropdownMenuItem key={option.value} onSelect={() => onSetStatus(option.value)}>
                <option.icon className="h-3.5 w-3.5" />
                <span>{option.label}</span>
                {task.status === option.value && <Check className="ml-auto h-3.5 w-3.5" />}
              </StyledDropdownMenuItem>
            ))}
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <StyledDropdownMenuSubTrigger>Move to</StyledDropdownMenuSubTrigger>
          <StyledDropdownMenuSubContent>
            {TASK_LISTS.map(list => (
              <StyledDropdownMenuItem key={list} onSelect={() => { if (list !== currentList) onMoveToList(list); }}>
                <span className="capitalize">{list}</span>
                {list === currentList && <Check className="ml-auto h-3.5 w-3.5" />}
              </StyledDropdownMenuItem>
            ))}
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onSelect={() => onMoveToDate(currentList === 'today' ? addDays(todayDateISO(), 1) : todayDateISO())}>
              {currentList === 'today' ? 'Tomorrow' : 'Today'}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <DateMoveInput onMove={onMoveToDate} />
          </StyledDropdownMenuSubContent>
        </DropdownMenuSub>
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem variant="destructive" onSelect={onRemove}>Remove</StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskContextMenuItems({
  task,
  currentList,
  onSetStatus,
  onMoveToList,
  onMoveToDate,
  onRemove,
}: {
  task: DayTask;
  currentList: TaskListKey;
  onSetStatus: (status: DayTaskStatus) => void;
  onMoveToList: (list: TaskListKey) => void;
  onMoveToDate: (dateISO: string) => void;
  onRemove: () => void;
}) {
  return (
    <>
      {STATUS_OPTIONS.map(option => (
        <ContextMenu.Item key={option.value} className={MENU_ITEM_CLASS} onSelect={() => onSetStatus(option.value)}>
          <option.icon className="h-3.5 w-3.5" />
          <span>{option.label}</span>
          {task.status === option.value && <Check className="ml-auto h-3.5 w-3.5" />}
        </ContextMenu.Item>
      ))}
      <ContextMenu.Separator className="bg-foreground/10 -mx-1 my-1 h-px" />
      {TASK_LISTS.map(list => (
        <ContextMenu.Item key={list} className={MENU_ITEM_CLASS} onSelect={() => { if (list !== currentList) onMoveToList(list); }}>
          <span>Move to <span className="capitalize">{list}</span></span>
          {list === currentList && <Check className="ml-auto h-3.5 w-3.5" />}
        </ContextMenu.Item>
      ))}
      <ContextMenu.Separator className="bg-foreground/10 -mx-1 my-1 h-px" />
      <ContextMenu.Item className={MENU_ITEM_CLASS} onSelect={() => onMoveToDate(currentList === 'today' ? addDays(todayDateISO(), 1) : todayDateISO())}>
        {currentList === 'today' ? 'Move to Tomorrow' : 'Move to Today'}
      </ContextMenu.Item>
      <ContextMenu.Separator className="bg-foreground/10 -mx-1 my-1 h-px" />
      <DateMoveInput onMove={onMoveToDate} />
      <ContextMenu.Separator className="bg-foreground/10 -mx-1 my-1 h-px" />
      <ContextMenu.Item className={cn(MENU_ITEM_CLASS, 'text-destructive focus:text-destructive hover:text-destructive')} onSelect={onRemove}>
        Remove
      </ContextMenu.Item>
    </>
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
