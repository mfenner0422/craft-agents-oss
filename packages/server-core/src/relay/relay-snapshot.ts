import { addDays, todayDateISO } from '@craft-agent/shared/days/date'
import { RPC_CHANNELS, type RelaySnapshot } from '@craft-agent/shared/protocol'
import type { RequestContext, RpcServer } from '../transport/types'

export async function createRelaySnapshots(server: RpcServer, workspaceId: string): Promise<RelaySnapshot[]> {
  if (!server.dispatch) return []
  const ctx: RequestContext = { clientId: 'relay:snapshot', workspaceId, webContentsId: null }
  const now = new Date().toISOString()
  const snapshots: RelaySnapshot[] = []

  const tasks = await server.dispatch(RPC_CHANNELS.tasks.LIST, ctx, [workspaceId])
  snapshots.push({ kind: 'tasks', payload: tasks, version: Date.now(), capturedAt: now })

  const inbox = await server.dispatch(RPC_CHANNELS.capture.LIST, ctx, [workspaceId])
  snapshots.push({ kind: 'inbox', payload: inbox, version: Date.now(), capturedAt: now })

  for (let offset = -3; offset <= 7; offset++) {
    const dateISO = addDays(todayDateISO(), offset)
    const day = await server.dispatch(RPC_CHANNELS.days.GET_BOARD, ctx, [workspaceId, dateISO])
    snapshots.push({ kind: 'day', key: dateISO, payload: day, version: Date.now(), capturedAt: now })
  }

  return snapshots
}
