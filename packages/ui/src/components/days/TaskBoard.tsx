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
import { Calendar, Check, ChevronRight, Circle, CircleDot, Forward, Inbox, Link2, MessageSquare, MoreHorizontal, Plus, Tag as TagIcon, X } from 'lucide-react';
import type { DayTask, DayTaskStatus } from '@craft-agent/shared/days';
import { addDays, todayDateISO } from '@craft-agent/shared/days/date';
import type { TaskListKind, TaskSource, TaskSourceRef } from '@craft-agent/shared/tasks';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';
import { cn } from '../../lib/utils';

export type TaskListKey = 'today' | 'next' | 'someday';
export type TaskBoardDensity = 'compact' | 'comfortable';

export interface TaskBoardTasks {
  today: DayTask[];
  next: DayTask[];
  someday: DayTask[];
}

/**
 * Per-task RPC layer used by TaskBoard. Implementations hit the server's
 * tasks.* and days.moveTask / days.updateTaskLists channels. TaskBoard manages
 * optimistic local state on top of these calls.
 */
export interface TaskBoardActions {
  /** Create a new task in the given list. Returns the created task or null on error. */
  add(list: TaskListKey): Promise<DayTask | null>;
  /** Update the title (called on blur or debounced). */
  updateTitle(id: string, title: string): Promise<void>;
  /** Cycle/set the status. */
  setStatus(id: string, status: DayTaskStatus): Promise<void>;
  /** Move to next/someday list. */
  moveToList(id: string, list: TaskListKind): Promise<void>;
  /** Move to a specific date. */
  moveToDate(id: string, dateISO: string): Promise<void>;
  /** Drop (soft-delete). */
  remove(id: string): Promise<void>;
  /** Persist a reordered list (IDs in slot order). */
  reorderList(list: TaskListKey, orderedIds: string[]): Promise<void>;
  /** Set or clear the due date. */
  setDue?(id: string, due: string | null): Promise<void>;
  /** Open the source of this task in the right panel. Optional; tray may omit. */
  openSource?(task: DayTask): void;
}

export interface TaskBoardProps {
  /** Anchor date for "Today/Tomorrow" semantics. */
  dateISO: string;
  /** Initial task lists; this is a controlled component. */
  tasks: TaskBoardTasks;
  /** Updater that mutates the controlled tasks state (optimistic). */
  setTasks: React.Dispatch<React.SetStateAction<TaskBoardTasks>>;
  /** RPC layer. */
  actions: TaskBoardActions;
  activeList: TaskListKey;
  onActiveListChange: (list: TaskListKey) => void;
  density?: TaskBoardDensity;
  /** Show "10/10" capacity warning on Today. */
  showCapacityWarning?: boolean;
  /** Hide the inline list-tab switcher (e.g. tray uses a single-list view). */
  hideListSwitcher?: boolean;
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
const SUBMENU_ITEM_CLASS = MENU_ITEM_CLASS;
const SUBMENU_TRIGGER_CLASS = 'relative flex cursor-default items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 pr-2 text-sm outline-hidden select-none hover:bg-foreground/[0.03] focus:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.03]';
const SUBMENU_CONTENT_CLASS = 'popover-styled z-dropdown flex w-fit min-w-44 flex-col gap-0.5 overflow-hidden p-1 font-sans text-xs';

// ─── dnd-kit setup ────────────────────────────────────────────────────────

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
    active.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DROP_DURATION, easing: 'ease' });
  },
};

const measuringConfig: MeasuringConfiguration = { droppable: { strategy: MeasuringStrategy.Always } };

// ─── public component ─────────────────────────────────────────────────────

