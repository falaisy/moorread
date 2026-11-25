import type { Category } from '~/lib/types'

import { CategoryTab } from '~/components/category-tabs/CategoryTab'

interface CategoryTabListProps {
  categories: Category[]
  isActive: (category: Category) => boolean
  fullWidth: boolean
  showCount: boolean
  showIcon: boolean
  reserveLeadingSpace: boolean
  count: (id: string) => number
  onSelect: (category: Category) => void
  onEdit: (category: Category) => void
  compact?: boolean
}

export function CategoryTabList({
  categories,
  isActive,
  fullWidth,
  showCount,
  showIcon,
  reserveLeadingSpace,
  count,
  onSelect,
  onEdit,
  compact = false,
}: CategoryTabListProps) {
  return categories.map(category => (
    <CategoryTab
      key={category.id}
      category={category}
      active={isActive(category)}
      count={count(category.id)}
      fullWidth={fullWidth}
      showCount={showCount}
      showIcon={showIcon}
      reserveLeadingSpace={reserveLeadingSpace}
      onSelect={() => onSelect(category)}
      onEdit={onEdit}
      compact={compact}
    />
  ))
}
