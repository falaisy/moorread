import type {
  FolderPlan,
  NativeSortCriterion,
  NativeSortDirection,
  NativeSortField,
  NativeSortMode,
  NativeSortRule,
  NativeSortScope,
  PlannerNode,
  SortPlan,
  TargetState,
} from './sort-types'

/** 所有支援的排序欄位都必須能組合使用 → 上限等於欄位數 */
export const MAX_SORT_CRITERIA = 4

/** 預設排序依據（向後兼容 + 新安裝） */
export const DEFAULT_SORT_CRITERIA: NativeSortCriterion[] = [
  { field: 'title', direction: 'asc' },
]

const FIELD_SET: ReadonlySet<string> = new Set<NativeSortField>([
  'title',
  'url',
  'dateAdded',
  'dateLastUsed',
])
const DIRECTION_SET: ReadonlySet<string> = new Set<NativeSortDirection>(['asc', 'desc'])
const MODE_SET: ReadonlySet<string> = new Set<NativeSortMode>(['criteria', 'manual', 'random'])

/** 判斷某個欄位值是否為「缺失」（缺失值永遠排最後，與 direction 無關） */
export function isFieldMissing(field: NativeSortField, node: PlannerNode): boolean {
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

function singleFieldCmp(field: NativeSortField, a: PlannerNode, b: PlannerNode): number {
  switch (field) {
    case 'title':
      return (a.title ?? '').localeCompare(b.title ?? '', undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    case 'url':
      return (a.url ?? '').localeCompare(b.url ?? '', undefined, {
        sensitivity: 'base',
      })
    case 'dateAdded':
      return (a.dateAdded ?? 0) - (b.dateAdded ?? 0)
    case 'dateLastUsed':
      return (a.dateLastUsed ?? 0) - (b.dateLastUsed ?? 0)
    default:
      return 0
  }
}

/**
 * 多欄位鏈比較器：
 *  - 資料夾預設排在書籤前面（foldersFirst=false 時不區分）
 *  - 缺失值永遠排最後，不受 direction 翻轉
 *  - 全部平手 → 以原始 index 當穩定排序 tiebreaker
 */
export function compareNodes(
  sortCriteria: NativeSortCriterion[],
  foldersFirst = true,
): (a: PlannerNode, b: PlannerNode) => number {
  return (a, b) => {
    if (foldersFirst) {
      const aFolder = !a.url
      const bFolder = !b.url
      if (aFolder && !bFolder)
        return -1
      if (!aFolder && bFolder)
        return 1
    }

    for (const criterion of sortCriteria) {
      const aMissing = isFieldMissing(criterion.field, a)
      const bMissing = isFieldMissing(criterion.field, b)
      if (aMissing && !bMissing)
        return 1
      if (!aMissing && bMissing)
        return -1

      const raw = singleFieldCmp(criterion.field, a, b)
      if (raw !== 0)
        return criterion.direction === 'asc' ? raw : -raw
    }

    return (a.index ?? 0) - (b.index ?? 0)
  }
}

/**
 * 驗證並歸一化 sortCriteria：保證是陣列、每個元素都合法、長度 1~MAX。
 * 舊版設定存的是 `{ field, direction }`（單一欄位），自動轉成單元素陣列。
 */
export function normalizeSortCriteria(raw: unknown): NativeSortCriterion[] {
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

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw))
    return []
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/** 驗證並歸一化單一規則；無效值安全 fallback，不擴大範圍 */
export function normalizeSortRule(raw: unknown): NativeSortRule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { mode: 'criteria', criteria: [...DEFAULT_SORT_CRITERIA], foldersFirst: true }
  }
  const r = raw as Record<string, unknown>
  const mode: NativeSortMode = MODE_SET.has(String(r.mode)) ? r.mode as NativeSortMode : 'criteria'
  const rule: NativeSortRule = { mode }
  if (r.criteria !== undefined)
    rule.criteria = normalizeSortCriteria(r.criteria)
  if (typeof r.foldersFirst === 'boolean')
    rule.foldersFirst = r.foldersFirst
  if (typeof r.seed === 'number' && Number.isFinite(r.seed))
    rule.seed = r.seed
  if (Array.isArray(r.pinnedTop))
    rule.pinnedTop = normalizeIdList(r.pinnedTop)
  if (Array.isArray(r.pinnedBottom))
    rule.pinnedBottom = normalizeIdList(r.pinnedBottom)
  if (typeof r.inherit === 'boolean')
    rule.inherit = r.inherit
  // 確保 criteria 模式一定有合法 criteria
  if (mode === 'criteria' && !rule.criteria)
    rule.criteria = [...DEFAULT_SORT_CRITERIA]
  if (rule.foldersFirst === undefined)
    rule.foldersFirst = true
  return rule
}