export function TaskBoard({
  dateISO,
  tasks,
  setTasks,
  actions,
  activeList,
  onActiveListChange,
  density = 'comfortable',
  showCapacityWarning = true,
  hideListSwitcher = false,
}: TaskBoardProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(SmartKeyboardSensor),
  );

  const activeTasks = tasks[activeList];

  const addTask = async () => {
    if (showCapacityWarning && activeList === 'today' && activeTasks.length >= 10) {
      if (!globalThis.confirm?.('Today already has 10 slots. Add another commitment anyway?')) return;
    }
    const created = await actions.add(activeList);
    if (!created) return;
    setTasks(current => ({ ...current, [activeList]: [...current[activeList], created] }));
    setFocusedTaskId(created.id);
  };

  const persistReorder = React.useCallback((listKey: TaskListKey, orderedIds: string[]) => {
    void actions.reorderList(listKey, orderedIds);
  }, [actions]);

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setTasks(current => {
      const list = current[activeList];
      const oldIndex = list.findIndex(item => item.id === active.id);
      const newIndex = list.findIndex(item => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      const reordered = arrayMove(list, oldIndex, newIndex);
      persistReorder(activeList, reordered.map(t => t.id));
      return { ...current, [activeList]: reordered };
    });
  }, [activeList, persistReorder, setTasks]);

  const handleDragCancel = React.useCallback(() => setActiveId(null), []);

  const orderedIdsRef = React.useRef<Record<TaskListKey, string[]>>({
    today: tasks.today.map(t => t.id),
    next: tasks.next.map(t => t.id),
    someday: tasks.someday.map(t => t.id),
  });
  React.useEffect(() => {
    orderedIdsRef.current = {
      today: tasks.today.map(t => t.id),
      next: tasks.next.map(t => t.id),
      someday: tasks.someday.map(t => t.id),
    };
  }, [tasks]);

  const wrappedActions = React.useMemo<InternalActions>(() => ({
    optimisticUpdate(taskId, patch) {
      setTasks(current => {
        const next: TaskBoardTasks = {
          today: current.today.map(t => t.id === taskId ? { ...t, ...patch } : t),
          next: current.next.map(t => t.id === taskId ? { ...t, ...patch } : t),
          someday: current.someday.map(t => t.id === taskId ? { ...t, ...patch } : t),
        };
        return next;
      });
    },
    optimisticRemove(taskId) {
      setTasks(current => ({
        today: current.today.filter(t => t.id !== taskId),
        next: current.next.filter(t => t.id !== taskId),
        someday: current.someday.filter(t => t.id !== taskId),
      }));
    },
    optimisticMoveBetweenLists(taskId, fromList, toList) {
      setTasks(current => {
        const task = current[fromList].find(t => t.id === taskId);
        if (!task) return current;
        return {
          ...current,
          [fromList]: current[fromList].filter(t => t.id !== taskId),
          [toList]: [...current[toList], task],
        };
      });
    },
    actions,
    setFocusedTaskId,
    insertAfter(listKey, afterTaskId) {
      void (async () => {
        const created = await actions.add(listKey);
        if (!created) return;
        setTasks(current => {
          const list = current[listKey];
          const index = list.findIndex(t => t.id === afterTaskId);
          if (index === -1) return { ...current, [listKey]: [...list, created] };
          const next = [...list];
          next.splice(index + 1, 0, created);
          return { ...current, [listKey]: next };
        });
        setFocusedTaskId(created.id);
      })();
    },
    focusPrevious(listKey, beforeTaskId) {
      const list = tasks[listKey];
      const index = list.findIndex(t => t.id === beforeTaskId);
      const previous = index > 0 ? list[index - 1] : null;
      setFocusedTaskId(previous?.id ?? null);
    },
    focusNext(listKey, afterTaskId) {
      const list = tasks[listKey];
      const index = list.findIndex(t => t.id === afterTaskId);
      const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
      setFocusedTaskId(next?.id ?? null);
    },
  }), [actions, tasks, setTasks]);

  const activeTask = React.useMemo(() => activeTasks.find(t => t.id === activeId), [activeTasks, activeId]);

  const isCompact = density === 'compact';

  return (
    <section className={cn('space-y-3', isCompact ? 'pt-1' : 'pt-2')}>
      {!hideListSwitcher && (
        <div className="flex items-center justify-between pl-1">
          <div className="flex min-w-0 items-center gap-3">
            {!isCompact && <h2 className="text-base font-semibold">{activeList === 'today' ? 'Today Card' : 'Tasks'}</h2>}
            {showCapacityWarning && activeList === 'today' && (
              <span className="text-xs text-muted-foreground">{Math.min(activeTasks.length, 10)}/10</span>
            )}
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
      )}
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
                  className={cn('flex w-full items-center gap-2 text-left text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground', isCompact ? 'px-3 py-3 text-[13px]' : 'px-4 py-5 text-sm')}
                  onClick={() => void addTask()}
                >
                  <Plus className={cn(isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                  Add a task
                </button>
              ) : activeTasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  listKey={activeList}
                  dateISO={dateISO}
                  shouldFocus={focusedTaskId === task.id}
                  onFocusTask={setFocusedTaskId}
                  internal={wrappedActions}
                  isOverlayActive={activeId !== null}
                  density={density}
                  isOverCapacity={!isCompact && activeList === 'today' && index >= 10}
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
              <TaskRowContent task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {activeTasks.length > 0 && (
        <div className="flex items-center justify-end pr-1">
          <button
            type="button"
            className={cn('inline-flex items-center gap-1.5 rounded-md border border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground', isCompact ? 'h-7 px-2 text-[12px]' : 'h-8 px-2.5 text-xs')}
            onClick={() => void addTask()}
          >
            <Plus className={cn(isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
            Add task
          </button>
        </div>
      )}
    </section>
  );
}

// ─── internal types ───────────────────────────────────────────────────────

interface InternalActions {
  optimisticUpdate: (taskId: string, patch: Partial<DayTask>) => void;
  optimisticRemove: (taskId: string) => void;
  optimisticMoveBetweenLists: (taskId: string, from: TaskListKey, to: TaskListKey) => void;
  actions: TaskBoardActions;
  setFocusedTaskId: (id: string | null) => void;
  insertAfter: (listKey: TaskListKey, afterTaskId: string) => void;
  focusPrevious: (listKey: TaskListKey, beforeTaskId: string) => void;
  focusNext: (listKey: TaskListKey, afterTaskId: string) => void;
}

// ─── TaskRow ──────────────────────────────────────────────────────────────

function TaskRow({
  task,
  listKey,
  dateISO,
  shouldFocus,
  onFocusTask,
  internal,
  isOverlayActive,
  density,
  isOverCapacity,
}: {
  task: DayTask;
  listKey: TaskListKey;
  dateISO: string;
  shouldFocus: boolean;
  onFocusTask: (taskId: string | null) => void;
  internal: InternalActions;
  isOverlayActive: boolean;
  density: TaskBoardDensity;
  isOverCapacity: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && isOverlayActive ? 0 : 1,
  };
  const inputRef = React.useRef<HTMLInputElement>(null);
  const titleSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTitle = task.text;

  React.useEffect(() => {
    if (!shouldFocus) return;
    inputRef.current?.focus();
    const length = inputRef.current?.value.length ?? 0;
    inputRef.current?.setSelectionRange(length, length);
  }, [shouldFocus]);

  React.useEffect(() => () => {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
  }, []);

  const scheduleTitleSave = (newTitle: string) => {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => {
      void internal.actions.updateTitle(task.id, newTitle.trim());
    }, 500);
  };

  const flushTitleSave = (newTitle: string) => {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    void internal.actions.updateTitle(task.id, newTitle.trim());
  };

  const setStatus = (status: DayTaskStatus) => {
    internal.optimisticUpdate(task.id, { status });
    void internal.actions.setStatus(task.id, status);
  };

  const cycleStatus = () => {
    const i = STATUS_ORDER.indexOf(task.status);
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length] ?? 'todo';
    setStatus(next);
  };

  const moveToList = (target: TaskListKey) => {
    if (target === listKey) return;
    if (target === 'today') {
      internal.optimisticRemove(task.id);
      void internal.actions.moveToDate(task.id, dateISO);
      return;
    }
    internal.optimisticMoveBetweenLists(task.id, listKey, target);
    void internal.actions.moveToList(task.id, target as TaskListKind);
  };

  const moveToDate = (targetISO: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetISO)) return;
    internal.optimisticRemove(task.id);
    void internal.actions.moveToDate(task.id, targetISO);
  };

  const removeTask = () => {
    internal.optimisticRemove(task.id);
    void internal.actions.remove(task.id);
    onFocusTask(null);
  };

  const removeTaskAndFocusPrevious = () => {
    internal.focusPrevious(listKey, task.id);
    internal.optimisticRemove(task.id);
    void internal.actions.remove(task.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      flushTitleSave(localTitle);
      internal.insertAfter(listKey, task.id);
      return;
    }
    if (event.key === 'Backspace' && localTitle.length === 0) {
      event.preventDefault();
      removeTaskAndFocusPrevious();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      flushTitleSave(localTitle);
      inputRef.current?.blur();
      onFocusTask(null);
      return;
    }
    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      flushTitleSave(localTitle);
      internal.focusNext(listKey, task.id);
      return;
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault();
      flushTitleSave(localTitle);
      internal.focusPrevious(listKey, task.id);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      flushTitleSave(localTitle);
      setStatus(task.status === 'completed' ? 'todo' : 'completed');
      return;
    }
  };

  const isMuted = task.status === 'completed' || task.status === 'canceled';
  const statusMeta = STATUS_OPTIONS.find(option => option.value === task.status) ?? DEFAULT_STATUS_OPTION;
  const StatusIcon = statusMeta.icon;
  const isCompact = density === 'compact';
  const today = todayDateISO();
  const isOverdue = task.due && task.status !== 'completed' && task.status !== 'canceled' && task.due < today;
  const dueLabel = task.due ? formatDueLabel(task.due, today) : null;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div className={cn(
            'group/task flex cursor-grab items-center gap-2 active:cursor-grabbing',
            isCompact ? 'px-2 py-1.5' : 'px-3 py-2',
            isMuted && 'opacity-55',
            isOverCapacity && 'bg-amber-500/[0.05]',
          )}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-no-dnd="true"
                    className={cn('inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground', isCompact ? 'h-7 w-7' : 'h-8 w-8')}
                    onClick={cycleStatus}
                    aria-label={`Status: ${statusMeta.label}`}
                  >
                    <StatusIcon className={cn(isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{statusMeta.label}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <input
              ref={inputRef}
              data-no-dnd="true"
              className={cn('min-w-[4ch] max-w-full bg-transparent outline-none', isCompact ? 'h-7 text-[13px]' : 'h-8 text-sm', isMuted && 'line-through')}
              style={{ width: `${Math.max(localTitle.length, 4) + 1}ch` }}
              value={localTitle}
              placeholder="Task"
              onFocus={() => onFocusTask(task.id)}
              onChange={event => {
                const value = event.target.value;
                internal.optimisticUpdate(task.id, { text: value });
                scheduleTitleSave(value);
              }}
              onBlur={() => flushTitleSave(localTitle)}
              onKeyDown={handleKeyDown}
            />
            {dueLabel && (
              <span
                data-no-dnd="true"
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-border/60 bg-foreground/[0.03] px-1.5 py-0.5 text-[10px] tabular-nums',
                  isOverdue ? 'text-destructive border-destructive/40 bg-destructive/[0.05]' : 'text-muted-foreground',
                )}
                title={`Deadline ${task.due}`}
              >
                <Calendar className="h-3 w-3" />
                {dueLabel}
              </span>
            )}
            {task.tags && task.tags.length > 0 && !isCompact && (
              <span data-no-dnd="true" className="hidden xl:inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {task.tags.slice(0, 3).join(' ')}
              </span>
            )}
            {task.source && task.source !== 'manual' && internal.actions.openSource && (
              <button
                type="button"
                data-no-dnd="true"
                onClick={() => internal.actions.openSource?.(task)}
                className="inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                title={sourceLabel(task.source, task.source_ref)}
                aria-label={`Source: ${sourceLabel(task.source, task.source_ref)}`}
              >
                {sourceIcon(task.source)}
              </button>
            )}
            <div className="flex-1" />
            <DropdownTaskMenu
              task={task}
              currentList={listKey}
              dateISO={dateISO}
              onSetStatus={setStatus}
              onMoveToList={moveToList}
              onMoveToDate={moveToDate}
              onRemove={removeTask}
              onSetDue={internal.actions.setDue ? (due) => void internal.actions.setDue!(task.id, due) : undefined}
              compact={isCompact}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="popover-styled z-dropdown flex w-fit min-w-44 flex-col gap-0.5 overflow-hidden p-1 font-sans text-xs">
            <ContextTaskMenu
              task={task}
              currentList={listKey}
              dateISO={dateISO}
              onSetStatus={setStatus}
              onMoveToList={moveToList}
              onMoveToDate={moveToDate}
              onRemove={removeTask}
              onSetDue={internal.actions.setDue ? (due) => void internal.actions.setDue!(task.id, due) : undefined}
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

