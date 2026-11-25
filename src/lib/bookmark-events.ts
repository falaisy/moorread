import type { HistoryEntry, TrashEntry } from './activity'
import type { LocalizedMessage, TranslationParams } from './i18n'
import type { RuntimeMessageKey } from './i18n-runtime'
import type { CategoryMeta } from './types'

import {
  historyStorageKey,
  pruneHistory,
  pruneTrash,
  trashRetentionMs,
  trashStorageKey,
} from './activity'
import { consumeBookmarkDeletionSuppression } from './bookmark-deletion-safety'
import { bookmarkGroupsKeyPrefix } from './bookmark-groups'
import { useBookmarkGroupsStore } from './bookmark-groups-store'
import { reportExpectedFallback } from './diagnostics'
import { legacyMigrationReady } from './legacy-migration-gate'
import { markLocalMetadataChanged } from './metadata-sync'
import { MIGRATION_MARKER_KEY } from './migrate-yunji-storage'
import { createStoragePort } from './storage-port'
import { STORAGE_KEYS, withBookmarkMetadataLock } from './store-persistence'

const localAreaStorage = createStoragePort('local')
/** 遷移完成前發生的刪除事件暫存在這裡；不是遷移鍵，也不顯示在 UI。 */
const pendingDeletionsKey = 'moorread:pending-external-deletions'
let bookmarkDeletionQueue = Promise.resolve()
let registered = false

interface PendingDeletion {
  /** 複合事件識別（node id ＋ 發生時間 ＋ 隨機序），用於重送去重。 */
  id: string
  node: chrome.bookmarks.BookmarkTreeNode
  queuedAt: number
}

function enqueueArchiveTask(task: () => Promise<void>): void {
  const next = bookmarkDeletionQueue.then(task)
  // 佇列本身只負責序列化，錯誤已在這裡回報；吞掉是為了不讓先前失敗卡住後續封存。
  bookmarkDeletionQueue = next.catch((cause) => {
    reportExpectedFallback('bookmark-events.archive-queue', cause)
  })
}

function runtimeMessage(
  key: RuntimeMessageKey,
  params?: TranslationParams,
): LocalizedMessage {
  return params ? { key, params } : { key }
}

function collectCategoryIds(node: chrome.bookmarks.BookmarkTreeNode): string[] {
  if (node.url)
    return []
  return [
    `cat-${node.id}`,
    ...(node.children ?? []).flatMap(collectCategoryIds),
  ]
}

function createDeletionEventId(node: chrome.bookmarks.BookmarkTreeNode): string {
  // 複合識別：node id ＋ 發生時間 ＋ 隨機序。同一書籤在不同時間被刪除是不同事件，
  // 不能只用 node id 合併；重送／崩潰恢復時沿用同一個 id 才能安全去重。
  return `${node.id}:${Date.now()}:${crypto.randomUUID()}`
}

function findArchivedEntry<T extends { sourceEventId?: string }>(
  stored: unknown,
  eventId: string,
): (T & { sourceEventId: string }) | undefined {
  if (!Array.isArray(stored))
    return undefined
  return stored.find(entry =>
    !!entry && typeof entry === 'object'
    && (entry as T).sourceEventId === eventId,
  ) as (T & { sourceEventId: string }) | undefined
}

async function archiveDeletion(
  node: chrome.bookmarks.BookmarkTreeNode,
  eventId: string,
): Promise<void> {
  await withBookmarkMetadataLock(async () => {
    const [storedTrash, storedHistory, storedCategoryMeta] = await Promise.all([
      localAreaStorage.get<unknown>(trashStorageKey),
      localAreaStorage.get<unknown>(historyStorageKey),
      localAreaStorage.get<Record<string, CategoryMeta>>(STORAGE_KEYS.categoryMeta),
    ])
    // 上次已寫入但清佇列前崩潰：只補缺少的那一側，不重複建立垃圾桶項目。
    const archivedTrash = findArchivedEntry<TrashEntry>(storedTrash, eventId)
    const archivedHistory = findArchivedEntry<HistoryEntry>(storedHistory, eventId)
    if (archivedTrash && archivedHistory)
      return
    const categoryIds = collectCategoryIds(node)
    const categoryMeta = { ...(storedCategoryMeta ?? {}) }
    const removedCategoryMeta: Record<string, CategoryMeta> = {}
    for (const id of categoryIds) {
      if (categoryMeta[id])
        removedCategoryMeta[id] = categoryMeta[id]
      delete categoryMeta[id]
    }
    const deletedAt = Date.now()
    const label = node.url
      ? runtimeMessage('runtimeExternalBookmarkDeletion', {
          name: node.title || node.url,
        })
      : runtimeMessage('runtimeExternalFolderDeletion', {
          name: node.title,
        })
    const entry: TrashEntry = {
      id: archivedTrash?.id ?? crypto.randomUUID(),
      label,
      deletedAt,
      expiresAt: deletedAt + trashRetentionMs,
      roots: [node],
      categoryMeta: removedCategoryMeta,
      sourceEventId: eventId,
    }
    const historyEntry: HistoryEntry = {
      id: archivedHistory?.id ?? crypto.randomUUID(),
      action: 'delete',
      label,
      createdAt: deletedAt,
      sourceEventId: eventId,
    }
    const trash = archivedTrash
      ? storedTrash as TrashEntry[]
      : [entry, ...pruneTrash(storedTrash)].slice(0, 100)
    const history = archivedHistory
      ? storedHistory as HistoryEntry[]
      : [historyEntry, ...pruneHistory(storedHistory)].slice(0, 200)
    await Promise.all([
      archivedTrash ? Promise.resolve() : localAreaStorage.set(trashStorageKey, trash),
      archivedHistory ? Promise.resolve() : localAreaStorage.set(historyStorageKey, history),
      localAreaStorage.set(STORAGE_KEYS.categoryMeta, categoryMeta),
      markLocalMetadataChanged(),
    ])
  })
}

