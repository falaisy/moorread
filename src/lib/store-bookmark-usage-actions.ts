import type { StateCreator } from 'zustand'
import type { BookmarkSlice, NavState } from './store-types'

import { scheduleUsagePersist, usagePersistence } from './store-helpers'

type BookmarkSliceSetter = Parameters<StateCreator<NavState, [], [], BookmarkSlice>>[0]
type BookmarkSliceGetter = () => NavState

export function createBookmarkUsageActions(
  set: BookmarkSliceSetter,
  get: BookmarkSliceGetter,
): Pick<
  BookmarkSlice,
  'recordBookmarkOpen' | 'refreshUsage' | 'clearUsage' | 'setActiveCategory' | 'setBookmarkSearchQuery'
> {
  return {
    // 骨架屏期間側欄已可點，這裡記下「使用者主動選過分類」，
    // 首屏載入完成後才不會被 applyDefaultCategory 覆蓋回預設分類。
    setActiveCategory: id =>
      set({ activeCategoryId: id, categorySelectionTouched: true }),
    setBookmarkSearchQuery: query => set({ bookmarkSearchQuery: query }),

    recordBookmarkOpen: async (url) => {
      const current = get().usage[url]
      const openedAt = Date.now()
      usagePersistence.record(url, openedAt)
      const usage = {
        ...get().usage,
        [url]: {
          openCount: (current?.openCount ?? 0) + 1,
          lastOpenedAt: openedAt,
        },
      }
      set({ usage })
      scheduleUsagePersist()
    },

    refreshUsage: () => usagePersistence.refresh(),

    clearUsage: async () => {
      await usagePersistence.update(() => ({}))
    },
  }
}
