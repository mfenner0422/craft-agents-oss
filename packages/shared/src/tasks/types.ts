export type TaskStatus = 'todo' | 'in_progress' | 'delegated' | 'completed' | 'canceled';
export type ActiveTaskStatus = 'todo' | 'in_progress' | 'delegated';
export type TerminalTaskStatus = 'completed' | 'canceled';
export type TaskListKind = 'next' | 'someday';
export type TaskSource = 'manual' | 'capture' | 'follow-up' | 'session' | 'meeting';

export type TaskSourceRef =
  | { type: 'capture'; path: string }
  | { type: 'session'; id: string }
  | { type: 'message'; sessionId: string; messageId: string }
  | { type: 'manual' };

export interface TaskCommitHistoryEntry {
  from_day: string | null;
  to_day: string | null;
  at: string;
  reason: string;
  status_from?: TaskStatus;
  status_to?: TaskStatus;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  day: string | null;
  slot?: number;
  list: TaskListKind | null;
  source: TaskSource;
  source_ref?: TaskSourceRef;
  due?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  canceled_at?: string;
  dropped_at?: string;
  committed_history: TaskCommitHistoryEntry[];
  tags: string[];
  body: string;
  filePath?: string;
}

export interface TaskCreateInput {
  id?: string;
  title: string;
  status?: TaskStatus;
  day?: string | null;
  slot?: number;
  list?: TaskListKind | null;
  source?: TaskSource;
  source_ref?: TaskSourceRef;
  due?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  canceled_at?: string;
  dropped_at?: string;
  committed_history?: TaskCommitHistoryEntry[];
  tags?: string[];
  body?: string;
}

export interface TaskListFilter {
  day?: string | null;
  list?: TaskListKind | null;
  status?: TaskStatus | TaskStatus[];
  tag?: string;
  activeOnly?: boolean;
}

export type TaskPromoteTarget =
  | { kind: 'day'; dateISO: string; slot?: number; reason?: string }
  | { kind: 'next'; reason?: string }
  | { kind: 'someday'; reason?: string }
  | { kind: 'drop'; reason?: string };

export function isActiveTaskStatus(status: TaskStatus): status is ActiveTaskStatus {
  return status === 'todo' || status === 'in_progress' || status === 'delegated';
}

export function isTerminalTaskStatus(status: TaskStatus): status is TerminalTaskStatus {
  return status === 'completed' || status === 'canceled';
}

export function validateTask(task: TaskRecord): void {
  if (!task.id.trim()) throw new Error('Task id is required');
  // Title may be transiently empty (a brand-new task before the user types).
  // The renderer treats blur-with-empty-title as a drop, so an empty title
  // never persists for long.
  if (!['todo', 'in_progress', 'delegated', 'completed', 'canceled'].includes(task.status)) {
    throw new Error(`Task ${task.id} has invalid status: ${String(task.status)}`);
  }
  if (task.day != null && !/^\d{4}-\d{2}-\d{2}$/.test(task.day)) {
    throw new Error(`Task ${task.id} has invalid day: ${task.day}`);
  }
  if (task.list != null && task.list !== 'next' && task.list !== 'someday') {
    throw new Error(`Task ${task.id} has invalid list: ${String(task.list)}`);
  }
  if (task.slot != null && (!Number.isInteger(task.slot) || task.slot < 1)) {
    throw new Error(`Task ${task.id} has invalid slot: ${String(task.slot)}`);
  }
  if (task.due != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.due)) throw new Error(`Task ${task.id} has invalid due: ${task.due}`);
    if (task.day != null && task.due < task.day) throw new Error(`Task ${task.id} due (${task.due}) is before its day (${task.day})`);
  }

  if (task.dropped_at) {
    if (task.status !== 'canceled') throw new Error(`Dropped task ${task.id} must be canceled`);
    if (task.day != null || task.list != null || task.slot != null) {
      throw new Error(`Dropped task ${task.id} must not keep day, list, or slot`);
    }
    if (!task.canceled_at) throw new Error(`Dropped task ${task.id} must set canceled_at`);
    return;
  }

  if (isActiveTaskStatus(task.status)) {
    const hasDay = task.day != null;
    const hasList = task.list != null;
    if (hasDay === hasList) throw new Error(`Active task ${task.id} must have exactly one of day or list`);
    if (hasDay && task.slot == null) throw new Error(`Committed task ${task.id} must have a slot`);
    if (!hasDay && task.slot != null) throw new Error(`Listed task ${task.id} must not have a slot`);
    if (task.completed_at || task.canceled_at) throw new Error(`Active task ${task.id} must not have terminal timestamps`);
    return;
  }

  if (task.status === 'completed' && !task.completed_at) throw new Error(`Completed task ${task.id} must set completed_at`);
  if (task.status === 'canceled' && !task.canceled_at) throw new Error(`Canceled task ${task.id} must set canceled_at`);
}
