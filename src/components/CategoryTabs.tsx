import type { Category } from '~/lib/types'

import { CategoryGroupsTab } from '~/components/category-tabs/CategoryGroupsTab'
import { CategoryTabList } from '~/components/category-tabs/CategoryTabList'
import { CategoryTreeItems } from '~/components/category-tabs/CategoryTreeItems'
import { SmartCategoriesCollapsible } from '~/components/category-tabs/SmartCategoriesCollapsible'
import { useCategoryTabs } from '~/components/category-tabs/use-category-tabs'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface CategoryTabsProps {
  onEditCategory: (category: Category) => void
  groupsActive?: boolean
  onSelectGroups?: () => void
  onSelectCategory?: () => void
  compact?: boolean
}

export function CategoryTabs({ onEditCategory, groupsActive, onSelectGroups, onSelectCategory, compact = false }: CategoryTabsProps) {
  const { t } = useI18n()
  const tabs = useCategoryTabs({ onEditCategory, groupsActive, onSelectCategory })
  const groupEntry = tabs.groupsEnabled && onSelectGroups
    ? (
        <CategoryGroupsTab
          label={t('bookmarkGroups')}
          active={Boolean(groupsActive)}
          count={tabs.groupCount}
          onSelect={onSelectGroups}
          onEdit={onEditCategory}
          {...tabs.tabLayout}
          compact={compact}
        />
      )
    : null

  return (
    <nav
      ref={tabs.navRef}
      aria-label={t('bookmarkCategories')}
      className={cn(
        'relative flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        tabs.navLayout === 'sidebar'
          ? 'lg:h-full lg:flex-col lg:gap-1 lg:overflow-x-hidden lg:overflow-y-auto'
          : 'lg:overflow-x-auto',
      )}
    >
      <span ref={tabs.indicatorRef} aria-hidden="true" hidden className="pointer-events-none absolute left-0 top-0 rounded-lg bg-accent" />
      {tabs.smartCategoriesCollapsible
        ? (
            <>
              {tabs.allCategory ? <CategoryTabList categories={[tabs.allCategory]} compact={compact} {...tabs.tabProps} /> : null}
              <SmartCategoriesCollapsible
                open={tabs.smartCategoriesOpen}
                onOpenChange={tabs.setSmartCategoriesOpen}
                label={t('smartCategories')}
                count={tabs.smartCategoryItems.length}
                treeEnabled={tabs.treeEnabled}
                compact={compact}
              >
                {tabs.smartCategoriesOpen
                  ? <CategoryTabList categories={tabs.smartCategoryItems} compact={compact} {...tabs.tabProps} />
                  : null}
              </SmartCategoriesCollapsible>
              {!tabs.smartCategoriesOpen && tabs.activeSmartCategory
                ? <CategoryTabList categories={[tabs.activeSmartCategory]} compact={compact} {...tabs.tabProps} />
                : null}
              {groupEntry}
              <CategoryTabList categories={tabs.visibleSavedCategories} compact={compact} {...tabs.tabProps} />
            </>
          )
        : (
            <>
              <CategoryTabList categories={tabs.utilityCategories} compact={compact} {...tabs.tabProps} />
              {groupEntry}
            </>
          )}
      {tabs.treeEnabled
        ? (
            <ul className="contents lg:flex lg:w-full lg:flex-col lg:gap-1">
              <CategoryTreeItems
                nodes={tabs.categoryTree}
                depth={0}
                compact={compact}
                {...tabs.treeProps}
              />
            </ul>
          )
        : (
            <CategoryTabList categories={tabs.categories} compact={compact} {...tabs.tabProps} />
          )}
    </nav>
  )
}
