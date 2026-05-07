import { describe, expect, it } from 'bun:test'
import type { Route } from '../../../shared/routes'
import { createDaysTrayNavigateHandler } from '../navigation'

describe('createDaysTrayNavigateHandler', () => {
  it('navigates to the selected day and records it for the active workspace', () => {
    const routes: Route[] = []
    const selections: Array<{ dateISO: string; workspaceId: string }> = []
    const handler = createDaysTrayNavigateHandler({
      activeWorkspaceId: 'workspace-1',
      navigate: route => routes.push(route),
      setLastSelectedDay: (dateISO, workspaceId) => selections.push({ dateISO, workspaceId }),
    })

    handler('2026-05-07')

    expect(routes).toEqual(['days/2026-05-07'])
    expect(selections).toEqual([{ dateISO: '2026-05-07', workspaceId: 'workspace-1' }])
  })

  it('opens the Days root without recording a selection when no date is provided', () => {
    const routes: Route[] = []
    const selections: Array<{ dateISO: string; workspaceId: string }> = []
    const handler = createDaysTrayNavigateHandler({
      activeWorkspaceId: 'workspace-1',
      navigate: route => routes.push(route),
      setLastSelectedDay: (dateISO, workspaceId) => selections.push({ dateISO, workspaceId }),
    })

    handler()

    expect(routes).toEqual(['days'])
    expect(selections).toEqual([])
  })
})
