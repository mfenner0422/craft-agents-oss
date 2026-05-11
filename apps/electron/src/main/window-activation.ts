export interface ActivationWindowLike {
  isDestroyed(): boolean
  isVisible(): boolean
}

export interface ActivationManagedWindow<TWindow extends ActivationWindowLike = ActivationWindowLike> {
  window: TWindow
  workspaceId: string
}

export function hasVisibleUnmanagedWindow<TWindow extends ActivationWindowLike>(
  allWindows: TWindow[],
  managedWindows: ActivationManagedWindow<TWindow>[],
): boolean {
  const managed = new Set(managedWindows.map(({ window }) => window))
  return allWindows.some(window => !window.isDestroyed() && window.isVisible() && !managed.has(window))
}

export function selectWorkspaceForEmptyAppActivation({
  workspaceIds,
  lastFocusedWorkspaceId,
  savedLastFocusedWorkspaceId,
}: {
  workspaceIds: string[]
  lastFocusedWorkspaceId: string | null
  savedLastFocusedWorkspaceId?: string
}): string | null {
  if (lastFocusedWorkspaceId && workspaceIds.includes(lastFocusedWorkspaceId)) return lastFocusedWorkspaceId
  if (savedLastFocusedWorkspaceId && workspaceIds.includes(savedLastFocusedWorkspaceId)) return savedLastFocusedWorkspaceId
  return workspaceIds[0] ?? null
}

export function selectWorkspaceForHiddenWindowActivation({
  managedWindows,
  workspaceIds,
  lastFocusedWorkspaceId,
}: {
  managedWindows: Array<ActivationManagedWindow>
  workspaceIds: string[]
  lastFocusedWorkspaceId: string | null
}): string | null {
  if (lastFocusedWorkspaceId && workspaceIds.includes(lastFocusedWorkspaceId)) return lastFocusedWorkspaceId
  return managedWindows[0]?.workspaceId ?? workspaceIds[0] ?? null
}
