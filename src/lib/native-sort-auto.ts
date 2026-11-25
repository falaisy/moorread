import type { NativeBookmarkSortSettings } from './types'
import { normalizeSortCriteria, sortNativeBookmarks } from './bookmark-native-sort'
import { createStoragePort } from './storage-port'
import { STORAGE_KEYS } from './store-persistence'

const DEBOUNCE_MS = 500
const settingsStorage = createStoragePort('sync')

/** 自動排是否正在執行；true 時所有事件一律跳過，避免 move 串發的連鎖。 */
let sortingInProgress = false
let pendingFolderIds: Set<string> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function loadSettings(): Promise<NativeBookmarkSortSettings | null> {
  const stored = await settingsStorage.get<Partial<{
    nativeBookmarkSort?: Partial<NativeBookmarkSortSettings>
  }>>(STORAGE_KEYS.settings)
  const raw = stored?.nativeBookmarkSort
  if (!raw)
    return null

  // scope 推導：新設直接用，舊設從 targetMode + includeSubfolders 推
  let scope: NativeBookmarkSortSettings['scope'] = 'all'
  if (raw.scope === 'all' || raw.scope === 'selected-with-sub' || raw.scope === 'children-only') {
    scope = raw.scope
  }
  else {
    const legacyMode = raw.targetMode === 'selected' ? 'selected' : 'all'
    const legacySubs = raw.includeSubfolders === true
    if (legacyMode === 'all')
      scope = 'all'
    else if (legacySubs)
      scope = raw.sortSelf === false ? 'children-only' : 'selected-with-sub'
    else
      scope = 'selected-with-sub'
  }

  return {
    enabled: raw.enabled === true,
    autoSort: raw.autoSort === true,
    sortCriteria: normalizeSortCriteria(raw.sortCriteria),
    scope,
    sortSelf: raw.sortSelf !== false,
    targetFolderIds: Array.isArray(raw.targetFolderIds)
      ? raw.targetFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    ignoreFolderIds: Array.isArray(raw.ignoreFolderIds)
      ? raw.ignoreFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
  }
}

/**
 * 把 parent folder 丟進待佇列，並重啟 debounce。
 * 從 createdInfo 或 changeInfo 都能拿到 parentId。
 * sortingInProgress 期間仍然收集，等當前這批排完後接著 flush。
 */
function schedule(parentId?: string): void {
  if (!parentId || typeof parentId !== 'string')
    return

  if (!pendingFolderIds)
    pendingFolderIds = new Set()
  pendingFolderIds.add(parentId)

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (!sortingInProgress) {
    debounceTimer = setTimeout(() => {
      void flush()
    }, DEBOUNCE_MS)
  }
}

async function flush(): Promise<void> {
  const folderIds = pendingFolderIds
  pendingFolderIds = null
  debounceTimer = null
  if (!folderIds || folderIds.size === 0)
    return

  const settings = await loadSettings()
  if (!settings?.enabled || !settings.autoSort)
    return

  // 若使用者只排指定資料夾，先把事件觸發的 parent 過濾一遍
  let targets: string[]
  if (settings.scope !== 'all') {
    const allowed = new Set(settings.targetFolderIds)
    targets = [...folderIds].filter(id => allowed.has(id))
    if (targets.length === 0)
      return // 這波事件都不在目標範圍內，直接跳過
  }
  else {
    targets = [...folderIds]
  }

  sortingInProgress = true
  try {
    await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: targets,
      ignoreFolderIds: settings.ignoreFolderIds,
      sortCriteria: settings.sortCriteria,
      sortSelf: true,
      recurse: false, // 自動排只排事件那層，不鑽子資料夾
    })
  }
  catch {
    // 自動排失敗不影響使用者；錯誤在 bookmark-native-sort.ts 內部已處理
  }
  finally {
    sortingInProgress = false
    // 執行期間若又累積了新事件，再起一個 debounce 接上
    if (pendingFolderIds && pendingFolderIds.size > 0 && debounceTimer === null) {
      debounceTimer = setTimeout(() => {
        void flush()
      }, DEBOUNCE_MS)
    }
  }
}

/**
 * 註冊自動排監聽。應該在 background service worker 啟動時呼叫一次。
 *
 * 監聽三種事件：
 *   - onCreated  → 新增書籤 / 資料夾
 *   - onChanged  → 改名 / 改網址
 *   - onMoved    → 拖到別的資料夾
 * sortNativeBookmarks 內部只會觸發 onMoved（純移動），所以我們用
 * sortingInProgress flag 擋掉「剛好是 sort 造成的 move」這一類事件，
 * 其他正常使用者操作的 move 仍然會被處理。
 */
export function registerNativeSortAutoListener(): void {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    return

  chrome.bookmarks.onCreated.addListener((_id, createdInfo) => {
    schedule(createdInfo.parentId)
  })

  chrome.bookmarks.onChanged.addListener((id) => {
    chrome.bookmarks.get(id).then(([node]) => {
      schedule(node?.parentId)
    }).catch(() => {})
  })

  chrome.bookmarks.onMoved.addListener((_id, moveInfo) => {
    if (sortingInProgress)
      return
    schedule(moveInfo.parentId)
    // 從舊資料夾移走後，舊資料夾也需要重新排序
    schedule(moveInfo.oldParentId)
  })

  // 當使用者在設定頁把 autoSort 打開時，如果當前有尚未 flush 的佇列，立即排一次
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === 'sync'
      && changes[STORAGE_KEYS.settings]
      && sortingInProgress === false
      && pendingFolderIds
    ) {
      void flush()
    }
  })
}
