import type { StateCreator } from 'zustand'
import type { LocalizedText } from './i18n'
import type { DeletionSnapshot, GroupSlice, NavState, PendingDeletion } from './store-types'
import type { Category, CategoryMeta } from './types'

import {
  historyStorageKey,
  pruneTrash,
  trashRetentionMs,
  trashStorageKey,
} from './activity'
import { assertBookmarksApi, bookmarkApi } from './bookmark-repository'
import { bookmarkTreeContainsNode, toNodeId } from './bookmark-tree'
import { DEFAULT_CATEGORY_EMOJI } from './default-data'
import { localizedMessage } from './i18n'
import { localizedErrorMessage } from './localized-error'
import {
  DEFAULT_PARENT_ID,
  removeNativeBookmark,
  restoreBookmarkTree,
} from './store-helpers'
import {
  metaStorage,
  persist,
  settingsStorage,
  STORAGE_KEYS,
  updateCategoryMetadata,
} from './store-persistence'

const UNDO_WINDOW_MS = 10_000

let deletionSnapshot: DeletionSnapshot | undefined
let deletionTimer: ReturnType<typeof setTimeout> | undefined

function collectCategoryIds(
  rootId: string,
  categories: Category[],
): Set<string> {
  // 先建一次 parent → children 索引，避免逐層反覆掃描整個分類陣列。
  const childIdsByParent = new Map<string, string[]>()
  for (const category of categories) {
    const siblings = childIdsByParent.get(category.parentId)
    if (siblings)
      siblings.push(category.id)
    else
      childIdsByParent.set(category.parentId, [category.id])
  }

  const collectedIds = new Set([rootId])
  const pendingIds = [rootId]
  while (pendingIds.length > 0) {
    const currentId = pendingIds.pop()
    if (!currentId)
      break
    for (const childId of childIdsByParent.get(currentId) ?? []) {
      if (collectedIds.has(childId))
        continue
      collectedIds.add(childId)
      pendingIds.push(childId)
    }
  }

  return collectedIds
}

function getMutableCategory(id: string, categories: Category[]): Category {
  const category = categories.find(candidate => candidate.id === id)
  if (!category)
    throw new Error('category.not_found')
  if (!category.modifiable)
    throw new Error('category.browser_root_readonly')
  return category
}

async function assertNativeCategoryMoveAllowed(
  sourceId: string,
  destinationId: string,
): Promise<void> {
  const sourceNodeId = toNodeId(sourceId)
  const destinationNodeId = toNodeId(destinationId)
  const [sourceTree] = await bookmarkApi.getSubTree(sourceNodeId)
  if (!sourceTree)
    throw new Error('category.not_found')
  if (bookmarkTreeContainsNode(sourceTree, destinationNodeId)) {
    throw new Error('category.circular_move')
  }

  const [destination] = await bookmarkApi.get(destinationNodeId)
  if (!destination || destination.url) {
    throw new Error('category.target_not_found')
  }
}

export function beginUndoWindow(
  snapshot: DeletionSnapshot,
  update: (pending: PendingDeletion | null) => void,
): void {
  if (deletionTimer)
    clearTimeout(deletionTimer)
  deletionSnapshot = snapshot
  update({
    label: snapshot.label,
    expiresAt: Date.now() + UNDO_WINDOW_MS,
    restoring: false,
  })
  deletionTimer = setTimeout(() => {
    deletionSnapshot = undefined
    deletionTimer = undefined
    update(null)
  }, UNDO_WINDOW_MS)
}

export const createGroupSlice: StateCreator<
  NavState,
  [],
  [],
  GroupSlice
