import type { Category } from '~/lib/types'

import { CategoryTab } from '~/components/category-tabs/CategoryTab'

interface CategoryGroupsTabProps {
  label: string
  active: boolean
  count: number
  fullWidth: boolean
  showCount: boolean
  showIcon: boolean
  reserveLeadingSpace: boolean
  onSelect: () => void
  onEdit: (category: Category) => void
  compact?: boolean
}

export function CategoryGroupsTab({
  label,
  active,
  count,
  fullWidth,
  showCount,
  showIcon,
  reserveLeadingSpace,
  onSelect,
  onEdit,
  compact = false,
}: CategoryGroupsTabProps) {
  return (
    <CategoryTab
      category={{ id: 'bookmark-groups', name: label, emoji: '🗂️', parentId: 'all', modifiable: false }}
      accessibleName={label}
      active={active}
      count={count}
      fullWidth={fullWidth}
      showCount={showCount}
      showIcon={showIcon}
      reserveLeadingSpace={reserveLeadingSpace}
      onSelect={onSelect}
      onEdit={onEdit}
      compact={compact}
    />
  )
}
