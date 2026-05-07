import { routes, type Route } from '../../shared/routes'

export interface DaysTrayNavigateHandlerOptions {
  activeWorkspaceId: string | null | undefined
  navigate: (route: Route) => void
  setLastSelectedDay: (dateISO: string, workspaceId: string) => void
}

export function createDaysTrayNavigateHandler(options: DaysTrayNavigateHandlerOptions): (dateISO?: string) => void {
  return (dateISO?: string) => {
    if (dateISO && options.activeWorkspaceId) {
      options.setLastSelectedDay(dateISO, options.activeWorkspaceId)
    }
    options.navigate(routes.view.days(dateISO))
  }
}
