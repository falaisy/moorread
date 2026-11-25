import type { StateCreator } from 'zustand'
import type { BookmarkSlice, NavState } from './store-types'
import type { BookmarkMeta } from './types'

import { releaseBookmarkDeletionArchive, suppressBookmarkDeletionArchive } from './bookmark-deletion-safety'
import { useBookmarkGroupsStore } from './bookmark-groups-store'
import { assertBookmarksApi, bookmarkApi } from './bookmark-repository'
import { toNodeId } from './bookmark-tree'
import { localizedMessage } from './i18n'
import { beginUndoWindow } from './store-group-slice'
import {
  applyMeta,
  removeNativeBookmark,
  resolveParentId,
  scheduleUsagePersist,
  usagePersistence,
} from './store-helpers'
import {
  metaStorage,
  persist,
  STORAGE_KEYS,
  withBookmarkMetadataLock,
} from './store-persistence'

type BookmarkSliceSetter = Parameters<StateCreator<NavState, [], [], BookmarkSlice>>[0]
type BookmarkSliceGetter = () => NavState

// 進行中的原生 URL 遷移；loadBookmarks 需要知道它們是否已完成。
const bookmarkUrlMigrations = new Set<Promise<void>>()
let bookmarkUrlMigrationRevision = 0

export function getBookmarkUrlMigrationRevision(): number {
  return bookmarkUrlMigrationRevision
}

export async function waitForBookmarkUrlMigrations(): Promise<void> {
  while (bookmarkUrlMigrations.size > 0)
    await Promise.allSettled([...bookmarkUrlMigrations])
}

export function createBookmarkCrudActions(
  set: BookmarkSliceSetter,
  get: BookmarkSliceGetter,
): Pick<
  BookmarkSlice,
  | 'addBookmark'
  | 'updateBookmark'
  | 'reconcileBookmarkUrlChange'
  | 'removeBookmark'
  | 'removeBookmarks'
  | 'moveBookmarks'
