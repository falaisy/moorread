import type { NativeSortScope } from './sort-types'
/**
 * 自動排序：依賴新引擎（bookmark-native-sort）的單一執行控制與事件辨識。
 *
 * 設計（依 Modern Web Guidance，不靠全域旗標/計時器當持久狀態）：
 *  - 待排序資料夾集合持久化在 chrome.storage.session（跨 SW 休眠保留，瀏覽器關閉清除）。
 *  - 同次工作階段內用短暫 debounce 批次收斂事件；計時器不是持久機制。
 *  - 序列化 flush（單一執行）；同一資料夾不會被兩個工作同時修改。
 *  - 引擎自己的 move 事件：靠 executor 的預期事件核對辨識；自動排不另外忽略事件，
 *    而是 flush 時若資料夾已排序（或手動模式）就不動，避免無限迴圈。
 *  - 使用者手動移動：不會被忽略；若該資料夾為 criteria 模式會重新排序，
 *    manual 模式則完全不動（保留使用者原生順序）。
 */
import type { NativeBookmarkSortSettings } from './types'
import {
  normalizeSortCriteria,
  sortNativeBookmarks,
} from './bookmark-native-sort'
import { createStoragePort } from './storage-port'
import { STORAGE_KEYS } from './store-persistence'

const DEBOUNCE_MS = 500
const PENDING_KEY = 'moorread:auto-sort-pending'
const settingsStorage = createStoragePort('sync')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

async function readPending(): Promise<Set<string>> {
  const stored = await chrome.storage.session.get(PENDING_KEY)
  const raw = stored?.[PENDING_KEY]
  return new Set(
    Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0) : [],
  )
}

async function writePending(ids: Set<string>): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: [...ids] })
}

/** 載入並正規化自動排需要的設定片段 */
async function loadSettings(): Promise<NativeBookmarkSortSettings | null> {
  const stored = await settingsStorage.get<Partial<{
    nativeBookmarkSort?: Partial<NativeBookmarkSortSettings>
  }>>(STORAGE_KEYS.settings)
  const raw = stored?.nativeBookmarkSort
  if (!raw)
    return null

  const validScopes = new Set<NativeSortScope>(['all', 'selected-only', 'selected-with-sub', 'children-only'])
  const scope: NativeSortScope = raw.scope && validScopes.has(raw.scope as NativeSortScope)
    ? raw.scope as NativeSortScope
    : (raw.targetMode === 'selected' ? (raw.includeSubfolders === true ? 'selected-with-sub' : 'selected-only') : 'all')

  const mode: NativeBookmarkSortSettings['sortMode']
    = raw.sortMode === 'manual' || raw.sortMode === 'random' ? raw.sortMode : 'criteria'

  return {
    enabled: raw.enabled === true,
    autoSort: raw.autoSort === true,
    sortCriteria: normalizeSortCriteria(raw.sortCriteria),
    sortMode: mode,
    scope,
    sortSelf: raw.sortSelf !== false,
    targetFolderIds: Array.isArray(raw.targetFolderIds)
      ? raw.targetFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    ignoreFolderIds: Array.isArray(raw.ignoreFolderIds)
      ? raw.ignoreFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    ...(typeof raw.randomSeed === 'number' && Number.isFinite(raw.randomSeed) ? { randomSeed: raw.randomSeed } : {}),
    ...(Array.isArray(raw.pinnedTop) ? { pinnedTop: raw.pinnedTop.filter((id): id is string => typeof id === 'string') } : {}),
    ...(Array.isArray(raw.pinnedBottom) ? { pinnedBottom: raw.pinnedBottom.filter((id): id is string => typeof id === 'string') } : {}),
    foldersFirst: raw.foldersFirst !== false,
    ...(Array.isArray(raw.folderRules) ? { folderRules: raw.folderRules } : {}),
  }
}

