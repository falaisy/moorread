import type { ExecutorResult } from './sort-executor'
import type { MoveStep } from './sort-snapshot'
import type {
  JobRecord,
  JobStatus,
  NativeFolderRule,
  NativeSortCriterion,
  NativeSortDirection,
  NativeSortField,
  NativeSortMode,
  NativeSortRule,
  NativeSortScope,
  PlannerNode,
  RestoreStats,
  SnapshotData,
} from './sort-types'
import {
  chromeBookmarkAdapter,
  chromeStorageAdapter,
  readPlannerTree,
} from './sort-chrome-adapter'
import { SORT_SNAPSHOT_KEY, SortExecutor } from './sort-executor'
/**
 * 薄型入口與接線層（不是第四個核心模組）。
 *
 * 三個核心模組：
 *   - sort-planner.ts   排序規則解析、範圍正規化、TargetState 計算
 *   - sort-snapshot.ts  排序前快照、復原計畫、部分復原統計
 *   - sort-executor.ts  唯一呼叫 chrome.bookmarks.move()，pending/指紋/事件核對/中斷恢復
 *
 * 這裡只做：
 *   1. 重新匯出公開型別與純函式，保持現有呼叫端（native-sort-auto / store / UI / 測試）相容。
 *   2. 把 chrome.* 包裝成 Executor 相依介面（sort-chrome-adapter）。
 *   3. sortNativeBookmarks：讀樹 → Planner 算計畫 → Snapshot 存快照 → Executor 執行。
 *   4. 暴露 executor 單例與 resume/discard/restore 給 background 與 UI 接線。
 */
import {
  buildSortPlan,
  compareNodes,
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
  MAX_SORT_CRITERIA,
  normalizeSortCriteria,
  normalizeSortRule,
  planToTargets,
} from './sort-planner'
import {
  buildRestorePlan,
  captureSnapshot,
  isValidSnapshot,
  planFolderMoves as planFolderMovesPure,
} from './sort-snapshot'

// ---------------------------------------------------------------------------
// 公開型別（重新匯出，保持向後相容）
// ---------------------------------------------------------------------------
export type {
  JobRecord,
  JobStatus,
  NativeFolderRule,
  NativeSortCriterion,
  NativeSortDirection,
  NativeSortField,
  NativeSortMode,
  NativeSortRule,
  NativeSortScope,
}

export {
  compareNodes,
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
  MAX_SORT_CRITERIA,
  normalizeSortCriteria,
  normalizeSortRule,
}

/** 舊版單資料夾排序配置（保留以避免破壞既有型別引用） */
export interface NativeFolderSortOptions {
  folderId: string
  sortCriteria: NativeSortCriterion[]
}

/** 單一步驟（向後搬） */
export interface FolderMoveStep {
  id: string
  from: number
  to: number
}

/**
 * 產生單一資料夾的移動計畫（接線層包裝，接受 {id}[] 以保持舊呼叫端相容）。
 * 實作邏輯在 sort-snapshot.ts。
 */
export function planFolderMoves(
  children: Array<{ id: string }>,
  sorted: Array<{ id: string }>,
): FolderMoveStep[] {
  return planFolderMovesPure(
    children.map(n => n.id),
    sorted.map(n => n.id),
  ) as MoveStep[] as FolderMoveStep[]
}

// ---------------------------------------------------------------------------
// 排序選項（在舊介面上擴充新欄位，全部選擇性，不破壞舊呼叫端）
// ---------------------------------------------------------------------------
export interface NativeBookmarkSortOptions {
  /** 四選一範圍 */
  scope: NativeSortScope
  /** 我選的資料夾（scope !== 'all' 時生效） */
  targetFolderIds?: string[]
  /** 要忽略的資料夾 id（黑名單，不管什麼 scope 都生效） */
  ignoreFolderIds?: string[]
  sortCriteria: NativeSortCriterion[]
  /** 同時排序目標資料夾本身；false 時只遞迴子資料夾（獨立於 scope） */
  sortSelf?: boolean
  /** 覆寫 scope 的遞迴行為；自動排傳 false，只排事件那層不鑽子資料夾 */
  recurse?: boolean

