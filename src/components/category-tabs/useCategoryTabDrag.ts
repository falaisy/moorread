import type { Category } from '~/lib/types'

import { useDraggable } from '@dnd-kit/core'
import { useCallback } from 'react'
import { useMovePending } from '~/components/BookmarkDragDropContext'
import { useCategoryDropTarget } from '~/components/useCategoryDropTarget'

export function useCategoryTabDrag(category: Category) {
  const movePending = useMovePending()
  const {
    attributes,
    listeners,
    isDragging,
    setActivatorNodeRef,
    setNodeRef: setDragNodeRef,
  } = useDraggable({
    id: `category-sidebar:${category.id}`,
    disabled: !category.modifiable || movePending,
    data: {
      type: 'category',
      categoryId: category.id,
      parentId: category.parentId,
      label: category.name,
      emoji: category.emoji,
    },
  })
  const { isOver, setDropNodeRef, validation } = useCategoryDropTarget(
    category,
    'sidebar',
  )
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragNodeRef(node)
      setDropNodeRef(node)
    },
    [setDragNodeRef, setDropNodeRef],
  )

  return {
    attributes,
    isDragging,
    isOver,
    listeners,
    movePending,
    setActivatorNodeRef,
    setNodeRef,
    validation,
  }
}