function isPendingDeletion(value: unknown): value is PendingDeletion {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const item = value as PendingDeletion
  return typeof item.id === 'string' && item.id.length > 0
    && !!item.node && typeof item.node === 'object' && typeof item.node.id === 'string'
}

async function readPendingDeletions(): Promise<PendingDeletion[]> {
  try {
    const stored = await localAreaStorage.get<unknown>(pendingDeletionsKey)
    return Array.isArray(stored) ? stored.filter(isPendingDeletion) : []
  }
  catch {
    return []
  }
}

/** 先落盤再處理：service worker 休眠或處理中崩潰都不會遺失事件。 */
async function persistPendingDeletion(item: PendingDeletion): Promise<void> {
  const pending = await readPendingDeletions()
  if (pending.some(existing => existing.id === item.id))
    return
  pending.push(item)
  await localAreaStorage.set(pendingDeletionsKey, pending)
}

/**
 * 遷移完成前的刪除會先寫進持久佇列；兩鍵是 `keep-new` 目標，先寫會讓遷移
 * 跳過 `yunji-tab:*` 的舊垃圾桶與歷史。遷移就緒後由 flush 補寫，操作不遺失。
 */
async function archiveExternalBookmarkDeletion(
  node: chrome.bookmarks.BookmarkTreeNode,
): Promise<void> {
  if (await consumeBookmarkDeletionSuppression(node.id))
    return
  await persistPendingDeletion({
    id: createDeletionEventId(node),
    node,
    queuedAt: Date.now(),
  })
  await flushPendingDeletions()
}

/**
 * 把佇列中的刪除事件補寫進垃圾桶／歷史。
 * 只有遷移就緒才執行；逐筆封存、成功後才移除，失敗的留在佇列下次再試。
 * 封存本身以 `sourceEventId` 去重，因此「寫入成功但清佇列失敗」不會產生重複項目。
 */
async function flushPendingDeletions(): Promise<void> {
  if (!await legacyMigrationReady())
    return
  const pending = await readPendingDeletions()
  if (!pending.length)
    return
  const remaining: PendingDeletion[] = []
  for (const item of pending) {
    try {
      await archiveDeletion(item.node, item.id)
    }
    catch (cause) {
      remaining.push(item)
      reportExpectedFallback('bookmark-events.archive-flush', cause)
    }
  }
  if (remaining.length)
    await localAreaStorage.set(pendingDeletionsKey, remaining)
  else
    await localAreaStorage.remove(pendingDeletionsKey)
}

// Source bindings are local to this profile. Keep them current even with every
// home page closed; pending URL migrations survive service-worker restarts.
function reconcileGroupSources() {
  void useBookmarkGroupsStore.getState().reconcileSources().catch((cause) => {
    reportExpectedFallback('bookmark-events.reconcile-groups', cause)
  })
}

export function registerBookmarkEvents(): void {
  // MV3 事件必須在 service worker 頂層同步註冊；重複呼叫只會造成重複監聽。
  if (registered)
    return
  registered = true
  chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
    enqueueArchiveTask(async () => {
      // 先補寫遷移期間暫存的刪除，再處理這一筆，維持事件順序。
      await flushPendingDeletions()
      await archiveExternalBookmarkDeletion(removeInfo.node)
    })
  })
  chrome.bookmarks.onCreated.addListener(reconcileGroupSources)
  chrome.bookmarks.onChanged.addListener(reconcileGroupSources)
  chrome.bookmarks.onRemoved.addListener(reconcileGroupSources)
  chrome.runtime.onStartup.addListener(reconcileGroupSources)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && Object.keys(changes).some(key => key.startsWith(bookmarkGroupsKeyPrefix)))
      reconcileGroupSources()
    // 完成標記可能由其他 context（新分頁的 init）寫入；看到它就把暫存刪除補寫回去。
    if (areaName === 'local' && changes[MIGRATION_MARKER_KEY])
      enqueueArchiveTask(flushPendingDeletions)
  })
  reconcileGroupSources()
  // service worker 重啟時也嘗試補寫（上次若在遷移期間結束，佇列仍留著）。
  enqueueArchiveTask(flushPendingDeletions)
}
