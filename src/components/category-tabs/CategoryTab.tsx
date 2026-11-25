import type { ReactNode } from 'react'
import type { Category } from '~/lib/types'

import { GripVertical, Pencil } from 'lucide-react'
import { CategoryIcon } from '~/components/category-tabs/CategoryIcon'
import { useCategoryTabDrag } from '~/components/category-tabs/useCategoryTabDrag'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface CategoryTabProps {
  accessibleName?: string
  category: Category
  active: boolean
  count: number
  onSelect: (id: string) => void
  onEdit: (category: Category) => void
  fullWidth: boolean
  showCount: boolean
  showIcon: boolean
  leadingControl?: ReactNode
  reserveLeadingSpace?: boolean
  compact?: boolean
  hasChildren?: boolean
}

export function CategoryTab({
  accessibleName,
  category,
  active,
  count,
  onSelect,
  onEdit,
  fullWidth,
  showCount,
  showIcon,
  leadingControl,
  reserveLeadingSpace = false,
  compact = false,
}: CategoryTabProps) {
  const { categoryName, t } = useI18n()
  const label = accessibleName ?? categoryName(category)
  const {
    attributes,
    listeners,
    isDragging,
    isOver,
    movePending,
    setActivatorNodeRef,
    setNodeRef,
    validation,
  } = useCategoryTabDrag(category)

  const selectButton = (
    <button
      type="button"
      aria-label={label}
      onClick={() => onSelect(category.id)}
      aria-pressed={active}
      title={compact ? undefined : label}
      className={cn(
        'flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-2.5 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        !compact && (leadingControl || reserveLeadingSpace) && 'lg:pl-0',
        compact && 'justify-center pl-0 pr-0',
      )}
    >
      {showIcon ? <CategoryIcon category={category} active={active} compact={compact} /> : null}
      {!compact && (
        <>
          <span
            className="min-w-0 flex-1 truncate text-xs-md"
          >
            {categoryName(category)}
          </span>
          {showCount && count > 0
            ? (
                <span
                  className={cn(
                    'ml-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground transition-opacity',
                    category.modifiable
                    && 'group-hover:opacity-0 group-focus-within:opacity-0',
                    active && 'text-accent-foreground',
                  )}
                >
                  {count}
                </span>
              )
            : null}
        </>
      )}
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      data-category-tab
      data-active={active || undefined}
      className={cn(
        'group relative flex h-9 shrink-0 items-center gap-1 rounded-lg text-sm transition-all duration-150',
        fullWidth && 'lg:w-full',
        active
          ? compact
            ? 'bg-primary/10 text-primary shadow-sm ring-2 ring-primary/40'
            : 'bg-accent font-medium text-accent-foreground shadow-sm ring-1 ring-ring/30'
          : 'text-foreground/75 hover:bg-accent/65 hover:text-foreground',
        isDragging && 'opacity-20 scale-[0.98]',
        isOver
        && validation?.status === 'valid'
        && 'bg-accent text-foreground ring-2 ring-ring',
        isOver
        && validation?.status === 'invalid'
        && 'bg-destructive/10 text-destructive ring-2 ring-destructive/70',
        isOver && validation?.status === 'noop' && 'ring-2 ring-border',
      )}
    >
      {!compact && (leadingControl ?? (reserveLeadingSpace
        ? <span aria-hidden="true" className="hidden size-7 shrink-0 lg:block" />
        : null))}
      {compact
        ? (
            <Tooltip>
              <TooltipTrigger asChild>{selectButton}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {count > 0 ? `${label} · ${count}` : label}
              </TooltipContent>
            </Tooltip>
          )
        : selectButton}

      {!compact && category.modifiable
        ? (
            <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 rounded-md bg-accent/95 px-0.5 opacity-0 shadow-xs ring-1 ring-border/40 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
              <button
                ref={setActivatorNodeRef}
                type="button"
                disabled={movePending}
                {...attributes}
                {...listeners}
                title={t('dragFolder')}
                aria-label={t('dragNamedFolder', { name: categoryName(category) })}
                className={cn(
                  'flex size-6 touch-none items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 active:cursor-grabbing',
                  active
                    ? 'text-foreground/70 hover:bg-background/65 hover:text-foreground'
                    : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                )}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onEdit(category)}
                title={t('editFolder')}
                aria-label={t('editNamedFolder', { name: categoryName(category) })}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'text-foreground/70 hover:bg-background/65 hover:text-foreground'
                    : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                )}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )
        : null}
    </div>
  )
}
