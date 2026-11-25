import type { BookmarkTreeNode } from './bookmark-tree'

import type { NativeSortScope } from './types'

/** 排序維度 */
export type NativeSortField = 'title' | 'url' | 'dateAdded' | 'dateLastUsed'

/** 排序方向 */
export type NativeSortDirection = 'asc' | 'desc'

/** 單一排序依據 */
export interface NativeSortCriterion {
  field: NativeSortField
  direction: NativeSortDirection
}

/** 最多允許幾個依據（太多沒意義，Chrome 書籤同值的機率很低） */
export const MAX_SORT_CRITERIA = 3

/** 預設排序依據（向後兼容 + 新安裝） */
export const DEFAULT_SORT_CRITERIA: NativeSortCriterion[] = [
  { field: 'title', direction: 'asc' },
]

/** 單個資料夾的排序配置 */
export interface NativeFolderSortOptions {
  folderId: string
  sortCriteria: NativeSortCriterion[]
}

/** 全書籤樹批量排序配置 */
export interface NativeBookmarkSortOptions {
  /** 三選一範圍 */
  scope: NativeSortScope
  /** 我選的資料夾（scope !== 'all' 時生效） */
  targetFolderIds: string[]
  /** 要忽略的資料夾 id（黑名單，不管什麼 scope 都生效） */
  ignoreFolderIds: string[]
  sortCriteria: NativeSortCriterion[]
  /** 同時排序目標資料夾本身；false 時只遞迴子資料夾（獨立於 scope） */
  sortSelf: boolean
  /**
   * 覆寫 scope 的遞迴行為；預設 undefined 時三種 scope 都遞迴。
   *  自動排（native-sort-auto.ts）傳 false，只排事件那層不鑽子資料夾。
   */
  recurse?: boolean
}

/** 從舊欄位推導 scope（舊版設定升級用） */
export function deriveScopeFromLegacy(
  targetMode: 'all' | 'selected',
  includeSubfolders: boolean,
): NativeSortScope {
  if (targetMode === 'all')
    return 'all'
  // selected + includeSubfolders=true → children-only 或 self-and-children 取決於 sortSelf
  // 但 sortSelf 是獨立開關，這裡只考慮 scope 三選一
  return includeSubfolders ? 'selected-with-sub' : 'selected-with-sub'
}

/** 排序結果 */
export interface NativeBookmarkSortResult {
  /** 被移動的書籤總數 */
  movedBookmarks: number
  /** 被移動的子資料夾總數 */
  movedFolders: number
  /** 處理過的資料夾數 */
  foldersProcessed: number
  /** 排序後重新讀取原生順序仍與目標不符的資料夾數 */
  verificationFailures: number
  /** 被跳過的資料夾原因 */
  skipped: Array<{ folderId: string, reason: string }>
}

/** 判斷某個欄位值是否為「缺失」（缺失值永遠排最後，與 direction 無關） */
function isFieldMissing(field: NativeSortField, node: BookmarkTreeNode): boolean {
  switch (field) {
    case 'title':
      return !(node.title ?? '').trim()
    case 'url':
      return !(node.url ?? '').trim()
    case 'dateAdded':
      return node.dateAdded == null
    case 'dateLastUsed':
      return node.dateLastUsed == null
    default:
      return false
  }
}