/** 從舊欄位推導 scope（舊版設定升級用） */
export function deriveScopeFromLegacy(
  targetMode: 'all' | 'selected',
  includeSubfolders: boolean,
): NativeSortScope {
  if (targetMode === 'all')
    return 'all'
  // selected：有子資料夾就含子資料夾（sortSelf 再細分 self 與否）
  return includeSubfolders ? 'selected-with-sub' : 'selected-only'
}

/* -------------------------------------------------------------------------- */
/* 範圍解析                                                                    */
/* -------------------------------------------------------------------------- */

function isWritableFolder(node: PlannerNode): boolean {
  return !node.url && !node.unmodifiable
}

interface TreeIndex {
  parentOf: Map<string, string | undefined>
  childrenOf: Map<string, PlannerNode[]>
  nodeById: Map<string, PlannerNode>
  depthOf: Map<string, number>
}

function indexTree(roots: PlannerNode[]): TreeIndex {
  const parentOf = new Map<string, string | undefined>()
  const childrenOf = new Map<string, PlannerNode[]>()
  const nodeById = new Map<string, PlannerNode>()
  const depthOf = new Map<string, number>()
  const visit = (nodes: PlannerNode[], parentId: string | undefined, depth: number) => {
    for (const node of nodes) {
      nodeById.set(node.id, node)
      parentOf.set(node.id, parentId)
      depthOf.set(node.id, depth)
      const kids = node.children ?? []
      childrenOf.set(node.id, kids)
      visit(kids, node.id, depth + 1)
    }
  }
  visit(roots, undefined, 0)
  return { parentOf, childrenOf, nodeById, depthOf }
}

/** 傳回被忽略資料夾及其整個子樹的 id 集合 */
function collectIgnoredSubtree(
  ignoreIds: Set<string>,
  idx: TreeIndex,
): Set<string> {
  const excluded = new Set<string>()
  const stack = [...ignoreIds]
  while (stack.length) {
    const id = stack.pop()!
    if (excluded.has(id))
      continue
    excluded.add(id)
    const kids = idx.childrenOf.get(id) ?? []
    for (const k of kids)
      stack.push(k.id)
  }
  return excluded
}

/** 收集某資料夾下所有可寫子資料夾（不含自己） */
function collectDescendantFolders(
  folderId: string,
  excluded: Set<string>,
  idx: TreeIndex,
  acc: string[] = [],
): string[] {
  const kids = idx.childrenOf.get(folderId) ?? []
  for (const kid of kids) {
    if (excluded.has(kid.id))
      continue
    if (isWritableFolder(kid)) {
      acc.push(kid.id)
      collectDescendantFolders(kid.id, excluded, idx, acc)
    }
  }
  return acc
}

/** 收集整棵樹所有可寫資料夾 */
function collectAllWritableFolders(
  roots: PlannerNode[],
  excluded: Set<string>,
  idx: TreeIndex,
  acc: string[] = [],
): string[] {
  for (const node of roots) {
    if (excluded.has(node.id))
      continue
    if (isWritableFolder(node)) {
      acc.push(node.id)
      collectAllWritableFolders(idx.childrenOf.get(node.id) ?? [], excluded, idx, acc)
    }
    else {
      collectAllWritableFolders(idx.childrenOf.get(node.id) ?? [], excluded, idx, acc)
    }
  }
  return acc
}

export interface PlannerOptions {
  scope: NativeSortScope
  targetFolderIds: string[]
  ignoreFolderIds: string[]
  /** 預設規則（頂層/未覆寫資料夾適用） */
  defaultRule: NativeSortRule
  /** 資料夾獨立規則 */
  folderRules?: Array<{ folderId: string, rule: NativeSortRule }>
  /**
   * 舊版相容覆寫：
   *  - sortSelf===false 且 scope 含自己時 → 退為 children-only（不擴大範圍）
   *  - recurse===false → 只排指定資料夾本身（selected-only），自動排使用
   */
  sortSelf?: boolean
  recurse?: boolean
}

/** 解析出要處理的資料夾 id 集合（已去重），不保證順序 */
export function resolveScopeFolderIds(
  tree: PlannerNode[],
  options: PlannerOptions,
): string[] {
  const idx = indexTree(tree)
  const ignored = collectIgnoredSubtree(new Set(options.ignoreFolderIds), idx)
  const targets = options.targetFolderIds
    .filter(id => idx.nodeById.has(id) && !ignored.has(id))

  // 舊版覆寫，將 scope 正規化為四選一（只縮小，不擴大）
  let scope = options.scope
  if (options.recurse === false && scope !== 'selected-only')
    scope = 'selected-only'
  else if (options.sortSelf === false && scope === 'selected-with-sub')
    scope = 'children-only'

  const set = new Set<string>()
  if (scope === 'all') {
    for (const id of collectAllWritableFolders(tree, ignored, idx))
      set.add(id)
  }
  else {
    for (const id of targets) {
      const node = idx.nodeById.get(id)
      if (!node || !isWritableFolder(node))
        continue
      if (scope === 'selected-only') {
        set.add(id)
      }
      else if (scope === 'selected-with-sub') {
        set.add(id)
        for (const d of collectDescendantFolders(id, ignored, idx))
          set.add(d)
      }
      else {
        // children-only：不含自己
        for (const d of collectDescendantFolders(id, ignored, idx))
          set.add(d)
      }
    }
  }
  // Chrome 內建根節點（無 parentId）一律跳過，不論哪種 scope
  return [...set].filter(id => idx.parentOf.get(id) !== undefined)
}

