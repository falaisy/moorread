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
import { resolveEffectiveRule } from './sort-planner'
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

/** 書籤樹的 parent 映射；讀不到時回傳 null（保守處理，不擴大範圍） */
async function loadParentMap(): Promise<Map<string, string | undefined> | null> {
  try {
    const tree = await chrome.bookmarks.getTree()
    const map = new Map<string, string | undefined>()
    const walk = (nodes: Array<{ id: string, children?: unknown }>, parentId: string | undefined): void => {
      for (const n of nodes) {
        map.set(n.id, parentId)
        walk((n.children as Array<{ id: string, children?: unknown }> | undefined) ?? [], n.id)
      }
    }
    walk(tree, undefined)
    return map
  }
  catch {
    return null
  }
}

/** 由最近的覆寫祖先決定模式；與 Planner 共用同一繼承語意 */
function isManualFolder(
  folderId: string,
  settings: NativeBookmarkSortSettings,
  parentOf: Map<string, string | undefined> | null,
): boolean {
  const globalMode = settings.sortMode ?? 'criteria'
  if (!parentOf) {
    // 無法取得祖先鏈：只看自己的明確覆寫，其餘沿用全局
    const own = settings.folderRules?.find(r => r.folderId === folderId)
    if (own !== undefined && own.rule.inherit !== true)
      return own.rule.mode === 'manual'
    return globalMode === 'manual'
  }
  // 全局模式即 defaultRule：資料夾的獨立覆寫仍可覆蓋它（與 Planner 一致）
  const rule = resolveEffectiveRule(
    folderId,
    parentOf,
    settings.folderRules,
    { mode: globalMode, criteria: settings.sortCriteria },
  )
  return rule.mode === 'manual'
}

/**
 * 該資料夾是否在本次排序範圍內（不因事件擴大使用者的選取範圍）：
 *  - selected-only    只有指定資料夾本身
 *  - selected-with-sub 指定資料夾及其所有未被忽略的後代
 *  - children-only    指定資料夾的後代，不含指定資料夾本身
 *  - all              全部（忽略清單與其整個子樹除外）
 */
function isFolderAllowed(
  folderId: string,
  settings: NativeBookmarkSortSettings,
  parentOf: Map<string, string | undefined> | null,
): boolean {
  if (!folderId)
    return false
  const ignored = new Set(settings.ignoreFolderIds)
  const targets = new Set(settings.targetFolderIds)

  // 自己或任何祖先是忽略資料夾 → 整個子樹排除
  let cursor: string | undefined = folderId
  while (cursor) {
    if (ignored.has(cursor))
      return false
    cursor = parentOf?.get(cursor)
  }

  if (settings.scope === 'all')
    return true
  if (settings.scope === 'selected-only')
    return targets.has(folderId)

  // 目標資料夾的後代（parentOf 不可用時保守地只承認目標本身）
  const hasTargetAncestor = (): boolean => {
    let cur = parentOf?.get(folderId)
    while (cur) {
      if (targets.has(cur))
        return true
      cur = parentOf?.get(cur)
    }
    return false
  }
  if (settings.scope === 'selected-with-sub')
    return targets.has(folderId) || hasTargetAncestor()
  // children-only：不含指定資料夾本身
  if (targets.has(folderId))
    return false
  return hasTargetAncestor()
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
  // 同一次 flush 內每個資料夾只嘗試一次，避免持續失敗者被無限快速重試
  const attempted = new Set<string>()
  let treeUnavailable = false
  try {
    const settings = await loadSettings()
    if (!settings?.enabled || !settings.autoSort) {
      // 自動排關閉：清空佇列，避免遺留
      await writePending(new Set())
      return
    }

    // 範圍／規則判斷需要祖先鏈（忽略子樹、selected-with-sub 後代、規則繼承）
    const parentOf = await loadParentMap()
    if (!parentOf) {
      // 讀不到書籤樹 → 不猜測範圍、不刪佇列，等下一次事件再處理（避免熱迴圈）
      treeUnavailable = true
      return
    }

    // HQ-4：正確傳遞 scope（selected-with-sub 要讓 Planner 自動展開子資料夾）
    const effectiveScope: NativeSortScope = settings.scope === 'all' || settings.scope === 'selected-with-sub'
      ? settings.scope
      : 'selected-only'

    // 缺陷 3+4：循環處理 pending —— 每次從 storage 讀最新狀態、完成後立即寫回，
    // 讓 enqueue 期間新加入的 folderId 不被 flush 的舊 Set 覆蓋。
    // 每個資料夾在同一輪只嘗試一次；失敗/外部變動/忙碌者 **保留** 在 pending，
    // 等下一次書籤事件或 SW 啟動再處理（不立即重試，避免迴圈）。
    for (;;) {
      const pending = await readPending()
      const folderId = [...pending].find(id => !attempted.has(id))
      if (!folderId)
        break
      attempted.add(folderId)

      // HQ-5 + 範圍檢查
      const manual = isManualFolder(folderId, settings, parentOf)
      if (!isFolderAllowed(folderId, settings, parentOf) || manual) {
        // 不處理的 folder：從 pending 移除（一次性決策）
        pending.delete(folderId)
        await writePending(pending)
        continue
      }

      try {
        const res = await sortNativeBookmarks({
          scope: effectiveScope,
          targetFolderIds: settings.scope === 'all' ? [] : [folderId],
          ignoreFolderIds: settings.ignoreFolderIds,
          sortCriteria: settings.sortCriteria,
          sortSelf: true,
          recurse: true,
          sortMode: settings.sortMode,
          randomSeed: settings.randomSeed,
          pinnedTop: settings.pinnedTop,
          pinnedBottom: settings.pinnedBottom,
          foldersFirst: settings.foldersFirst,
          folderRules: settings.folderRules,
        })
        // 缺陷 3：只有 status === 'completed' 才從 pending 移除
        if (res.status === 'completed') {
          const current = await readPending()
          current.delete(folderId)
          await writePending(current)
        }
        // 非 completed（failed / stopped-external / awaiting-user）：**保留** pending
      }
      catch {
        // 忙碌中（單一執行控制）或 API 錯誤：**保留** pending 到下次
      }
    }
  }
  finally {
    flushing = false
    if (!treeUnavailable) {
      // 若 flush 期間又新增了尚未嘗試的資料夾，再排一次；
      // 已嘗試但失敗者仍在 attempted，不會被立即重試。
      const left = await readPending()
      if ([...left].some(id => !attempted.has(id)))
        scheduleFlush()
    }
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
