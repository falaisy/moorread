import type { StateCreator } from 'zustand'
import type { BookmarkSlice, NavState } from './store-types'
import type { BookmarkMeta, CategoryMeta } from './types'

import { loadBookmarkTreeData, reuseBookmarkTreeData } from './bookmark-tree'
import { normalizeAlternateBookmarkUrls } from './bookmark-urls'
import { createCoalescedAsyncRunner } from './coalesced-async'
import {
  getBookmarkUrlMigrationRevision,
  waitForBookmarkUrlMigrations,
} from './store-bookmark-crud-actions'
import { applyCategoryMeta, applyMeta } from './store-helpers'
import {
  metaStorage,
  STORAGE_KEYS,
  updateBookmarkMetadata,
} from './store-persistence'
import { resolveAvailableCategoryId } from './store-settings-state'

type BookmarkSliceSetter = Parameters<StateCreator<NavState, [], [], BookmarkSlice>>[0]
type BookmarkSliceGetter = () => NavState

let metadataRefreshRevision = 0
let bookmarkTitleRevision = 0
const runBookmarkLoad = createCoalescedAsyncRunner()

export function createBookmarkMetadataActions(
  set: BookmarkSliceSetter,
  get: BookmarkSliceGetter,
): Pick<
  BookmarkSlice,
  | 'loadBookmarks'
  | 'applyNativeBookmarkTitle'
  | 'refreshSupplementaryMetadata'
  | 'setBookmarkMeta'
  | 'setBookmarkPinned'
  | 'setBookmarkTags'
  | 'markBookmarksOrganized'