/** 將資料夾依深度遞減排列（子資料夾先、父資料夾後 = post-order） */
export function orderFoldersPostOrder(folderIds: string[], idx: TreeIndex): string[] {
  return [...folderIds].sort((a, b) => {
    const da = idx.depthOf.get(a) ?? 0
    const db = idx.depthOf.get(b) ?? 0
    if (db !== da)
      return db - da
    return a.localeCompare(b)
  })
}

/** 解析某資料夾實際適用的規則（繼承鏈：最近的覆寫祖先 → 預設規則） */
export function resolveRuleForFolder(
  folderId: string,
  options: PlannerOptions,
  idx: TreeIndex,
): NativeSortRule {
  const ruleMap = new Map<string, NativeSortRule>()
  for (const fr of options.folderRules ?? [])
    ruleMap.set(fr.folderId, fr.rule)

  // 從自己往上找第一個 inherit=false（獨立覆寫）的規則
  let cur: string | undefined = folderId
  while (cur) {
    const r = ruleMap.get(cur)
    if (r) {
      if (r.inherit === false)
        return r
      // inherit===true（或未指定）：此資料夾宣告沿用，繼續往上找覆寫
    }
    cur = idx.parentOf.get(cur)
  }
  return options.defaultRule
}

/* -------------------------------------------------------------------------- */
/* 目標順序計算                                                                */
/* -------------------------------------------------------------------------- */

/** 簡單可重現 PRNG（mulberry32），同一 seed 產生同順序 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items]
  const rand = mulberry32(seed)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 計算單一資料夾的目標子節點順序 */
export function computeTargetOrder(
  children: PlannerNode[],
  rule: NativeSortRule,
): string[] {
  const ids = children.map(c => c.id)
  const idSet = new Set(ids)

  const pinnedTop = (rule.pinnedTop ?? []).filter(id => idSet.has(id))
  const pinnedBottom = (rule.pinnedBottom ?? []).filter(id => idSet.has(id))
  const pinnedSet = new Set([...pinnedTop, ...pinnedBottom])
  const rest = children.filter(c => !pinnedSet.has(c.id))

  let middle: PlannerNode[]
  if (rule.mode === 'manual') {
    // 手動：保留目前原生順序 → 目標即現況，不會產生移動
    middle = rest
  }
  else if (rule.mode === 'random') {
    middle = seededShuffle(rest, rule.seed ?? 0)
  }
  else {
    const criteria = rule.criteria && rule.criteria.length > 0
      ? rule.criteria
      : DEFAULT_SORT_CRITERIA
    middle = [...rest].sort(compareNodes(criteria, rule.foldersFirst !== false))
  }

  return [...pinnedTop, ...middle.map(n => n.id), ...pinnedBottom]
}

/**
 * 建立完整排序計畫。
 *  - 範圍解析、忽略祖先排除整個子樹、去重
 *  - post-order（子先父後），每個資料夾只計算一次
 *  - 規則繼承與獨立覆寫
 */
export function buildSortPlan(
  tree: PlannerNode[],
  options: PlannerOptions,
): SortPlan {
  const idx = indexTree(tree)
  const folderIds = resolveScopeFolderIds(tree, options)
  const ordered = orderFoldersPostOrder(folderIds, idx)

  const folders: FolderPlan[] = ordered.map((folderId) => {
    const node = idx.nodeById.get(folderId)
    const children = (idx.childrenOf.get(folderId) ?? [])
    const rule = resolveRuleForFolder(folderId, options, idx)
    if (!node || children.length < 2) {
      return {
        folderId,
        rule,
        target: { folderId, order: children.map(c => c.id) },
        skipReason: children.length < 2 ? 'fewer than 2 children' : undefined,
      }
    }
    const order = computeTargetOrder(children, rule)
    return {
      folderId,
      rule,
      target: { folderId, order },
    }
  })

  return { folders, createdAt: Date.now() }
}

/** 從 SortPlan 萃取出 TargetState 陣列（Executor 執行與持久化用） */
export function planToTargets(plan: SortPlan): TargetState[] {
  return plan.folders
    .filter(f => !f.skipReason)
    .map(f => f.target)
}
