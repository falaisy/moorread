import type { Category } from '~/lib/types'

import { useMemo, useRef, useState } from 'react'
import { useBookmarkGroupsStore } from '~/lib/bookmark-groups-store'
import { countMatchingSearchEntries } from '~/lib/bookmark-search'
import { getCategoryAncestorIds } from '~/lib/category-tree'
import { VIRTUAL_CATEGORIES } from '~/lib/default-data'
import { useSlidingIndicator } from '~/lib/motion'
import { getNavigationDerivedData } from '~/lib/navigation-derived'
import { useBookmarks, useCategories, useNavStore } from '~/lib/store'

interface UseCategoryTabsOptions {
  onEditCategory: (category: Category) => void
  groupsActive?: boolean
  onSelectCategory?: () => void
}

export function useCategoryTabs({ onEditCategory, groupsActive, onSelectCategory }: UseCategoryTabsOptions) {
  const categories = useCategories()
  const bookmarks = useBookmarks()
  const activeId = useNavStore(s => s.activeCategoryId)
  const setActiveCategory = useNavStore(s => s.setActiveCategory)
  const groupCount = useBookmarkGroupsStore(state => state.groups.length)
  const groupsEnabled = useNavStore(state => state.settings.bookmarkGroupsEnabled)
  const pinnedGroupCount = useBookmarkGroupsStore(state => state.groups.filter(group => group.pinnedAt).length)
  const setActive = (id: string) => {
    onSelectCategory?.()
    setActiveCategory(id)
  }
  const usage = useNavStore(s => s.usage)
  const searchQuery = useNavStore(s => s.bookmarkSearchQuery)
  const setSearchQuery = useNavStore(s => s.setBookmarkSearchQuery)
  const savedSearches = useNavStore(s => s.settings.savedSearches)
  const appearance = useNavStore(s => s.settings.appearance)
  const navLayout = appearance.navLayout
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [smartCategoriesOpen, setSmartCategoriesOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  useSlidingIndicator(navRef, indicatorRef, '[data-category-tab][data-active]', groupsActive ? 'groups' : `${activeId}\u0000${searchQuery}`)

  const savedCategories: Category[] = useMemo(
    () =>
      savedSearches.map(item => ({
        id: `saved-search:${item.id}`,
        name: item.name,
        emoji: '🔖',
        parentId: 'all',
        modifiable: false,
      })),
    [savedSearches],
  )
  const virtualCategories = appearance.navItems.smartCategories
    ? [...VIRTUAL_CATEGORIES]
    : VIRTUAL_CATEGORIES.filter(
        category => category.id === 'all' || category.id === 'inbox',
      )
  const visibleSavedCategories = appearance.navItems.savedSearches
    ? savedCategories
    : []
  const utilityCategories = [
    ...virtualCategories,
    ...visibleSavedCategories,
  ]
  const allCategory = utilityCategories.find(category => category.id === 'all')
  const smartCategoryItems = virtualCategories.filter(
    category => category.id !== 'all',
  )
  const activeSmartCategory = smartCategoryItems.find(
    category => category.id === activeId,
  )
  const derived = useMemo(
    () => getNavigationDerivedData(bookmarks, categories),
    [bookmarks, categories],
  )
  const categoryTree = derived.categoryTree
  const forcedExpandedIds = useMemo(
    () => getCategoryAncestorIds(activeId, categories),
    [activeId, categories],
  )
  const { bookmarkCountByCategory, childCategoryCountByCategory }
    = derived
  const showCounts = appearance.navItems.counts
  // savedSearch 计数依赖 derived 的 searchEntries 索引；按稳定的 derived 与
  // savedSearches 缓存，输入 / 布局变化时不重扫整组书签。counts 隐藏时完全不计算。
  const savedSearchCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!showCounts || !appearance.navItems.savedSearches)
      return counts
    const entries = derived.searchEntries
    for (const item of savedSearches) {
      counts.set(
        `saved-search:${item.id}`,
        countMatchingSearchEntries(entries, item.query),
      )
    }
    return counts
  }, [
    derived,
    savedSearches,
    showCounts,
    appearance.navItems.savedSearches,
  ])
  const smartCounts = useMemo(() => {
    let used = 0
    for (const bookmark of bookmarks) {
      if (usage[bookmark.url]?.openCount > 0)
        used += 1
    }
    return { used, ...derived.smartCounts }
  }, [bookmarks, derived.smartCounts, usage])

  // 数字与主区当前展示的内容保持一致：直属书签 + 直属子目录。
  const count = (id: string) => {
    if (id === 'all')
      return bookmarks.length
    if (id === 'frequent' || id === 'recent')
      return smartCounts.used
    if (id === 'inbox')
      return smartCounts.inbox
    if (id === 'pinned')
      return smartCounts.pinned + (groupsEnabled ? pinnedGroupCount : 0)
    if (id === 'untagged')
      return smartCounts.untagged
    if (id === 'undescribed')
      return smartCounts.undescribed
    if (id.startsWith('saved-search:')) {
      return savedSearchCounts.get(id) ?? 0
    }
    return (
      (bookmarkCountByCategory.get(id) ?? 0)
      + (childCategoryCountByCategory.get(id) ?? 0)
    )
  }

  const toggleCategory = (id: string) => {
    const isForcedExpanded = forcedExpandedIds.has(id)
    if (isForcedExpanded)
      setActive(id)
    setCollapsedCategoryIds((current) => {
      const next = new Set(current)
      if (isForcedExpanded)
        next.add(id)
      else if (next.has(id))
        next.delete(id)
      else next.add(id)
      return next
    })
  }

  const treeEnabled
    = navLayout === 'sidebar' && appearance.navItems.categoryTree
  const findSavedSearch = (category: Category) =>
    savedSearches.find(item => `saved-search:${item.id}` === category.id)
  const isCategoryActive = (category: Category) => {
    const saved = findSavedSearch(category)
    return !groupsActive
      && (saved ? searchQuery === saved.query : category.id === activeId)
  }
  const selectCategory = (category: Category) => {
    const saved = findSavedSearch(category)
    if (saved) {
      setActive('all')
      setSearchQuery(saved.query)
    }
    else {
      setActive(category.id)
    }
  }
  const tabLayout = {
    fullWidth: navLayout === 'sidebar',
    reserveLeadingSpace: treeEnabled,
    showCount: showCounts,
    showIcon: appearance.navItems.icons,
  }

  const smartCategoriesCollapsible
    = navLayout === 'sidebar' && smartCategoryItems.length > 1

  return {
    activeSmartCategory,
    allCategory,
    categories,
    categoryTree,
    collapsedCategoryIds,
    forcedExpandedIds,
    groupCount,
    groupsEnabled,
    indicatorRef,
    navLayout,
    navRef,
    setSmartCategoriesOpen,
    smartCategoriesCollapsible,
    smartCategoriesOpen,
    smartCategoryItems,
    tabLayout,
    tabProps: {
      ...tabLayout,
      count,
      isActive: isCategoryActive,
      onEdit: onEditCategory,
      onSelect: selectCategory,
    },
    treeEnabled,
    treeProps: {
      activeId: groupsActive ? '' : activeId,
      collapsedIds: collapsedCategoryIds,
      count,
      forcedExpandedIds,
      onEdit: onEditCategory,
      onSelect: setActive,
      onToggle: toggleCategory,
      showCount: showCounts,
      showIcon: appearance.navItems.icons,
    },
    utilityCategories,
    visibleSavedCategories,
  }
}