  // 以下為新引擎欄位（皆可省略，省略時走預設，不擴大範圍）
  /** 排序模式：criteria（預設）/ manual / random */
  sortMode?: NativeSortMode
  /** random 模式使用的固定種子（同一 job 重跑結果一致） */
  randomSeed?: number
  /** 置頂節點 id（保留順序，不被其他規則破壞） */
  pinnedTop?: string[]
  /** 置底節點 id */
  pinnedBottom?: string[]
  /** 資料夾優先（預設 true） */
  foldersFirst?: boolean
  /** 各資料夾獨立規則（inherit=false 覆寫上層） */
  folderRules?: NativeFolderRule[]
}

/** 排序結果 */
export interface NativeBookmarkSortResult {
  movedBookmarks: number
  movedFolders: number
  foldersProcessed: number
  verificationFailures: number
  skipped: Array<{ folderId: string, reason: string }>
  /** 工作狀態：completed 才算成功；其餘不可宣稱成功 */
  status: JobStatus
  /** 失敗/停止原因（若有） */
  error?: string
}

/** 復原結果 */
export interface NativeBookmarkRestoreResult {
  status: JobStatus
  stats: RestoreStats
  skipped: Array<{ folderId: string, reason: string }>
  error?: string
}

// ---------------------------------------------------------------------------
// Executor 單例（程序內唯一；狀態靠 storage 持久化，SW 休眠可恢復）
// ---------------------------------------------------------------------------
export const nativeSortExecutor = new SortExecutor({
  bookmarks: chromeBookmarkAdapter,
  storage: chromeStorageAdapter,
})

/** 從 chrome 事件監聽器抽出 info 型別，避免依賴未匯出的內部名稱 */
type MovedInfo = Parameters<Parameters<typeof chrome.bookmarks.onMoved.addListener>[0]>[1]
type ReorderedInfo = Parameters<Parameters<typeof chrome.bookmarks.onChildrenReordered.addListener>[0]>[1]
type ChangedInfo = Parameters<Parameters<typeof chrome.bookmarks.onChanged.addListener>[0]>[1]
type CreatedInfo = Parameters<Parameters<typeof chrome.bookmarks.onCreated.addListener>[0]>[1]
type RemovedInfo = Parameters<Parameters<typeof chrome.bookmarks.onRemoved.addListener>[0]>[1]

/**
 * 在 Service Worker 頂層同步註冊五個書籤事件監聽器，轉呼到 executor。
 * 必須在 resumeOnStartup() 之前呼叫，才能在恢復移動時正確核對事件。
 */
export function registerSortExecutorListeners(): void {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    return
  chrome.bookmarks.onMoved.addListener((id, info) => {
    void handleBookmarkMoved(id, info)
  })
  chrome.bookmarks.onChildrenReordered.addListener((id, info) => {
    void handleBookmarkChildrenReordered(id, info)
  })
  chrome.bookmarks.onChanged.addListener((id, info) => {
    void handleBookmarkChanged(id, info)
  })
  chrome.bookmarks.onCreated.addListener((id, info) => {
    void handleBookmarkCreated(id, info)
  })
  chrome.bookmarks.onRemoved.addListener((id, info) => {
    void handleBookmarkRemoved(id, info)
  })
}

/** 把 Chrome 原生書籤事件轉呼到 executor（background 頂層同步註冊後呼叫） */
export async function handleBookmarkMoved(id: string, info: MovedInfo): Promise<void> {
  await nativeSortExecutor.onMoved(id, {
    parentId: info.parentId,
    oldParentId: info.oldParentId,
    index: info.index,
    oldIndex: info.oldIndex,
  })
}
export async function handleBookmarkChildrenReordered(id: string, info: ReorderedInfo): Promise<void> {
  await nativeSortExecutor.onChildrenReordered(id, { childIds: info.childIds ?? [] })
}
export async function handleBookmarkChanged(id: string, info: ChangedInfo): Promise<void> {
  await nativeSortExecutor.onChanged(id, { title: info.title, url: info.url })
}
export async function handleBookmarkCreated(id: string, info: CreatedInfo): Promise<void> {
  await nativeSortExecutor.onCreated(id, { parentId: info.parentId ?? '', index: info.index })
}
export async function handleBookmarkRemoved(_id: string, info: RemovedInfo): Promise<void> {
  await nativeSortExecutor.onRemoved(_id, {
    parentId: info.parentId,
    index: info.index,
    node: {
      id: info.node.id,
      parentId: info.node.parentId,
      index: info.node.index,
      title: info.node.title,
      url: info.node.url,
    },
  })
}