function TaskRowContent({ task }: { task: DayTask }) {
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

// ─── menus ────────────────────────────────────────────────────────────────

interface TaskMenuCommonProps {
  task: DayTask;
  currentList: TaskListKey;
  dateISO: string;
  onSetStatus: (status: DayTaskStatus) => void;
  onMoveToList: (list: TaskListKey) => void;
  onMoveToDate: (dateISO: string) => void;
  onRemove: () => void;
  onSetDue?: (due: string | null) => void;
}

function DropdownTaskMenu({ compact, ...props }: TaskMenuCommonProps & { compact: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-no-dnd="true"
          className={cn('inline-flex items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.05] hover:text-foreground group-hover/task:opacity-100 data-[state=open]:opacity-100', compact ? 'h-7 w-7' : 'h-8 w-8')}
          aria-label="Task actions"
        >
          <MoreHorizontal className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
        </button>
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end" minWidth="min-w-44">
        <TaskMenuBody {...props} variant="dropdown" />
      </StyledDropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextTaskMenu(props: TaskMenuCommonProps) {
  return <TaskMenuBody {...props} variant="context" />;
}

/**
 * Shared menu structure used by both Dropdown and Context variants. Both
 * render nested submenus (Status, Move to, Due) by passing the appropriate
 * Radix primitives into the same JSX tree.
 */
function TaskMenuBody({
  task,
  currentList,
  dateISO,
  onSetStatus,
  onMoveToList,
  onMoveToDate,
  onRemove,
  onSetDue,
  variant,
}: TaskMenuCommonProps & { variant: 'dropdown' | 'context' }) {
  const Sub = variant === 'dropdown' ? DropdownMenuSub : ContextMenu.Sub;
  const SubTrigger: React.ComponentType<{ children: React.ReactNode }> = variant === 'dropdown'
    ? StyledDropdownMenuSubTrigger as unknown as React.ComponentType<{ children: React.ReactNode }>
    : (innerProps) => (
        <ContextMenu.SubTrigger className={SUBMENU_TRIGGER_CLASS}>
          <span className="flex-1">{innerProps.children}</span>
          <ChevronRight className="ml-auto size-4 shrink-0" />
        </ContextMenu.SubTrigger>
      );
  const SubContent: React.ComponentType<{ children: React.ReactNode }> = variant === 'dropdown'
    ? StyledDropdownMenuSubContent as unknown as React.ComponentType<{ children: React.ReactNode }>
    : (innerProps) => (
        <ContextMenu.Portal>
          <ContextMenu.SubContent className={SUBMENU_CONTENT_CLASS}>{innerProps.children}</ContextMenu.SubContent>
        </ContextMenu.Portal>
      );
  const Item: React.ComponentType<{ onSelect?: () => void; variant?: 'destructive'; children: React.ReactNode; disabled?: boolean }> = variant === 'dropdown'
    ? StyledDropdownMenuItem as unknown as React.ComponentType<{ onSelect?: () => void; variant?: 'destructive'; children: React.ReactNode; disabled?: boolean }>
    : (innerProps) => (
        <ContextMenu.Item
          className={cn(MENU_ITEM_CLASS, innerProps.variant === 'destructive' && 'text-destructive focus:text-destructive hover:text-destructive')}
          onSelect={innerProps.onSelect}
          disabled={innerProps.disabled}
        >
          {innerProps.children}
        </ContextMenu.Item>
      );
  const Separator: React.ComponentType = variant === 'dropdown'
    ? StyledDropdownMenuSeparator
    : () => <ContextMenu.Separator className="bg-foreground/10 -mx-1 my-1 h-px" />;

  return (
    <>
      <Sub>
        <SubTrigger>Status</SubTrigger>
        <SubContent>
          {STATUS_OPTIONS.map(option => (
            <Item key={option.value} onSelect={() => onSetStatus(option.value)}>
              <option.icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
              {task.status === option.value && <Check className="ml-auto h-3.5 w-3.5" />}
            </Item>
          ))}
        </SubContent>
      </Sub>
      <Sub>
        <SubTrigger>Move to</SubTrigger>
        <SubContent>
          {(['today', 'next', 'someday'] as TaskListKey[]).map(list => (
            <Item key={list} onSelect={() => onMoveToList(list)}>
              <span className="capitalize">{list}</span>
              {list === currentList && <Check className="ml-auto h-3.5 w-3.5" />}
            </Item>
          ))}
          <Separator />
          <Item onSelect={() => onMoveToDate(currentList === 'today' ? addDays(dateISO, 1) : dateISO)}>
            {currentList === 'today' ? 'Tomorrow' : 'Today'}
          </Item>
          <Separator />
          <DateMoveInput onMove={onMoveToDate} />
        </SubContent>
      </Sub>
      {onSetDue && (
        <Sub>
          <SubTrigger>{task.due ? `Deadline ${formatShortDate(task.due)}` : 'Set deadline'}</SubTrigger>
          <SubContent>
            <Item onSelect={() => onSetDue(todayDateISO())}>Today</Item>
            <Item onSelect={() => onSetDue(addDays(todayDateISO(), 1))}>Tomorrow</Item>
            <Item onSelect={() => onSetDue(addDays(todayDateISO(), 7))}>Next week</Item>
            <Separator />
            <DateInputRow
              placeholder="tomorrow, jun 15..."
              label="Set deadline"
              onCommit={(d) => onSetDue(d)}
            />
            {task.due && (
              <>
                <Separator />
                <Item onSelect={() => onSetDue(null)}>Clear deadline</Item>
              </>
            )}
          </SubContent>
        </Sub>
      )}
      <Separator />
      <Item variant="destructive" onSelect={onRemove}>Remove</Item>
    </>
  );
}

function DateMoveInput({ onMove }: { onMove: (dateISO: string) => void }) {
  return <DateInputRow placeholder="tomorrow, next friday, jun 15..." label="Move to date" onCommit={onMove} />;
}

function DateInputRow({ placeholder, label, onCommit }: { placeholder: string; label: string; onCommit: (dateISO: string) => void }) {
  const [text, setText] = React.useState('');
  const [debouncedText, setDebouncedText] = React.useState('');
  React.useEffect(() => {
    const handle = setTimeout(() => setDebouncedText(text), 120);
    return () => clearTimeout(handle);
  }, [text]);
  const result = React.useMemo(() => parseDateInput(debouncedText), [debouncedText]);
  const liveResult = React.useMemo(() => parseDateInput(text), [text]);

  const handleSubmit = () => {
    if (liveResult) onCommit(liveResult.dateISO);
  };

  return (
    <div
      className="w-48 px-2 py-1.5"
      data-no-dnd="true"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder={placeholder}
        className="mb-1.5 h-7 w-full rounded-md border border-border/70 bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {text && (result ? result.label : 'unrecognized date')}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!liveResult}
          className="h-6 shrink-0 rounded-md bg-foreground/[0.07] px-2.5 text-xs font-medium hover:bg-foreground/[0.12] disabled:opacity-40"
        >
          Set
        </button>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

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

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDueLabel(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDays(today, 1)) return 'Tmrw';
  if (due < today) return formatShortDate(due);
  return formatShortDate(due);
}

function sourceIcon(source: TaskSource): React.ReactNode {
  switch (source) {
    case 'capture': return <Inbox className="h-3 w-3" />;
    case 'session': return <MessageSquare className="h-3 w-3" />;
    case 'follow-up': return <Link2 className="h-3 w-3" />;
    case 'meeting': return <Calendar className="h-3 w-3" />;
    default: return <Link2 className="h-3 w-3" />;
  }
}

function sourceLabel(source: TaskSource, ref?: TaskSourceRef): string {
  if (source === 'capture') return 'From capture';
  if (source === 'session') return ref?.type === 'message' ? 'From session message' : 'From session';
  if (source === 'follow-up') return 'From follow-up';
  if (source === 'meeting') return 'From meeting';
  return 'Source';
}

export { STATUS_OPTIONS, parseDateInput, formatShortDate };
