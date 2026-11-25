import type { AppearanceSettings, Bookmark, Category } from '~/lib/types'
import { useDraggable } from '@dnd-kit/core'
import { ChevronRight, GripVertical, Pencil } from 'lucide-react'

import { useCallback } from 'react'
import { useMovePending } from '~/components/BookmarkDragDropContext'
import { CategoryIcon } from '~/components/category-tabs/CategoryIcon'
import { FolderGraphic } from '~/components/FolderGraphic'
import { useCategoryDropTarget } from '~/components/useCategoryDropTarget'
import {
  cardActionsClass,
  cardActionsHoverClass,
  cardStyleClass,
  compactCardShellClass,
  compactSecondaryClass,
  radiusClass,
} from '~/lib/appearance'
import { DEFAULT_CATEGORY_EMOJI } from '~/lib/default-data'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface CategoryCardProps {
  category: Category
  bookmarkCount: number
  childCategoryCount: number
  previewBookmarks?: Bookmark[]
  onEdit: (category: Category) => void
  locationLabel?: string
  onOpen?: (category: Category) => void
  appearance: AppearanceSettings
  compact?: boolean
}

export function CategoryCard({
  category,
  bookmarkCount,
  childCategoryCount,
  previewBookmarks,
  onEdit,
  locationLabel,
  onOpen,
  appearance,
  compact = false,
}: CategoryCardProps) {
  const { t } = useI18n()
  const setActiveCategory = useNavStore(s => s.setActiveCategory)
  const movePending = useMovePending()
  const {
    attributes,
    listeners,
    isDragging,
    setActivatorNodeRef,
    setNodeRef: setDragNodeRef,
  } = useDraggable({
    id: `category:${category.id}`,
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
    'card',
  )
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragNodeRef(node)
      setDropNodeRef(node)
    },
    [setDragNodeRef, setDropNodeRef],
  )
  const parts = [
    bookmarkCount > 0 ? t('folderBookmarkCount', { count: bookmarkCount }) : '',
    childCategoryCount > 0 ? t('subfolderCount', { count: childCategoryCount }) : '',
  ].filter(Boolean)
  // 精簡模式與書籤列一致：標題為主欄，數量或位置放在固定寬度的次要欄
  const compactSecondary = locationLabel || parts.join(' · ')

  return (
    <div
      ref={setNodeRef}
      data-card-key={`folder:${category.id}`}
      data-layout={compact ? 'compact' : 'card'}
      className={cn(
        'folder-card group relative flex [content-visibility:auto] transition-[background-color,border-color,box-shadow,transform] duration-200',
        compact ? 'min-h-[48px] [contain-intrinsic-size:48px] pr-[4.25rem]' : 'min-h-card-grid [contain-intrinsic-size:76px]',
        compact && compactCardShellClass,
        cardStyleClass[appearance.cardStyle],
        radiusClass[appearance.radius],
        isDragging && 'opacity-20 scale-[0.98]',
        isOver
        && validation?.status === 'valid'
        && 'bg-accent ring-2 ring-ring',
        isOver
        && validation?.status === 'invalid'
        && 'bg-destructive/10 ring-2 ring-destructive/70',
        isOver && validation?.status === 'noop' && 'ring-2 ring-border',
      )}
    >
      <button
        data-nav-item
        type="button"
        onClick={() =>
          onOpen ? onOpen(category) : setActiveCategory(category.id)}
        aria-label={t('openFolder', { name: category.name })}
        className={compact ? 'flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring' : 'flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 pr-16 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'}
      >
        {appearance.cardFields.websiteIcon
          ? (compact
              ? (
                  // 精簡資料夾列沿用小型分類圖示，但仍標記為資料夾卡片圖示，
                  // 讓「卡片圖示」開關在兩種檢視模式下有同一個可辨識的圖示槽位。
                  <span data-slot="folder-card-icon" className="flex shrink-0">
                    <CategoryIcon category={category} active={false} />
                  </span>
                )
              : (
                  <FolderGraphic
                    appearance={appearance}
                    emoji={category.emoji === DEFAULT_CATEGORY_EMOJI ? undefined : category.emoji}
                    previewBookmarks={previewBookmarks}
                  />
                ))
          : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span data-field="title" className="bookmark-card-title truncate text-card-title font-medium leading-snug tracking-[-0.01em] group-hover:text-primary transition-colors">
              {category.name}
            </span>
            {!compact
              ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              : null}
          </div>
          {locationLabel && !compact
            ? (
                <p
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={locationLabel}
                >
                  {locationLabel}
                </p>
              )
            : null}
          {parts.length > 0 && !compact
            ? (
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  {parts.join(' · ')}
                </p>
              )
            : null}
        </div>

        {compact
          ? (
              <span
                data-field="secondary"
                className={cn(compactSecondaryClass, 'text-2xs')}
                title={compactSecondary || undefined}
                aria-hidden={compactSecondary ? undefined : true}
              >
                {compactSecondary}
              </span>
            )
          : null}
      </button>

      {category.modifiable
        ? (
            <div className={cn(cardActionsClass, cardActionsHoverClass)}>
              <button
                ref={setActivatorNodeRef}
                type="button"
                disabled={movePending}
                {...attributes}
                {...listeners}
                title={t('dragFolder')}
                aria-label={t('dragNamedFolder', { name: category.name })}
                className="flex size-6 touch-none items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 active:cursor-grabbing"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onEdit(category)}
                title={t('editFolder')}
                aria-label={t('editNamedFolder', { name: category.name })}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )
        : null}
    </div>
  )
}
