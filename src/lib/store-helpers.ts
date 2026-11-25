import type { NativeBookmarkSnapshotNode } from './backup'
import type { BookmarkTreeNode } from './bookmark-tree'
import type {
  Bookmark,
  BookmarkMeta,
  BookmarkUsage,
  Category,
  CategoryMeta,
} from './types'

import { releaseBookmarkDeletionArchive, suppressBookmarkDeletionArchive } from './bookmark-deletion-safety'
import { bookmarkApi } from './bookmark-repository'
import { toNodeId } from './bookmark-tree'
import { normalizeAlternateBookmarkUrls } from './bookmark-urls'
import { createBookmarkUsagePersistence } from './bookmark-usage'
import { reportExpectedFallback } from './diagnostics'
import {
  metaStorage,
  persist,
  STORAGE_KEYS,
  withBookmarkUsageLock,
} from './store-persistence'
import { isLegacyFaviconUrl } from './utils'

export const DEFAULT_PARENT_ID = '1'
export const metadataAutoSyncDelayMs = 30_000
export const usagePersistDelayMs = 500

export async function restoreBookmarkTree(
  node: BookmarkTreeNode,
  parentId: string,
  categoryIdMap: Map<string, string>,
): Promise<string> {
  const restored = await bookmarkApi.create({
    parentId,
    index: node.index,
    title: node.title,
    url: node.url,
  })
  if (!node.url) {
    categoryIdMap.set(`cat-${node.id}`, `cat-${restored.id}`)
  }
  try {
    for (const child of node.children ?? []) {
      // Restore siblings in source order and stop before creating later nodes on failure.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await restoreBookmarkTree(child, restored.id, categoryIdMap)
    }
    return restored.id
  }
  catch (cause) {
    try {
      await suppressBookmarkDeletionArchive([restored.id])
      if (node.url)
        await bookmarkApi.remove(restored.id)
      else
        await bookmarkApi.removeTree(restored.id)
    }
    catch {
      // Preserve the original restore failure; the trash entry remains retryable.
    }
    throw cause
  }
}

export async function removeNativeBookmark(id: string, tree = false): Promise<void> {
  await suppressBookmarkDeletionArchive([id])
  try {
    if (tree)
      await bookmarkApi.removeTree(id)
    else
      await bookmarkApi.remove(id)
  }
  catch (cause) {
    await releaseBookmarkDeletionArchive([id])
    throw cause
  }
}

export async function restoreSnapshotNode(
  node: NativeBookmarkSnapshotNode,
  parentId: string,
  path: string[],
  categoryIdByPath: Map<string, string>,
  onNodeCreated?: () => void,
): Promise<number> {
  // Creation is the required side effect for URL nodes even though their result ID is unused.
  // react-doctor-disable-next-line react-doctor/async-defer-await
  const restored = await chrome.bookmarks.create({
    parentId,
    title: node.title || node.url || '',
    url: node.url,
  })
  onNodeCreated?.()
  if (node.url)
    return 1

  const nextPath = [...path, node.title]
  categoryIdByPath.set(JSON.stringify(nextPath), `cat-${restored.id}`)
  let count = 1
  for (const child of node.children ?? []) {
    // Child creation is ordered so browser bookmark indices remain deterministic.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    count += await restoreSnapshotNode(
      child,
      restored.id,
      nextPath,
      categoryIdByPath,
      onNodeCreated,
    )
  }
  return count
}

// Counts every node a restore will create, so progress can be reported while it runs.
export function countSnapshotNodes(nodes: NativeBookmarkSnapshotNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countSnapshotNodes(node.children ?? []), 0) + 1
}

// 分类 id → 浏览器书签 parentId；"all" 回退到书签栏
export function resolveParentId(categoryId: string): string {
  return categoryId && categoryId !== 'all'
    ? toNodeId(categoryId)
    : DEFAULT_PARENT_ID
}

// 按元数据表（url 索引）为书签补充描述/图标
export function applyMeta(
  bookmarks: Bookmark[],
  meta: Record<string, BookmarkMeta>,
): Bookmark[] {
  return bookmarks.map((b) => {
    const m = meta[b.url] ?? {}
    const fields = ['description', 'icon', 'alternateUrls', 'pinnedAt', 'pinnedOrder', 'tags', 'inboxAt'] as const
    if (fields.every(field => JSON.stringify(b[field]) === JSON.stringify(m[field])))
      return b
    return {
      ...b,
      description: m.description,
      icon: m.icon,
      alternateUrls: m.alternateUrls,
      pinnedAt: m.pinnedAt,
      pinnedOrder: m.pinnedOrder,
      tags: m.tags,
      inboxAt: m.inboxAt,
    }
  })
}

export function mergeAlternateUrlsForDuplicate(
  existing: string[] | undefined,
  candidates: string[],
  primaryUrl: string,
): string[] {
  return normalizeAlternateBookmarkUrls(
    [...(existing ?? []), ...candidates],
    primaryUrl,
  )
}

export function applyCategoryMeta(
  categories: Category[],
  categoryMeta: Record<string, CategoryMeta>,
): Category[] {
  return categories.map(category => ({
    ...category,
    emoji: categoryMeta[category.id]?.emoji ?? category.emoji,
  }))
}

export function removeLegacyFaviconMeta(meta: Record<string, BookmarkMeta>): {
  meta: Record<string, BookmarkMeta>
  changed: boolean
} {
  const cleaned = { ...meta }
  let changed = false

  for (const [url, bookmarkMeta] of Object.entries(cleaned)) {
    if (!isLegacyFaviconUrl(bookmarkMeta.icon))
      continue
    changed = true
    const { icon: _icon, ...next } = bookmarkMeta
    if (next.description || next.alternateUrls?.length || next.pinnedAt
      || next.tags?.length || next.inboxAt) {
      cleaned[url] = next
    }
    else {
      delete cleaned[url]
    }
  }

  return { meta: cleaned, changed }
}

let publishUsage: (usage: Record<string, BookmarkUsage>) => void = () => {}
export const usagePersistence = createBookmarkUsagePersistence({
  read: () => metaStorage.get<Record<string, BookmarkUsage>>(STORAGE_KEYS.usage),
  write: usage => persist(metaStorage, STORAGE_KEYS.usage, usage),
  withLock: withBookmarkUsageLock,
  onChange: usage => publishUsage(usage),
})

export function setUsagePublisher(
  publisher: (usage: Record<string, BookmarkUsage>) => void,
): void {
  publishUsage = publisher
}

let usagePersistTimer: ReturnType<typeof setTimeout> | undefined
let usagePersistFailures = 0

export async function flushUsagePersistence(): Promise<void> {
  if (usagePersistTimer) {
    clearTimeout(usagePersistTimer)
    usagePersistTimer = undefined
  }
  if (!usagePersistence.hasPending())
    return
  try {
    await usagePersistence.flush()
    usagePersistFailures = 0
  }
  catch (cause) {
    usagePersistFailures += 1
    if (!usagePersistTimer)
      scheduleUsagePersistAfter(Math.min(5_000 * 2 ** (usagePersistFailures - 1), 60_000))
    throw cause
  }
}

function scheduleUsagePersistAfter(delayMs: number) {
  if (usagePersistTimer)
    clearTimeout(usagePersistTimer)
  usagePersistTimer = setTimeout(() => {
    usagePersistTimer = undefined
    void flushUsagePersistence()
      .catch(cause => reportExpectedFallback('usage.flush', cause))
  }, delayMs)
}

export function scheduleUsagePersist(): void {
  scheduleUsagePersistAfter(usagePersistDelayMs)
}