> = (set, get) => ({
  pendingDeletion: null,

  addCategory: async (name, emoji) => {
    assertBookmarksApi()

    const trimmed = name.trim()
    const existing = get().categories.find(c => c.name === trimmed)
    if (existing)
      return existing.id
    if (!trimmed)
      throw new Error('category.name_required')

    const node = await bookmarkApi.create({
      parentId: DEFAULT_PARENT_ID,
      title: trimmed,
    })
    const categoryId = `cat-${node.id}`
    const normalizedEmoji = emoji?.trim()
    if (normalizedEmoji && normalizedEmoji !== DEFAULT_CATEGORY_EMOJI) {
      const categoryMeta = await updateCategoryMetadata(latest => ({
        ...latest,
        [categoryId]: { emoji: normalizedEmoji },
      }), () => get().categoryMeta)
      set({ categoryMeta })
    }
    await get().loadBookmarks()
    return categoryId
  },

  updateCategory: async (id, patch) => {
    assertBookmarksApi()

    const categories = get().categories
    const category = getMutableCategory(id, categories)
    const nodeId = toNodeId(id)
    let destination: Category | undefined

    if (patch.parentId && patch.parentId !== category.parentId) {
      destination = categories.find(
        candidate => candidate.id === patch.parentId,
      )
      if (!destination)
        throw new Error('category.target_not_found')
      const unavailableIds = collectCategoryIds(id, categories)
      if (unavailableIds.has(destination.id)) {
        throw new Error('category.circular_move')
      }
      await assertNativeCategoryMoveAllowed(id, destination.id)
    }

    if (patch.name !== undefined) {
      const title = patch.name.trim()
      if (!title)
        throw new Error('category.name_required')
      if (title !== category.name) {
        await bookmarkApi.update(nodeId, { title })
      }
    }

    if (destination) {
      await bookmarkApi.move(nodeId, {
        parentId: toNodeId(destination.id),
      })
    }

    if (patch.emoji !== undefined) {
      const emoji = patch.emoji.trim() || DEFAULT_CATEGORY_EMOJI
      const categoryMeta = await updateCategoryMetadata((latest) => {
        const categoryMeta = { ...latest }
        if (emoji === DEFAULT_CATEGORY_EMOJI)
          delete categoryMeta[id]
        else
          categoryMeta[id] = { emoji }
        return categoryMeta
      }, () => get().categoryMeta)
      set({ categoryMeta })
    }

    await get().loadBookmarks()
  },

  removeCategory: async (id) => {
    assertBookmarksApi()

    const categories = get().categories
    const category = getMutableCategory(id, categories)
    const removedIds = collectCategoryIds(id, categories)
    const [root] = await bookmarkApi.getSubTree(toNodeId(id))
    if (!root?.parentId)
      throw new Error('category.not_found')
    const removedCategoryMeta = Object.fromEntries(
      [...removedIds].flatMap((removedId) => {
        const metadata = get().categoryMeta[removedId]
        return metadata ? [[removedId, metadata]] : []
      }),
    )
    const removedDefaultCategoryId = removedIds.has(
      get().settings.defaultCategoryId,
    )
      ? get().settings.defaultCategoryId
      : undefined
    await removeNativeBookmark(toNodeId(id), true)

    let settings = get().settings
    const settingsChanged = removedIds.has(settings.defaultCategoryId)
    if (settingsChanged) {
      settings = { ...settings, defaultCategoryId: 'all' }
    }

    set({ settings })
    await Promise.allSettled([
      updateCategoryMetadata((latest) => {
        const categoryMeta = { ...latest }
        for (const removedId of removedIds) {
          if (categoryMeta[removedId])
            removedCategoryMeta[removedId] = categoryMeta[removedId]
          delete categoryMeta[removedId]
        }
        return categoryMeta
      }, () => get().categoryMeta).then(categoryMeta => set({ categoryMeta })),
      settingsChanged
        ? persist(settingsStorage, STORAGE_KEYS.settings, settings)
        : Promise.resolve(),
    ])
    const snapshot = {
      label: localizedMessage('runtimeFolderLabel', {
        name: category.name,
      }),
      roots: [root],
      categoryMeta: removedCategoryMeta,
      defaultCategoryId: removedDefaultCategoryId,
    }
    await get().persistDeletion(snapshot)
    beginUndoWindow(
      snapshot,
      pendingDeletion => set({ pendingDeletion }),
    )
    await get().loadBookmarks()
  },

  undoLastDeletion: async () => {
    assertBookmarksApi()
    const snapshot = deletionSnapshot
    if (!snapshot)
      return
    if (deletionTimer)
      clearTimeout(deletionTimer)
    deletionTimer = undefined
    set(state => ({
      pendingDeletion: state.pendingDeletion
        ? { ...state.pendingDeletion, restoring: true }
        : null,
    }))

    const categoryIdMap = new Map<string, string>()
    try {
      for (const root of snapshot.roots) {
        // Sequential restoration keeps retry accounting aligned with completed roots.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await restoreBookmarkTree(
          root,
          root.parentId ?? DEFAULT_PARENT_ID,
          categoryIdMap,
        )
      }
    }
    catch (cause) {
      deletionSnapshot = undefined
      set(state => ({
        pendingDeletion: state.pendingDeletion
          ? { ...state.pendingDeletion, restoring: false, restoreFailed: true }
          : null,
      }))
      deletionTimer = setTimeout(() => {
        deletionTimer = undefined
        set({ pendingDeletion: null })
      }, 5_000)
      throw cause
    }

    const restoredCategoryMeta: Record<string, CategoryMeta> = {}
    for (const [oldId, meta] of Object.entries(snapshot.categoryMeta)) {
      const newId = categoryIdMap.get(oldId)
      if (newId)
        restoredCategoryMeta[newId] = meta
    }

    let settings = get().settings
    if (snapshot.defaultCategoryId) {
      const restoredDefaultId = categoryIdMap.get(snapshot.defaultCategoryId)
      if (restoredDefaultId) {
        settings = { ...settings, defaultCategoryId: restoredDefaultId }
      }
    }

    deletionSnapshot = undefined
    const trashEntry = get().trash.find(item => item.label === snapshot.label)
    if (trashEntry)
      await get().removeTrashEntry(trashEntry.id)
    await get().recordActivity('restore', snapshot.label)
    set({ settings, pendingDeletion: null })
    await Promise.allSettled([
      updateCategoryMetadata(
        latest => ({ ...latest, ...restoredCategoryMeta }),
        () => get().categoryMeta,
      ).then(categoryMeta => set({ categoryMeta })),
      persist(settingsStorage, STORAGE_KEYS.settings, settings),
    ])
    await get().loadBookmarks()
  },

  persistDeletion: async (snapshot) => {
    const deletedAt = Date.now()
    const trash = [{
      id: crypto.randomUUID(),
      ...snapshot,
      deletedAt,
      expiresAt: deletedAt + trashRetentionMs,
    }, ...pruneTrash(get().trash)].slice(0, 100)
    set({ trash })
    await Promise.all([
      metaStorage.set(trashStorageKey, trash),
      get().recordActivity('delete', snapshot.label),
    ])
  },

  recordActivity: async (action, label) => {
    const history = [{
      id: crypto.randomUUID(),
      action,
      label,
      createdAt: Date.now(),
    }, ...get().history].slice(0, 200)
    set({ history })
    await metaStorage.set(historyStorageKey, history)
  },

  restoreTrashEntry: async (id) => {
    assertBookmarksApi()
    const entry = get().trash.find(item => item.id === id)
    if (!entry)
      return { restoredRootCount: 0, remainingRootCount: 0, failedRootCount: 0 }
    get().beginTask({
      id: `trash-restore:${id}`,
      type: 'trash-restore',
      label: localizedMessage('runtimeRestoreTask'),
      total: entry.roots.length - (entry.restoredRootIndexes?.length ?? 0),
    })
    const categoryIdMap = new Map<string, string>()
    const completed = new Set(entry.restoredRootIndexes ?? [])
    let restoredRootCount = 0
    let failedRootCount = 0
    let restoreError: LocalizedText = ''
    for (const [index, root] of entry.roots.entries()) {
      if (completed.has(index))
        continue
      let parentId = root.parentId ?? DEFAULT_PARENT_ID
      try {
        const [parent] = await bookmarkApi.get(parentId)
        if (!parent || parent.url)
          parentId = DEFAULT_PARENT_ID
      }
      catch {
        parentId = DEFAULT_PARENT_ID
      }
      try {
        await restoreBookmarkTree(root, parentId, categoryIdMap)
        completed.add(index)
        restoredRootCount += 1
        get().updateTask(`trash-restore:${id}`, { completed: restoredRootCount })
        const trash = get().trash.map(item => item.id === id
          ? { ...item, restoredRootIndexes: [...completed], restoreError: undefined }
          : item)
        set({ trash })
        await metaStorage.set(trashStorageKey, trash)
      }
      catch (cause) {
        failedRootCount += 1
        restoreError = localizedErrorMessage(cause, 'runtimeRestoreFailed')
      }
    }
    const restoredCategoryMeta: Record<string, CategoryMeta> = {}
    for (const [oldId, meta] of Object.entries(entry.categoryMeta)) {
      const newId = categoryIdMap.get(oldId)
      if (newId)
        restoredCategoryMeta[newId] = meta
    }
    const categoryMeta = await updateCategoryMetadata(
      latest => ({ ...latest, ...restoredCategoryMeta }),
      () => get().categoryMeta,
    )
    const remainingRootCount = entry.roots.length - completed.size
    const trash = remainingRootCount === 0
      ? get().trash.filter(item => item.id !== id)
      : get().trash.map(item => item.id === id
          ? { ...item, restoredRootIndexes: [...completed], restoreError }
          : item)
    set({ trash, categoryMeta })
    const operations: Array<Promise<unknown>> = [
      metaStorage.set(trashStorageKey, trash),
    ]
    if (restoredRootCount > 0)
      operations.push(get().recordActivity('restore', entry.label))
    await Promise.all(operations)
    await get().loadBookmarks()
    get().finishTask(
      `trash-restore:${id}`,
      remainingRootCount === 0 ? 'success' : 'error',
      remainingRootCount === 0
        ? localizedMessage('runtimeRestoreComplete')
        : localizedMessage('runtimeRestorePartial', {
            count: failedRootCount,
          }),
    )
    return { restoredRootCount, remainingRootCount, failedRootCount }
  },

  removeTrashEntry: async (id) => {
    const trash = get().trash.filter(item => item.id !== id)
    set({ trash })
    await metaStorage.set(trashStorageKey, trash)
  },

  clearHistory: async () => {
    set({ history: [] })
    await metaStorage.set(historyStorageKey, [])
  },

  clearTrash: async () => {
    set({ trash: [] })
    await metaStorage.set(trashStorageKey, [])
  },
})