/** 單一欄位比較（不處理資料夾 vs 書籤、不處理缺失值、不處理 direction） */
function singleFieldCmp(
  field: NativeSortField,
  left: BookmarkTreeNode,
  right: BookmarkTreeNode,
): number {
  switch (field) {
    case 'title':
      return (left.title ?? '').localeCompare(right.title ?? '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    case 'url':
      return (left.url ?? '').localeCompare(right.url ?? '', undefined, {
        sensitivity: 'base',
      })
    case 'dateAdded':
      return (left.dateAdded ?? 0) - (right.dateAdded ?? 0)
    case 'dateLastUsed':
      return (left.dateLastUsed ?? 0) - (right.dateLastUsed ?? 0)
    default:
      return 0
  }
}

/** 多欄位鏈比較：依序跑每個 criterion，第一個非零就返回 */
export function compareNodes(
  sortCriteria: NativeSortCriterion[],
): (left: BookmarkTreeNode, right: BookmarkTreeNode) => number {
  return (left, right) => {
    // 資料夾排在書籤前面（Chrome 預設習慣）
    if (!left.url && right.url)
      return -1
    if (left.url && !right.url)
      return 1

    for (const criterion of sortCriteria) {
      const leftMissing = isFieldMissing(criterion.field, left)
      const rightMissing = isFieldMissing(criterion.field, right)
      // 缺失值永遠排最後，不受 direction 翻轉
      if (leftMissing && !rightMissing)
        return 1
      if (!leftMissing && rightMissing)
        return -1

      const rawCmp = singleFieldCmp(criterion.field, left, right)
      if (rawCmp !== 0) {
        const factor = criterion.direction === 'asc' ? 1 : -1
        return rawCmp * factor
      }
    }

    // 全部依據平手 → 穩定排序用 index
    return (left.index ?? 0) - (right.index ?? 0)
  }
}

/** 小延遲，避免 chrome.bookmarks.move 大量快速調用觸發限流 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 15))
}

/**
 * 產生單一資料夾的移動計畫。
 *
 * Chrome 的 `bookmarks.move(id, { index })` 對「同層往前搬」會把落點算成 index-1
 * （實測：[A,B,C,D] move A index 3 → [B,C,A,D]），因此這裡只規劃「向後搬」：
 * 由左而右固定每個位置，把目標項目從目前位置搬到目標位置（from 必定大於 to），
 * 向後搬不受上述位移影響，執行後的實際順序與本地模型一致。
 */
export interface FolderMoveStep {
  id: string
  from: number
  to: number
}

export function planFolderMoves(
  children: Array<{ id: string }>,
  sorted: Array<{ id: string }>,
): FolderMoveStep[] {
  const current = children.map(node => node.id)
  const steps: FolderMoveStep[] = []
  for (let to = 0; to < sorted.length; to++) {
    const id = sorted[to].id
    const from = current.indexOf(id)
    // 找不到（已被外部刪除）或已在正確位置 → 不移動
    if (from === -1 || from === to)
      continue
    steps.push({ id, from, to })
    current.splice(from, 1)
    current.splice(to, 0, id)
  }
  return steps
}

async function sortFolderChildren(
  folderId: string,
  sortCriteria: NativeSortCriterion[],
): Promise<{
  movedBookmarks: number
  movedFolders: number
  verified: boolean
  skipped: Array<{ folderId: string, reason: string }>
}> {
  const skipped: Array<{ folderId: string, reason: string }> = []

  let children: BookmarkTreeNode[]
  try {
    children = await chrome.bookmarks.getChildren(folderId)
  }
  catch {
    skipped.push({ folderId, reason: 'cannot read folder' })
    return { movedBookmarks: 0, movedFolders: 0, verified: false, skipped }
  }

  if (children.length < 2)
    return { movedBookmarks: 0, movedFolders: 0, verified: true, skipped }

  const sorted = [...children].sort(compareNodes(sortCriteria))
  const steps = planFolderMoves(children, sorted)

  let movedBookmarks = 0
  let movedFolders = 0
  let model = [...children]
  for (const step of steps) {
    const target = model.find(node => node.id === step.id)
    if (!target)
      continue

    try {
      await chrome.bookmarks.move(step.id, {
        parentId: folderId,
        index: step.to,
      })
      // 只有原生移動成功才計入，並依節點實際類型分開統計。
      if (target.url)
        movedBookmarks++
      else
        movedFolders++
      model = model.filter(node => node.id !== step.id)
      model.splice(step.to, 0, target)
      await tick()
    }
    catch {
      skipped.push({ folderId: step.id, reason: 'move failed' })
    }
  }

  // 完成後以 Chrome 原生順序核對目標，不以內部模型宣稱成功。
  let verified = false
  try {
    const actual = await chrome.bookmarks.getChildren(folderId)
    verified = actual.length === sorted.length
      && actual.every((node, index) => node.id === sorted[index].id)
  }
  catch {
    verified = false
  }
  if (!verified)
    skipped.push({ folderId, reason: 'order verification failed' })

  return { movedBookmarks, movedFolders, verified, skipped }
}

/** 收集所有可寫資料夾 */
function collectWritableFolders(
  nodes: BookmarkTreeNode[],
  ignoreIds: Set<string>,
  acc: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.url)
      continue
    if (node.unmodifiable || ignoreIds.has(node.id))
      continue
    acc.push(node.id)
    if (node.children?.length)
      collectWritableFolders(node.children, ignoreIds, acc)
  }
  return acc
}