function mapResult(r: ExecutorResult): NativeBookmarkSortResult {
  const j = r.job
  return {
    movedBookmarks: j.movedBookmarks,
    movedFolders: j.movedFolders,
    foldersProcessed: j.foldersProcessed,
    verificationFailures: j.verificationFailures,
    skipped: j.skipped,
    status: j.status,
    error: j.error,
  }
}

function buildDefaultRule(options: NativeBookmarkSortOptions, randomSeed?: number): NativeSortRule {
  return normalizeSortRule({
    mode: options.sortMode ?? 'criteria',
    criteria: options.sortCriteria,
    foldersFirst: options.foldersFirst ?? true,
    seed: randomSeed ?? options.randomSeed,
    pinnedTop: options.pinnedTop,
    pinnedBottom: options.pinnedBottom,
    inherit: true,
  })
}

/** Random seed 的持久化位置（全域與資料夾級共用同一套 seed 管理） */
export const RANDOM_SEED_KEY = 'moorread:sort-random-seed'

/**
 * 取得穩定的 Random seed：
 *  - 呼叫端明確指定（例如使用者主動按排序）→ 使用並持久化該 seed。
 *  - 否則讀取持久化 seed；不存在才建立一次並寫回。
 * 自動排序重複呼叫不得每次重新抽 seed，否則目標順序永遠在變、無法收斂。
 */
async function resolveRandomSeed(explicit?: number): Promise<number> {
  const hasExplicit = typeof explicit === 'number' && Number.isFinite(explicit)
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    if (hasExplicit)
      return (explicit as number) >>> 0
    throw new Error('storage api unavailable: cannot resolve random seed')
  }
  let seed: number
  if (hasExplicit) {
    seed = (explicit as number) >>> 0
  }
  else {
    let stored: Record<string, unknown>
    try {
      stored = await chrome.storage.local.get(RANDOM_SEED_KEY)
    }
    catch (cause) {
      throw new Error(`cannot read random seed: ${cause instanceof Error ? cause.message : 'unknown error'}`)
    }
    const value = stored?.[RANDOM_SEED_KEY]
    if (typeof value === 'number' && Number.isFinite(value))
      return value >>> 0
    seed = (Date.now() ^ Math.floor(Math.random() * 0x7FFFFFFF)) >>> 0
  }
  try {
    await chrome.storage.local.set({ [RANDOM_SEED_KEY]: seed })
  }
  catch (cause) {
    throw new Error(`cannot persist random seed: ${cause instanceof Error ? cause.message : 'unknown error'}`)
  }
  return seed
}

/**
 * 批量排序 Chrome 原生書籤（新引擎入口）。
 * 失敗/外部變動/中斷時 status !== 'completed'，呼叫端不可宣稱成功。
 *
 * 原始 Snapshot 的生命週期由 Executor 單一管理：真正需要移動的新排序才建立，
 * no-op、被拒絕、resume、restore 都不會覆寫；restore job 與它分開保存。
 */
export async function sortNativeBookmarks(
  options: NativeBookmarkSortOptions,
): Promise<NativeBookmarkSortResult> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    throw new Error('bookmarks api unavailable')

  // Online random：seed 持久化且穩定（全域與資料夾級共用），不得每次重抽
  const needsRandomSeed = options.sortMode === 'random'
    || (options.folderRules ?? []).some(fr => fr.rule?.mode === 'random' && fr.rule.seed === undefined)
  const randomSeed = needsRandomSeed ? await resolveRandomSeed(options.randomSeed) : options.randomSeed

  const tree = await readPlannerTree()
  const defaultRule = buildDefaultRule(options, randomSeed)
  // 資料夾級 random 規則同樣套用穩定 seed（缺 seed 時沿用全域管理的那組）
  const folderRules = options.folderRules?.map((fr) => {
    const rule = normalizeSortRule(fr.rule)
    if (rule.mode === 'random' && rule.seed === undefined && randomSeed !== undefined)
      rule.seed = randomSeed
    return { folderId: fr.folderId, rule }
  })

  const plan = buildSortPlan(tree, {
    scope: options.scope,
    targetFolderIds: options.targetFolderIds ?? [],
    ignoreFolderIds: options.ignoreFolderIds ?? [],
    defaultRule,
    folderRules,
    sortSelf: options.sortSelf,
    recurse: options.recurse,
  })

  const targets = planToTargets(plan)
  const scopeFolderIds = plan.folders.map(f => f.folderId)
  const snapshot = captureSnapshot(tree, scopeFolderIds)

  // Executor 決定原始 Snapshot 是否/何時保存：
  //  - 已有工作 / 啟動失敗 → runSort 在 createJob 前被拒絕，不會保存。
  //  - 自動排序的 no-op → executor 判定沒有移動，不會保存。
  //  - 保存失敗 → 工作立即 failed，且不執行任何 move。
  const result = await nativeSortExecutor.runSort(targets, snapshot)
  return mapResult(result)
}

