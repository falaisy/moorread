import type {
  PlannerNode,
  RestoreStats,
  SnapshotData,
  SnapshotNode,
  TargetState,
} from './sort-types'

/**
 * Snapshot 模組：保存排序前的原始順序，並計算復原目標。
 * 不直接呼叫 chrome.bookmarks.move()——執行由 Executor 負責。
 */

/** 從完整樹與排序範圍建立快照（pure，便於測試） */
export function captureSnapshot(
  tree: PlannerNode[],
  scopeFolderIds: string[],
): SnapshotData {
  const scopeSet = new Set(scopeFolderIds)
  const folderOrders: Record<string, string[]> = {}
  const nodes: Record<string, SnapshotNode> = {}

  const visit = (nodeList: PlannerNode[], parentId: string | undefined) => {
    for (const node of nodeList) {
      const isFolder = !node.url
      nodes[node.id] = {
        id: node.id,
        parentId: parentId ?? '',
        index: node.index ?? 0,
        isFolder,
        title: node.title,
      }
      if (isFolder && scopeSet.has(node.id)) {
        folderOrders[node.id] = (node.children ?? []).map(c => c.id)
      }
      if (node.children?.length)
        visit(node.children, node.id)
    }
  }
  visit(tree, undefined)

  return {
    capturedAt: Date.now(),
    folderOrders,
    nodes,
    scopeFolderIds: [...scopeFolderIds],
  }
}

/**
 * 驗證外部讀入的 Snapshot 格式是否完整。
 * 讀取失敗、格式錯誤或無法確認完整性時，呼叫端必須停止並回報，不得猜測或 fallback。
 */
export function isValidSnapshot(raw: unknown): raw is SnapshotData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return false
  const snap = raw as Record<string, unknown>
  if (typeof snap.capturedAt !== 'number' || !Number.isFinite(snap.capturedAt))
    return false
  if (!Array.isArray(snap.scopeFolderIds) || !snap.scopeFolderIds.every(id => typeof id === 'string'))
    return false
  if (!snap.folderOrders || typeof snap.folderOrders !== 'object' || Array.isArray(snap.folderOrders))
    return false
  for (const order of Object.values(snap.folderOrders as Record<string, unknown>)) {
    if (!Array.isArray(order) || !order.every(id => typeof id === 'string'))
      return false
  }
  if (!snap.nodes || typeof snap.nodes !== 'object' || Array.isArray(snap.nodes))
    return false
  for (const node of Object.values(snap.nodes as Record<string, unknown>)) {
    if (!node || typeof node !== 'object')
      return false
    const n = node as Record<string, unknown>
    if (typeof n.id !== 'string' || typeof n.parentId !== 'string'
      || typeof n.index !== 'number' || typeof n.isFolder !== 'boolean') {
      return false
    }
  }
  return true
}

/** 判斷節點是否仍在快照中的原始位置（用於外部變動偵測） */
export function isNodeInOriginalPlace(
  snapshot: SnapshotData,
  id: string,
  currentParentId: string | undefined,
  currentIndex: number,
): boolean {
  const original = snapshot.nodes[id]
  if (!original)
    return false
  return original.parentId === (currentParentId ?? '')
    && original.index === currentIndex
}

export interface RestorePlanResult {
  targets: TargetState[]
  stats: RestoreStats
  skipped: Array<{ folderId: string, reason: string }>
}

/**
 * 依快照計算復原目標。
 *
 * 規則：
 *  1. 依原始父資料夾分組（snapshot.folderOrders 的每個 key）。
 *  2. 讀取目前實際子節點（currentOrders）。
 *  3. 已刪除節點跳過，不重建。
 *  4. 原始父資料夾不存在 → 跳過整個資料夾，不擅自移到根目錄。
 *  5. 節點已被移到其他資料夾（不在目前子節點中）→ 跳過，不跨資料夾搬移。
 *  6. 排序期間新增的節點保留，放在該資料夾最尾端，且相對順序不變。
 *
 * @param snapshot      排序前擷取的快照
 * @param currentOrders folderId -> 目前實際子節點 id 順序（資料夾不存在則缺 key）
 */
export function buildRestorePlan(
  snapshot: SnapshotData,
  currentOrders: Record<string, string[] | undefined>,
): RestorePlanResult {
  const targets: TargetState[] = []
  const stats: RestoreStats = { restored: 0, skipped: 0, failed: 0 }
  const skipped: Array<{ folderId: string, reason: string }> = []

  for (const folderId of Object.keys(snapshot.folderOrders)) {
    const original = snapshot.folderOrders[folderId]
    const current = currentOrders[folderId]

    // 原始父資料夾不存在 → 跳過，不擅自移到根目錄
    if (current === undefined) {
      skipped.push({ folderId, reason: 'parent folder missing' })
      stats.skipped += original.length
      continue
    }

    const currentSet = new Set(current)
    const order: string[] = []

    // 原始順序中仍存在於此資料夾的節點 → 依原始順序放回
    for (const id of original) {
      if (currentSet.has(id)) {
        order.push(id)
        stats.restored++
      }
      else {
        // 不存在於此資料夾：已刪除或被移到別的資料夾 → 跳過，不重建、不跨資料夾搬移
        stats.skipped++
      }
    }

    // 排序期間新增的節點（不在原始順序中）→ 保留在尾端，相對順序不變
    for (const id of current) {
      if (!original.includes(id))
        order.push(id)
    }

    targets.push({ folderId, order })
  }

  return { targets, stats, skipped }
}

/**
 * 計算從 current 順序到 target 順序所需的「向後搬」移動步驟。
 *
 * Chrome 的 bookmarks.move(id, { index }) 對同層「往前搬」會把落點算成 index-1
 * （實測：[A,B,C,D] move A→3 得 [B,C,A,D]），因此只規劃向後搬：
 * 由左而右固定每個位置，把目標項目從目前位置搬到目標位置（from > to），
 * 向後搬不受位移影響，執行後實際順序與本地模型一致。
 */
export interface MoveStep {
  id: string
  from: number
  to: number
}

export function planFolderMoves(
  currentIds: string[],
  targetIds: string[],
): MoveStep[] {
  const current = [...currentIds]
  const steps: MoveStep[] = []
  for (let to = 0; to < targetIds.length; to++) {
    const id = targetIds[to]
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
