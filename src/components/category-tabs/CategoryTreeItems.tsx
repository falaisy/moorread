import type { CategoryTreeNode } from '~/lib/category-tree'
import type { Category } from '~/lib/types'

import { ChevronRight } from 'lucide-react'
import { CategoryTab } from '~/components/category-tabs/CategoryTab'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

const MAX_TREE_INDENT_DEPTH = 3

interface CategoryTreeItemsProps {
  nodes: CategoryTreeNode[]
  depth: number
  activeId: string
  collapsedIds: Set<string>
  forcedExpandedIds: Set<string>
  showCount: boolean
  showIcon: boolean
  count: (id: string) => number
  onSelect: (id: string) => void
  onEdit: (category: Category) => void
  onToggle: (id: string) => void
  compact?: boolean
}

export function CategoryTreeItems({
  nodes,
  depth,
  activeId,
  collapsedIds,
  forcedExpandedIds,
  showCount,
  showIcon,
  count,
  onSelect,
  onEdit,
  onToggle,
  compact = false,
}: CategoryTreeItemsProps) {
  const { categoryName, t } = useI18n()
  return nodes.map(({ category, children }) => {
    const hasChildren = children.length > 0
    const expanded
      = forcedExpandedIds.has(category.id) || !collapsedIds.has(category.id)
    const leadingControl = compact
      ? null
      : (hasChildren
          ? (
              <button
                type="button"
                aria-label={t(expanded ? 'collapseFolder' : 'expandFolder', {
                  name: categoryName(category),
                })}
                aria-expanded={expanded}
                onClick={() => onToggle(category.id)}
                className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:flex"
              >
                <ChevronRight className={cn('size-3.5 transition-transform duration-200 ease-out', expanded && 'rotate-90')} />
              </button>
            )
          : null)

    return (
      <li key={category.id} className="contents lg:block">
        <CategoryTab
          category={category}
          accessibleName={categoryName(category)}
          active={category.id === activeId}
          count={count(category.id)}
          fullWidth
          showCount={showCount}
          showIcon={showIcon}
          leadingControl={leadingControl ?? undefined}
          reserveLeadingSpace={!compact}
          onSelect={onSelect}
          onEdit={onEdit}
          compact={compact}
        />
        {compact && hasChildren
          ? (
              <button
                type="button"
                aria-label={t(expanded ? 'collapseFolder' : 'expandFolder', {
                  name: categoryName(category),
                })}
                aria-expanded={expanded}
                onClick={() => onToggle(category.id)}
                className="hidden h-4 w-full items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:flex"
              >
                <ChevronRight className={cn('size-3 transition-transform duration-200 ease-out', expanded && 'rotate-90')} />
              </button>
            )
          : null}
        {hasChildren && expanded
          ? (
              <ul
                className={cn(
                  'contents lg:flex lg:flex-col lg:gap-1',
                  depth < MAX_TREE_INDENT_DEPTH
                  && (compact
                    ? 'lg:ml-1 lg:border-l lg:border-dashed lg:border-border/50 lg:pl-1'
                    : 'lg:ml-3.5 lg:border-l lg:border-dashed lg:border-border/50 lg:pl-1.5'),
                )}
              >
                <CategoryTreeItems
                  nodes={children}
                  depth={depth + 1}
                  activeId={activeId}
                  collapsedIds={collapsedIds}
                  forcedExpandedIds={forcedExpandedIds}
                  showCount={showCount}
                  showIcon={showIcon}
                  count={count}
                  onSelect={onSelect}
                  onEdit={onEdit}
                  onToggle={onToggle}
                  compact={compact}
                />
              </ul>
            )
          : null}
      </li>
    )
  })
}
