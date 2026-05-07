import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { DaysTrayPopover } from './DaysTrayPopover'

function getWorkspaceId(): string {
  return new URLSearchParams(window.location.search).get('workspaceId') ?? ''
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DaysTrayPopover initialWorkspaceId={getWorkspaceId()} />
  </React.StrictMode>,
)
