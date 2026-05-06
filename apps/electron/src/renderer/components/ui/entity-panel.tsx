/**
 * EntityPanel<T> — Config-driven entity list with built-in keyboard nav + multi-select.
 *
 * Wraps EntityList + EntityRow + useEntityListInteractions so consumers
 * only provide a data mapping via `mapItem`.
 */

import * as React from 'react'
import { useAction } from '@/actions'
import { EntityList, type EntityListGroup } from './entity-list'
import { EntityRow } from './entity-row'
import { useEntityListInteractions } from '@/hooks/useEntityListInteractions'
import type { createEntitySelection } from '@/hooks/useEntitySelection'

export interface EntityPanelItem {
  icon?: React.ReactNode
  title: React.ReactNode
  badges?: React.ReactNode
  trailing?: React.ReactNode
  menu?: React.ReactNode
  dataAttributes?: Record<string, string | undefined>
}

export interface EntityPanelProps<T> {
  items: T[]
  /**
   * Optional grouped layout. When provided, EntityList renders section headers.
   * `groups` must contain the same items as `items` in the same flat order
   * (i.e. `groups.flatMap(g => g.items)` should equal `items`) so keyboard
   * navigation indices stay in sync.
   */
  groups?: EntityListGroup<T>[]
  /** Set of collapsed group keys (only used when `groups` is set and group.collapsible is true) */
  collapsedGroups?: Set<string>
  /** Called when a collapsible group header is clicked */
  onToggleCollapse?: (groupKey: string) => void
  /** Collapse every collapsible group */
  onCollapseAll?: () => void
  /** Expand every collapsible group */
  onExpandAll?: () => void
  getId: (item: T) => string
  mapItem: (item: T) => EntityPanelItem
  selection: ReturnType<typeof createEntitySelection>
  onItemClick: (item: T) => void
  selectedId?: string | null
  emptyState?: React.ReactNode
  className?: string
}

export function EntityPanel<T>({
  items,
  groups,
  collapsedGroups,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  getId,
  mapItem,
  selection,
  onItemClick,
  selectedId,
  emptyState,
  className,
}: EntityPanelProps<T>) {
  const selectionStore = selection.useSelectionStore()
  const interactions = useEntityListInteractions<T>({
    items,
    getId,
    keyboard: {
      onNavigate: (item) => onItemClick(item),
      onActivate: (item) => onItemClick(item),
    },
    multiSelect: true,
    selectionStore,
  })

  useAction('navigator.clearSelection', () => {
    interactions.selection.clear()
  }, {
    enabled: () => interactions.selection.isMultiSelectActive,
  }, [interactions.selection])

  // When grouped, EntityList passes per-group indices to renderItem; we resolve
  // the flat index from this map so keyboard navigation stays in sync.
  const flatIndexById = React.useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item, idx) => map.set(getId(item), idx))
    return map
  }, [items, getId])

  const renderItem = (item: T, indexFromList: number, isFirst: boolean) => {
    const mapped = mapItem(item)
    const flatIndex = groups ? (flatIndexById.get(getId(item)) ?? indexFromList) : indexFromList
    const rowProps = interactions.getRowProps(item, flatIndex)
    return (
      <EntityRow
        icon={mapped.icon}
        title={mapped.title}
        badges={mapped.badges}
        trailing={mapped.trailing}
        isSelected={selectedId === getId(item)}
        isInMultiSelect={rowProps.isInMultiSelect}
        showSeparator={!isFirst}
        onMouseDown={(e) => {
          rowProps.onMouseDown(e)
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 2) {
            onItemClick(item)
          }
        }}
        buttonProps={rowProps.buttonProps}
        menuContent={mapped.menu}
        dataAttributes={mapped.dataAttributes}
      />
    )
  }

  if (groups) {
    return (
      <EntityList
        groups={groups}
        getKey={getId}
        containerRef={interactions.listProps.containerRef}
        containerProps={interactions.listProps.containerProps}
        className={className}
        emptyState={emptyState}
        renderItem={renderItem}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={onToggleCollapse}
        onCollapseAll={onCollapseAll}
        onExpandAll={onExpandAll}
      />
    )
  }

  return (
    <EntityList
      items={items}
      getKey={getId}
      containerRef={interactions.listProps.containerRef}
      containerProps={interactions.listProps.containerProps}
      className={className}
      emptyState={emptyState}
      renderItem={renderItem}
    />
  )
}