> {
  return {
    addBookmark: async (bookmark) => {
      assertBookmarksApi()

      await bookmarkApi.create({
        parentId: resolveParentId(bookmark.categoryId),
        title: bookmark.name,
        url: bookmark.url,
      })
      const icon = bookmark.icon
      if (
        bookmark.description
        || icon
        || bookmark.alternateUrls?.length
        || bookmark.tags?.length
        || bookmark.inboxAt
      ) {
        await get().setBookmarkMeta(bookmark.url, {
          description: bookmark.description,
          icon,
          alternateUrls: bookmark.alternateUrls,
          tags: bookmark.tags,
          inboxAt: bookmark.inboxAt,
        })
      }
      await get().loadBookmarks()
      await get().recordActivity('add', bookmark.name)
    },

    updateBookmark: async (id, patch) => {
      assertBookmarksApi()

      const nodeId = toNodeId(id)
      const current = get().bookmarks.find(b => b.id === id)
      const changes: { title?: string, url?: string } = {}
      if (patch.name !== undefined)
        changes.title = patch.name
      if (patch.url !== undefined)
        changes.url = patch.url
      if (changes.title !== undefined || changes.url !== undefined) {
        await bookmarkApi.update(nodeId, changes)
      }
      if (patch.url && current && patch.url !== current.url) {
        await get().reconcileBookmarkUrlChange(nodeId, patch.url)
      }
      const nextCategoryId = patch.categoryId
      // `all`／`inbox` 是虛擬分類，不是實體資料夾，不能直接餵給 chrome.bookmarks.move。
      const isVirtualCategory = nextCategoryId === 'all' || nextCategoryId === 'inbox'
      if (nextCategoryId && !isVirtualCategory) {
        if (
          !get().categories.some(category => category.id === nextCategoryId)
        ) {
          throw new Error('category.target_not_found')
        }
        await chrome.bookmarks.move(nodeId, {
          parentId: resolveParentId(nextCategoryId),
        })
      }
      // 分類變更（含 `cat-1` 書籤列）代表離開 Inbox：必須清 `inboxAt`，
      // 不能再用 `parentId === '1'` 推導「還在收件匣」。
      const categoryChanged = Boolean(nextCategoryId)
        && !isVirtualCategory
        && nextCategoryId !== current?.categoryId
      const clearInbox = categoryChanged && patch.inboxAt === undefined
      if (
        patch.description !== undefined
        || patch.icon !== undefined
        || patch.alternateUrls !== undefined
        || patch.tags !== undefined
        || patch.inboxAt !== undefined
        || clearInbox
      ) {
        const url = patch.url ?? current?.url ?? ''
        await get().setBookmarkMeta(url, {
          description: patch.description,
          icon: patch.icon,
          alternateUrls: patch.alternateUrls,
          tags: patch.tags,
          inboxAt: clearInbox ? 0 : patch.inboxAt,
        }, id)
      }
      await get().loadBookmarks()
      await get().recordActivity(
        'edit',
        current?.name
        ?? patch.name
        ?? localizedMessage('runtimeBookmarkFallback'),
      )
    },

    reconcileBookmarkUrlChange: async (nativeId, url) => {
      bookmarkUrlMigrationRevision += 1
      const migration = withBookmarkMetadataLock(async () => {
        const id = `bm-${nativeId}`
        const current = get().bookmarks.find(bookmark => bookmark.id === id)
        if (!current || !url || current.url === url)
          return

        const oldUrlStillInUse = get().bookmarks.some(bookmark =>
          bookmark.id !== id && bookmark.url === current.url,
        )
        const latest = await metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta)
          ?? get().meta
        const meta = { ...latest }
        const previousMeta = meta[current.url]
        if (previousMeta) {
          meta[url] = { ...previousMeta, ...meta[url] }
          if (!oldUrlStillInUse)
            delete meta[current.url]
          await persist(metaStorage, STORAGE_KEYS.meta, meta)
        }

        if (!oldUrlStillInUse && typeof chrome !== 'undefined' && chrome.storage?.sync) {
          await useBookmarkGroupsStore.getState().migrateUrl(current.url, url).catch(() => useBookmarkGroupsStore.setState({ error: true }))
        }

        // Advance the cached URL before releasing the lock, so another native
        // URL change migrates from this destination even before the tree reload.
        const bookmarks = get().bookmarks.map(bookmark => bookmark.id === id
          ? { ...bookmark, url }
          : bookmark)
        set({ meta, bookmarks: applyMeta(bookmarks, meta) })
        if (!oldUrlStillInUse) {
          try {
            await usagePersistence.migrate(current.url, url)
          }
          catch (cause) {
            scheduleUsagePersist()
            throw cause
          }
        }
      })
      bookmarkUrlMigrations.add(migration)
      try {
        await migration
      }
      finally {
        bookmarkUrlMigrations.delete(migration)
      }
    },

    removeBookmark: async (id) => {
      assertBookmarksApi()

      const [node] = await bookmarkApi.get(toNodeId(id))
      if (!node?.parentId)
        throw new Error('bookmark.not_found')
      await removeNativeBookmark(node.id)
      const snapshot = {
        label: localizedMessage('runtimeBookmarkLabel', {
          name: node.title || node.url || '',
        }),
        roots: [node],
        categoryMeta: {},
      }
      await get().persistDeletion(snapshot)
      beginUndoWindow(
        snapshot,
        pendingDeletion => set({ pendingDeletion }),
      )
      await get().loadBookmarks()
    },

    moveBookmarks: async (ids, categoryId) => {
      assertBookmarksApi()
      if (!get().categories.some(category => category.id === categoryId)) {
        throw new Error('category.target_not_found')
      }
      const selectedIds = new Set(ids)
      const targets = get().bookmarks.filter(bookmark =>
        selectedIds.has(bookmark.id),
      )
      await Promise.all(
        targets.map(bookmark =>
          bookmarkApi.move(toNodeId(bookmark.id), {
            parentId: resolveParentId(categoryId),
          }),
        ),
      )
      await get().markBookmarksOrganized(ids)
      await get().loadBookmarks()
      await get().recordActivity(
        'move',
        localizedMessage('runtimeBookmarkCountLabel', {
          count: targets.length,
        }),
      )
    },

    removeBookmarks: async (ids) => {
      assertBookmarksApi()
      const nodeIds = [...new Set(ids.map(toNodeId))]
      if (nodeIds.length === 0)
        return
      const nodes = (await bookmarkApi.get(nodeIds as [string, ...string[]]))
        .filter(node => node.url && node.parentId)
        .sort(
          (left, right) =>
            (left.parentId ?? '').localeCompare(right.parentId ?? '')
            || (left.index ?? 0) - (right.index ?? 0),
        )
      if (nodes.length === 0)
        return
      await suppressBookmarkDeletionArchive(nodes.map(node => node.id))
      try {
        await Promise.all(nodes.map(node => bookmarkApi.remove(node.id)))
      }
      catch (cause) {
        await releaseBookmarkDeletionArchive(nodes.map(node => node.id))
        throw cause
      }
      const snapshot = {
        label: nodes.length === 1
          ? localizedMessage('runtimeBookmarkLabel', {
              name: nodes[0].title || nodes[0].url || '',
            })
          : localizedMessage('runtimeBookmarkCountLabel', {
              count: nodes.length,
            }),
        roots: nodes,
        categoryMeta: {},
      }
      await get().persistDeletion(snapshot)
      beginUndoWindow(
        snapshot,
        pendingDeletion => set({ pendingDeletion }),
      )
      await get().loadBookmarks()
    },
  }
}
