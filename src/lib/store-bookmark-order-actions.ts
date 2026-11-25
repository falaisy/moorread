import type { StateCreator } from 'zustand'
import type { BookmarkSlice, NavState } from './store-types'
import type { Bookmark, BookmarkMeta } from './types'

import { updateBookmarkGroups } from './bookmark-groups-store'
import { assertBookmarksApi, bookmarkApi } from './bookmark-repository'
import { toNodeId } from './bookmark-tree'
import { bookmarkCardKey, getPinnedCards, groupCardKey, reorderPinnedCards } from './card-order'
import { applyMeta, resolveParentId } from './store-helpers'
import {
  metaStorage,
  persist,
  STORAGE_KEYS,
  updateBookmarkMetadata,
  withBookmarkMetadataLock,
} from './store-persistence'

type BookmarkSliceSetter = Parameters<StateCreator<NavState, [], [], BookmarkSlice>>[0]
type BookmarkSliceGetter = () => NavState

export function createBookmarkOrderActions(
  set: BookmarkSliceSetter,
  get: BookmarkSliceGetter,
): Pick<BookmarkSlice, 'reorderBookmark' | 'reorderPinnedCard' | 'reorderPinnedBookmark'> {
  return {
    reorderBookmark: async (id, targetId) => {
      assertBookmarksApi()
      const bookmark = get().bookmarks.find(item => item.id === id)
      const target = get().bookmarks.find(item => item.id === targetId)
      if (!bookmark || !target || bookmark.id === target.id)
        return
      if (bookmark.categoryId !== target.categoryId)
        throw new Error('bookmark.reorder_cross_category')
      if (Boolean(bookmark.pinnedAt) !== Boolean(target.pinnedAt))
        throw new Error('bookmark.reorder_pin_boundary')
      const sourceIndex = bookmark.index ?? 0
      const targetIndex = target.index ?? 0
      await bookmarkApi.move(toNodeId(id), {
        parentId: resolveParentId(bookmark.categoryId),
        index: targetIndex + (sourceIndex < targetIndex ? 1 : 0),
      })
      await get().loadBookmarks()
      await get().recordActivity('move', bookmark.name)
    },

    reorderPinnedCard: async (sourceKey, targetKey) => {
      let committedMeta: Record<string, BookmarkMeta> | undefined
      const previousOrders = new Map<string, number | undefined>()
      const newOrders = new Map<string, number>()
      try {
        // URL migrations also acquire metadata before groups; keep one lock order.
        await withBookmarkMetadataLock(async () => {
          await updateBookmarkGroups(async (groups) => {
            const latest = await metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta) ?? get().meta
            const bookmarks = applyMeta(get().bookmarks, latest)
            const ranks = reorderPinnedCards(getPinnedCards(bookmarks, groups), sourceKey, targetKey)
            const meta = { ...latest }
            let changed = false
            for (const bookmark of bookmarks) {
              const rank = ranks.get(bookmarkCardKey(bookmark.url))
              if (rank !== undefined && meta[bookmark.url]?.pinnedOrder !== rank) {
                previousOrders.set(bookmark.url, meta[bookmark.url]?.pinnedOrder)
                newOrders.set(bookmark.url, rank)
                meta[bookmark.url] = { ...meta[bookmark.url], pinnedOrder: rank }
                changed = true
              }
            }
            if (changed)
              await persist(metaStorage, STORAGE_KEYS.meta, meta)
            committedMeta = changed ? meta : latest
            return groups.map((group) => {
              const rank = ranks.get(groupCardKey(group.id))
              return rank === undefined ? group : { ...group, pinnedOrder: rank }
            })
          })
        })
      }
      catch (cause) {
        if (committedMeta && previousOrders.size) {
          const restored = await updateBookmarkMetadata((latest) => {
            const meta = { ...latest }
            for (const [url, previous] of previousOrders) {
              if (meta[url]?.pinnedOrder === newOrders.get(url))
                meta[url] = { ...meta[url], pinnedOrder: previous }
            }
            return meta
          }, () => get().meta)
          set({ meta: restored, bookmarks: applyMeta(get().bookmarks, restored) })
        }
        throw cause
      }
      if (committedMeta)
        await get().refreshSupplementaryMetadata()
    },

    reorderPinnedBookmark: async (id, targetId) => {
      const bookmarks = get().bookmarks
      const bookmark = bookmarks.find(item => item.id === id)
      const target = bookmarks.find(item => item.id === targetId)
      if (!bookmark?.pinnedAt || !target?.pinnedAt || bookmark.url === target.url)
        return
      const pinnedByUrl = new Map<string, Bookmark>()
      for (const item of bookmarks) {
        if (item.pinnedAt && !pinnedByUrl.has(item.url))
          pinnedByUrl.set(item.url, item)
      }
      const pinned = [...pinnedByUrl.values()]
        .toSorted((left, right) => (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0))
      const sourceIndex = pinned.findIndex(item => item.url === bookmark.url)
      const targetIndex = pinned.findIndex(item => item.url === target.url)
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
        return
      const [moved] = pinned.splice(sourceIndex, 1)
      if (!moved)
        return
      pinned.splice(targetIndex, 0, moved)

      const previousMeta = get().meta
      const meta = { ...previousMeta }
      const ranks = new Map<string, number>()
      const topRank = Date.now() + pinned.length
      pinned.forEach((item, index) => {
        const pinnedAt = topRank - index
        ranks.set(item.url, pinnedAt)
        meta[item.url] = { ...(meta[item.url] ?? {}), pinnedAt }
      })
      const reorderedBookmarks = get().bookmarks.map((item) => {
        const pinnedAt = ranks.get(item.url)
        return pinnedAt === undefined || pinnedAt === item.pinnedAt
          ? item
          : { ...item, pinnedAt }
      })
      set({
        meta,
        bookmarks: reorderedBookmarks,
      })
      try {
        const persistedMeta = await updateBookmarkMetadata((latest) => {
          const next = { ...latest }
          for (const [url, pinnedAt] of ranks)
            next[url] = { ...next[url], pinnedAt }
          return next
        }, () => get().meta)
        set({ meta: persistedMeta, bookmarks: applyMeta(get().bookmarks, persistedMeta) })
      }
      catch (cause) {
        set(state => state.meta === meta
          ? {
              meta: previousMeta,
              bookmarks: state.bookmarks === reorderedBookmarks
                ? bookmarks
                : state.bookmarks.map((item) => {
                    const pinnedAt = ranks.has(item.url)
                      ? previousMeta[item.url]?.pinnedAt
                      : item.pinnedAt
                    return pinnedAt === item.pinnedAt
                      ? item
                      : { ...item, pinnedAt }
                  }),
            }
          : state)
        throw cause
      }
      await get().recordActivity('move', bookmark.name)
    },
  }
}