/** 該資料夾是否為手動模式（手動模式自動排完全不動，保留使用者原生順序） */
function isManualFolder(folderId: string, settings: NativeBookmarkSortSettings): boolean {
  const override = settings.folderRules?.find(r => r.folderId === folderId)
  const mode = override?.rule.mode ?? settings.sortMode ?? 'criteria'
  return mode === 'manual'
}

function isFolderAllowed(folderId: string, settings: NativeBookmarkSortSettings): boolean {
  if (!folderId)
    return false
  if (settings.ignoreFolderIds.includes(folderId))
    return false
  if (settings.scope !== 'all' && !settings.targetFolderIds.includes(folderId))
    return false
  return true
}

async function enqueue(folderIds: Array<string | undefined>): Promise<void> {
  const ids = folderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0)
    return
  const pending = await readPending()
  let changed = false
  for (const id of ids) {
    if (!pending.has(id)) {
      pending.add(id)
      changed = true
    }
  }
  if (changed)
    await writePending(pending)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushing)
    return // 執行中：flush 結束時會再檢查一次佇列
  if (debounceTimer !== null)
    clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void flush()
  }, DEBOUNCE_MS)
}

async function flush(): Promise<void> {
  if (flushing)
    return
  flushing = true
  try {
    const settings = await loadSettings()
    if (!settings?.enabled || !settings.autoSort) {
      // 自動排關閉：清空佇列，避免遺留
      await writePending(new Set())
      return
    }

    const pending = await readPending()
    for (const folderId of [...pending]) {
      if (!isFolderAllowed(folderId, settings) || isManualFolder(folderId, settings)) {
        pending.delete(folderId)
        continue
      }
      try {
        // selected-only + recurse=false：只排事件那層，不鑽子資料夾
        await sortNativeBookmarks({
          scope: 'selected-only',
          targetFolderIds: [folderId],
          ignoreFolderIds: settings.ignoreFolderIds,
          sortCriteria: settings.sortCriteria,
          sortSelf: true,
          recurse: false,
          sortMode: settings.sortMode,
          randomSeed: settings.randomSeed,
          pinnedTop: settings.pinnedTop,
          pinnedBottom: settings.pinnedBottom,
          foldersFirst: settings.foldersFirst,
          folderRules: settings.folderRules,
        })
      }
      catch {
        // 忙碌中（單一執行控制）或外部變動停止：不重試當次，留在佇列由下次事件/啟動處理
      }
      finally {
        pending.delete(folderId)
      }
    }
    await writePending(pending)

    // 執行期間若又累積新事件，接著排
    const next = await readPending()
    if (next.size > 0)
      scheduleFlush()
  }
  finally {
    flushing = false
  }
}

/** SW 啟動時檢查是否有上次休眠前遺留的待排資料夾，有就接續 flush */
export async function resumeNativeSortAutoOnStartup(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session)
    return
  const pending = await readPending()
  if (pending.size > 0)
    scheduleFlush()
}

/**
 * 註冊自動排監聽。應在 background service worker 頂層同步呼叫一次。
 * 五個書籤事件都納入；引擎自己的 move 事件由 executor 辨識，自動排不額外忽略。
 */
export function registerNativeSortAutoListener(): void {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    return

  chrome.bookmarks.onCreated.addListener((_id, createdInfo) => {
    void enqueue([createdInfo.parentId])
  })

  chrome.bookmarks.onChanged.addListener((id) => {
    chrome.bookmarks.get(id).then(([node]) => {
      void enqueue([node?.parentId])
    }).catch(() => {})
  })

  chrome.bookmarks.onMoved.addListener((_id, moveInfo) => {
    // 新舊資料夾都可能需要重排
    void enqueue([moveInfo.parentId, moveInfo.oldParentId])
  })

  chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
    void enqueue([removeInfo.parentId])
  })

  chrome.bookmarks.onChildrenReordered.addListener((id) => {
    void enqueue([id])
  })

  // 設定頁打開 autoSort 時，若有遺留佇列立即排一次
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[STORAGE_KEYS.settings])
      scheduleFlush()
  })
}
