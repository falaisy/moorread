import type { StoragePort } from './storage-port'
import type { BookmarkMeta, CategoryMeta } from './types'
import { createStoragePort, parseStoredRecord } from './storage-port'

// 补充描述和图标可能较多，使用 local 避免 sync 配额导致刷新后丢失。
export const metaStorage = createStoragePort('local')
export const settingsStorage = createStoragePort('sync')

export const STORAGE_KEYS = {
  meta: 'moorread:meta',
  categoryMeta: 'moorread:category-meta',
  settings: 'moorread:settings',
  usage: 'moorread:usage',
  metadataSyncLog: 'moorread:metadata-sync-log',
  metadataSyncPassphrase: 'moorread:metadata-sync-passphrase',
  tasks: 'moorread:tasks',
} as const

let supplementaryPersisted: () => Promise<void> = async () => {}
let metadataWriteQueue: Promise<unknown> = Promise.resolve()
let usageWriteQueue: Promise<unknown> = Promise.resolve()
let settingsWriteQueue: Promise<unknown> = Promise.resolve()

export function registerSupplementaryPersisted(callback: () => Promise<void>) {
  supplementaryPersisted = callback
}

// 持久化失败需要暴露给调用方，避免界面显示已同步但刷新后丢失。
export async function persist(client: StoragePort, key: string, value: unknown) {
  await client.set(key, value)
  if (
    client === metaStorage
    && (key === STORAGE_KEYS.meta || key === STORAGE_KEYS.categoryMeta)
  ) {
    await supplementaryPersisted()
  }
}

// All pages of this extension share the same Web Lock. Read inside the lock so
// a stale page only changes the requested fields of the latest stored metadata.
export async function withBookmarkMetadataLock<T>(commit: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(STORAGE_KEYS.meta, commit)

  const pending = metadataWriteQueue.then(commit, commit)
  metadataWriteQueue = pending.catch(() => undefined)
  return pending
}

export function updateBookmarkMetadata(
  update: (latest: Record<string, BookmarkMeta>) => Record<string, BookmarkMeta>,
  fallback: () => Record<string, BookmarkMeta>,
): Promise<Record<string, BookmarkMeta>> {
  return withBookmarkMetadataLock(async () => {
    const latest = await metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta)
      ?? fallback()
    const meta = update(latest)
    if (meta !== latest)
      await persist(metaStorage, STORAGE_KEYS.meta, meta)
    return meta
  })
}

/**
 * 儲存路徑專用的 metadata 更新：壞資料不得被當成空記錄覆寫。
 * 以原生 API 讀原始值（`@plasmohq/storage` 會把解析失敗吞成 undefined），
 * 形狀異常（非 JSON、非物件、entry 非純物件）一律不寫回並回報 `written: false`。
 */
export function updateBookmarkMetadataGuarded(
  update: (latest: Record<string, BookmarkMeta>) => Record<string, BookmarkMeta>,
): Promise<{ written: boolean }> {
  return withBookmarkMetadataLock(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.meta)
    const raw = stored[STORAGE_KEYS.meta]
    const latest = raw === undefined || raw === null
      ? {}
      : parseStoredRecord<BookmarkMeta>(raw)
    if (latest === undefined)
      return { written: false }
    const meta = update(latest)
    if (!meta || typeof meta !== 'object' || Array.isArray(meta))
      return { written: false }
    const entriesValid = Object.values(meta).every(entry => (
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
    ))
    if (!entriesValid)
      return { written: false }
    if (meta !== latest)
      await persist(metaStorage, STORAGE_KEYS.meta, meta)
    return { written: true }
  })
}

export function updateCategoryMetadata(
  update: (latest: Record<string, CategoryMeta>) => Record<string, CategoryMeta>,
  fallback: () => Record<string, CategoryMeta>,
): Promise<Record<string, CategoryMeta>> {
  return withBookmarkMetadataLock(async () => {
    const latest = await metaStorage.get<Record<string, CategoryMeta>>(STORAGE_KEYS.categoryMeta)
      ?? fallback()
    const categoryMeta = update(latest)
    if (categoryMeta !== latest)
      await persist(metaStorage, STORAGE_KEYS.categoryMeta, categoryMeta)
    return categoryMeta
  })
}

// 设置页与多个新标签页会同时写同一份设置；锁内读取最新值再合并，
// 避免持有旧快照的页面把默认文件夹等字段覆盖回旧值。
export async function withSettingsLock<T>(commit: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(STORAGE_KEYS.settings, commit)

  const pending = settingsWriteQueue.then(commit, commit)
  settingsWriteQueue = pending.catch(() => undefined)
  return pending
}

export async function withBookmarkUsageLock<T>(commit: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(STORAGE_KEYS.usage, commit)

  const pending = usageWriteQueue.then(commit, commit)
  usageWriteQueue = pending.catch(() => undefined)
  return pending
}