/**
 * 讀取「最初排序前」的原始 Snapshot。
 * 讀取失敗、格式錯誤或不存在都必須明確回報，不得猜測或用其他 Snapshot fallback。
 */
async function readOriginalSnapshot(): Promise<SnapshotData> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local)
    throw new Error('storage api unavailable: cannot read original snapshot')
  let stored: Record<string, unknown>
  try {
    stored = await chrome.storage.local.get(SORT_SNAPSHOT_KEY)
  }
  catch (cause) {
    throw new Error(`cannot read original snapshot: ${cause instanceof Error ? cause.message : 'unknown error'}`)
  }
  const raw = stored[SORT_SNAPSHOT_KEY]
  if (raw === undefined || raw === null)
    throw new Error('no original snapshot to restore')
  if (!isValidSnapshot(raw))
    throw new Error('invalid original snapshot: refusing to restore')
  return raw
}

/**
 * 依最初排序前的原始 Snapshot 執行安全復原（獨立 restore job，有自己的快照與中斷恢復）。
 * 規則見 sort-snapshot.buildRestorePlan：已刪除不重建、父資料夾不存在跳過、
 * 跨資料夾移動跳過、排序期間新增節點保留在尾端且相對順序不變。
 *
 * - stats 以 Executor 實際成功移動數為準，不用計畫預估值。
 * - 原始 Snapshot 讀取失敗／格式錯誤／不存在 → 直接停止並回報，不 fallback 到 JobRecord.snapshot。
 * - restore 不覆蓋原始 Snapshot，只有使用者 discard 才清除。
 */
export async function restoreNativeBookmarks(): Promise<NativeBookmarkRestoreResult> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    throw new Error('bookmarks api unavailable')

  // 先安全停可能正在進行的 sort job：cancel() 不走 enqueue，立即觸發協作式停止
  await nativeSortExecutor.cancel()
  // 可靠等待目前執行鏈到達安全停止點（含執行中的 move 完成後的狀態處理），
  // 不用固定延遲猜測；restore 啟動前 preflightNoActive 會再檢查。
  await nativeSortExecutor.whenIdle()

  // 只使用獨立保存的原始 Snapshot；不得退回可能已被 restore job 更新的 JobRecord.snapshot
  const snapshot = await readOriginalSnapshot()

  const tree = await readPlannerTree()

  // 從目前實況樹建立 currentOrders（folderId -> 子節點 id 順序）
  const currentOrders: Record<string, string[]> = {}
  const indexTree = (nodes: PlannerNode[], parentId: string | undefined): void => {
    const ids: string[] = []
    for (const n of nodes) {
      ids.push(n.id)
      if (n.children?.length)
        indexTree(n.children, n.id)
    }
    if (parentId !== undefined)
      currentOrders[parentId] = ids
  }
  indexTree(tree, undefined)

  const restore = buildRestorePlan(snapshot, currentOrders)
  // restore job 自己的快照：排序（復原）前的目前狀態
  const restoreSnapshot = captureSnapshot(tree, Object.keys(snapshot.folderOrders))

  const result = await nativeSortExecutor.runRestore(restore.targets, restoreSnapshot)
  const job = result.job

  // 缺陷 5：stats 以 Executor 實際移動數為準（不是計畫預估值）
  // skipped 保留 buildRestorePlan 的計畫資訊（讓 UI 知道哪些節點因外部變動被跳過）
  return {
    status: job.status,
    stats: {
      restored: job.movedBookmarks + job.movedFolders,
      skipped: restore.stats.skipped,
      failed: (job.status === 'failed' || job.status === 'stopped-external') ? 1 : 0,
    },
    skipped: restore.skipped,
    error: job.error,
  }
}
