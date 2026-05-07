export function shouldReloadPopoverWorkspace(currentWorkspaceId: string | null, nextWorkspaceId: string | null): boolean {
  return currentWorkspaceId !== nextWorkspaceId
}