> {
  return {
    loadBookmarks: () => runBookmarkLoad(async () => {
      // Keep the old URL available until migrations finish. If the native tree
      // was read during a migration, read it again instead of applying an old URL.
      let tree: Awaited<ReturnType<typeof loadBookmarkTreeData>>
      let revision: number
      let titleRevision: number
      do {
        await waitForBookmarkUrlMigrations()
        revision = getBookmarkUrlMigrationRevision()
        titleRevision = bookmarkTitleRevision
        tree = await loadBookmarkTreeData()
        await waitForBookmarkUrlMigrations()
      } while (revision !== getBookmarkUrlMigrationRevision() || titleRevision !== bookmarkTitleRevision)
      const { categories, bookmarks } = tree
      // 尚未由使用者選過分類的分頁，分類的權威來源是設定的預設分類，不是上一次
      // 的 activeCategoryId。書籤樹在瀏覽器啟動時可能尚未就緒（先回空樹），
      // 若拿 'all' 當基準，之後資料到齊也永遠停在 all；這裡每次載入都重新以
      // 預設分類還原，讓晚到的分類能接上，且不改寫任何已保存的設定值。
      const current = get()
      const requestedCategoryId = current.categorySelectionTouched
        ? current.activeCategoryId
        : current.settings.defaultCategoryId
      const activeCategoryId = resolveAvailableCategoryId(
        requestedCategoryId,
        categories,
      )
      set({
        ...reuseBookmarkTreeData(get(), {
          categories: applyCategoryMeta(categories, get().categoryMeta),
          bookmarks: applyMeta(bookmarks, get().meta),
        }),
        activeCategoryId,
      })
    }),

    applyNativeBookmarkTitle: (nativeId, title, expectedUrl) => {
      const bookmarkId = `bm-${nativeId}`
      const bookmark = get().bookmarks.find(item => item.id === bookmarkId)
      if (bookmark) {
        if (expectedUrl !== undefined && bookmark.url !== expectedUrl)
          return false
        bookmarkTitleRevision += 1
        const name = title || bookmark.url
        if (bookmark.name !== name)
          set({ bookmarks: get().bookmarks.map(item => item === bookmark ? { ...item, name } : item) })
        return true
      }
      const categoryId = `cat-${nativeId}`
      const category = get().categories.find(item => item.id === categoryId)
      if (!category || expectedUrl !== undefined)
        return false
      bookmarkTitleRevision += 1
      if (category.name !== title)
        set({ categories: get().categories.map(item => item === category ? { ...item, name: title } : item) })
      return true
    },

    refreshSupplementaryMetadata: async () => {
      const revision = ++metadataRefreshRevision
      const previousMeta = get().meta
      const previousCategoryMeta = get().categoryMeta
      const [meta, categoryMeta] = await Promise.all([
        metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta),
        metaStorage.get<Record<string, CategoryMeta>>(STORAGE_KEYS.categoryMeta),
      ])
      if (revision !== metadataRefreshRevision)
        return
      set((state) => {
        const currentMeta = state.meta === previousMeta ? meta ?? {} : state.meta
        const currentCategoryMeta = state.categoryMeta === previousCategoryMeta
          ? categoryMeta ?? {}
          : state.categoryMeta
        return {
          meta: currentMeta,
          categoryMeta: currentCategoryMeta,
          bookmarks: applyMeta(state.bookmarks, currentMeta),
          categories: applyCategoryMeta(state.categories, currentCategoryMeta),
        }
      })
    },

    setBookmarkMeta: async (originalUrl, edit, bookmarkId) => {
      if (!originalUrl)
        return
      const meta = await updateBookmarkMetadata((latest) => {
        const url = bookmarkId
          ? get().bookmarks.find(bookmark => bookmark.id === bookmarkId)?.url ?? originalUrl
          : originalUrl
        const meta = { ...latest }
        const next = { ...(meta[url] ?? {}) }
        const patch = typeof edit === 'function' ? edit(next) : edit
        if (patch.description !== undefined) {
          next.description = patch.description || undefined
        }
        if (patch.icon !== undefined) {
          next.icon = patch.icon || undefined
        }
        if (patch.alternateUrls !== undefined) {
          next.alternateUrls = normalizeAlternateBookmarkUrls(
            patch.alternateUrls,
            url,
          )
          if (next.alternateUrls.length === 0) {
            next.alternateUrls = undefined
          }
        }
        if (patch.pinnedAt !== undefined) {
          next.pinnedAt = patch.pinnedAt > 0 ? patch.pinnedAt : undefined
          delete next.pinnedOrder
        }
        if (Object.hasOwn(patch, 'pinnedOrder'))
          next.pinnedOrder = Number.isFinite(patch.pinnedOrder) ? patch.pinnedOrder : undefined
        if (patch.tags !== undefined) {
          next.tags = [...new Set(patch.tags.flatMap((tag) => {
            const normalized = tag.trim()
            return normalized ? [normalized] : []
          }))]
          if (next.tags.length === 0) {
            next.tags = undefined
          }
        }
        if (patch.inboxAt !== undefined) {
          next.inboxAt = patch.inboxAt > 0 ? patch.inboxAt : undefined
        }
        if (
          !next.description
          && !next.icon
          && !next.alternateUrls?.length
          && !next.pinnedAt
          && !next.tags?.length
          && !next.inboxAt
        ) {
          delete meta[url]
        }
        else {
          meta[url] = next
        }
        return meta
      }, () => get().meta)
      set({
        meta,
        bookmarks: applyMeta(get().bookmarks, meta),
      })
    },

    setBookmarkPinned: async (url, pinned) => {
      await get().setBookmarkMeta(url, { pinnedAt: pinned ? Date.now() : 0, pinnedOrder: undefined })
    },

    setBookmarkTags: async (url, tags) => {
      await get().setBookmarkMeta(url, { tags })
    },

    markBookmarksOrganized: async (ids) => {
      const selectedIds = new Set(ids)
      const targets = get().bookmarks.filter(bookmark => selectedIds.has(bookmark.id))
      const meta = await updateBookmarkMetadata((latest) => {
        const meta = { ...latest }
        for (const bookmark of targets) {
          const next = { ...(meta[bookmark.url] ?? {}) }
          delete next.inboxAt
          if (!next.description && !next.icon && !next.alternateUrls?.length
            && !next.pinnedAt && !next.tags?.length) {
            delete meta[bookmark.url]
          }
          else {
            meta[bookmark.url] = next
          }
        }
        return meta
      }, () => get().meta)
      set({ meta, bookmarks: applyMeta(get().bookmarks, meta) })
    },
  }
}