/**
 * 批量排序 Chrome 原生書籤。
 *
 * scope 三選一 + sortSelf 獨立開關的語義：
 *   scope='all'               → 所有可寫資料夾 + 遞迴子資料夾；頂層排不排自己看 sortSelf
 *   scope='selected-with-sub' → targetFolderIds + 遞迴子；頂層排不排自己看 sortSelf
 *   scope='children-only'     → targetFolderIds + 遞迴子；頂層 sortSelf 強制 false
 *
 * recurse 參數可覆寫：自動排傳 recurse=false，只排事件那層不鑽子。
 */
export async function sortNativeBookmarks(
  options: NativeBookmarkSortOptions,
): Promise<NativeBookmarkSortResult> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new Error('bookmarks api unavailable')
  }

  const [tree] = await chrome.bookmarks.getTree()

  // 1. 決定頂層要處理哪些資料夾
  let folderIds: string[]
  if (options.scope === 'all') {
    folderIds = collectWritableFolders(
      tree.children ?? [],
      new Set(options.ignoreFolderIds),
    )
  }
  else {
    folderIds = options.targetFolderIds
  }

  // 2. children-only 強制不排自己
  const shouldSortSelf = options.scope === 'children-only'
    ? false
    : options.sortSelf

  // 3. 遞迴：scope 三選一預設都遞迴；recurse 參數可覆寫
  const shouldRecurse = options.recurse !== false

  const rootResult: NativeBookmarkSortResult = {
    movedBookmarks: 0,
    movedFolders: 0,
    foldersProcessed: 0,
    verificationFailures: 0,
    skipped: [],
  }

  for (const folderId of folderIds) {
    if (shouldSortSelf) {
      const { movedBookmarks, movedFolders, verified, skipped } = await sortFolderChildren(
        folderId,
        options.sortCriteria,
      )

      rootResult.foldersProcessed++
      rootResult.movedBookmarks += movedBookmarks
      rootResult.movedFolders += movedFolders
      if (!verified)
        rootResult.verificationFailures++
      rootResult.skipped.push(...skipped)
    }

    if (shouldRecurse) {
      try {
        const children = await chrome.bookmarks.getChildren(folderId)
        const subFolders = children
          .filter(n => !n.url && !n.unmodifiable && !options.ignoreFolderIds.includes(n.id))
          .map(n => n.id)

        for (const subId of subFolders) {
          const subResult = await sortNativeBookmarks({
            ...options,
            targetFolderIds: [subId],
            // 遞迴時子資料夾一定排自己、一定遞迴
            scope: 'selected-with-sub',
            sortSelf: true,
            recurse: true,
          })
          rootResult.movedBookmarks += subResult.movedBookmarks
          rootResult.movedFolders += subResult.movedFolders
          rootResult.foldersProcessed += subResult.foldersProcessed
          rootResult.verificationFailures += subResult.verificationFailures
          rootResult.skipped.push(...subResult.skipped)
        }
      }
      catch {
        rootResult.skipped.push({ folderId, reason: 'cannot read children' })
      }
    }
  }

  return rootResult
}

/**
 * 驗證並歸一化 sortCriteria：保證是陣列、每個元素都合法、長度 1~3。
 *  舊版設定存的是 `field + direction`（單一欄位），這裡也自動轉成單元素 array 對齊新格式。
 */
export function normalizeSortCriteria(
  raw: unknown,
): NativeSortCriterion[] {
  const FIELD_SET: ReadonlySet<string> = new Set<NativeSortField>([
    'title',
    'url',
    'dateAdded',
    'dateLastUsed',
  ])
  const DIRECTION_SET: ReadonlySet<string> = new Set<NativeSortDirection>(['asc', 'desc'])

  if (Array.isArray(raw)) {
    const cleaned = raw
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object')
      .map((item) => {
        const field = item.field
        const direction = item.direction
        if (typeof field === 'string' && FIELD_SET.has(field)
          && typeof direction === 'string' && DIRECTION_SET.has(direction)) {
          return { field: field as NativeSortField, direction: direction as NativeSortDirection }
        }
        return null
      })
      .filter((c): c is NativeSortCriterion => c !== null)
      .slice(0, MAX_SORT_CRITERIA)

    if (cleaned.length > 0)
      return cleaned
  }
  // 舊版 fallback：{ field: 'dateAdded', direction: 'desc' } → [{ field, direction }]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    const field = r.field
    const direction = r.direction
    if (typeof field === 'string' && FIELD_SET.has(field)
      && typeof direction === 'string' && DIRECTION_SET.has(direction)) {
      return [{ field: field as NativeSortField, direction: direction as NativeSortDirection }]
    }
  }

  return [...DEFAULT_SORT_CRITERIA]
}
