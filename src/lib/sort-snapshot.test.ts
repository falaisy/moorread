import type { PlannerNode } from './sort-types'
import { describe, expect, it } from 'vitest'
import {
  buildRestorePlan,
  captureSnapshot,
  isNodeInOriginalPlace,
  planFolderMoves,
} from './sort-snapshot'

function folder(id: string, children: PlannerNode[] = []): PlannerNode {
  return { id, title: id, children }
}
function bm(id: string, index: number): PlannerNode {
  return { id, title: id, url: `https://${id}.test`, index }
}

function treeWith(folderChildren: Record<string, PlannerNode[]>): PlannerNode[] {
  return [folder('0', [folder('1', folderChildren['1'] ?? [])])]
}

describe('captureSnapshot — 完整原始順序保存', () => {
  it('records folder child order and node metadata', () => {
    const tree = treeWith({ 1: [bm('A', 0), bm('B', 1), bm('C', 2)] })
    const snap = captureSnapshot(tree, ['1'])
    expect(snap.folderOrders['1']).toEqual(['A', 'B', 'C'])
    expect(snap.nodes.A).toMatchObject({ parentId: '1', index: 0, isFolder: false })
    expect(snap.scopeFolderIds).toEqual(['1'])
  })
})

describe('buildRestorePlan', () => {
  const original = [bm('A', 0), bm('B', 1), bm('C', 2)]
  const tree = treeWith({ 1: original })
  const snap = captureSnapshot(tree, ['1'])

  it('部分排序後復原：回復原始順序', () => {
    // 目前順序被部分改動成 C,A,B
    const current = { 1: ['C', 'A', 'B'] }
    const { targets, stats } = buildRestorePlan(snap, current)
    expect(targets[0].order).toEqual(['A', 'B', 'C'])
    expect(stats.restored).toBe(3)
    expect(stats.skipped).toBe(0)
  })

  it('節點刪除：跳過已刪除節點，不重建', () => {
    const current = { 1: ['A', 'C'] } // B 被刪
    const { targets, stats } = buildRestorePlan(snap, current)
    expect(targets[0].order).toEqual(['A', 'C'])
    expect(stats.skipped).toBe(1) // B
    expect(stats.restored).toBe(2)
  })

  it('父資料夾刪除：跳過整個資料夾，不擅自移到根目錄', () => {
    const current = {} // folder 1 不存在
    const { targets, stats, skipped } = buildRestorePlan(snap, current)
    expect(targets).toHaveLength(0)
    expect(stats.skipped).toBe(3)
    expect(skipped).toContainEqual({ folderId: '1', reason: 'parent folder missing' })
  })

  it('使用者移動節點到別的資料夾：跳過，不跨資料夾搬移', () => {
    // B 被移到 folder 2（不在目前 folder 1 的子節點中）
    const current = { 1: ['A', 'C'] }
    const { targets, stats } = buildRestorePlan(snap, current)
    expect(targets[0].order).toEqual(['A', 'C'])
    expect(stats.skipped).toBe(1) // B 被移走
  })

  it('排序期間新增節點放尾端，且新增節點相對順序保留', () => {
    // 目前：A, B, C 外加新增 N1, N2（相對順序 N1 在 N2 前）
    const current = { 1: ['A', 'B', 'C', 'N1', 'N2'] }
    const { targets } = buildRestorePlan(snap, current)
    expect(targets[0].order).toEqual(['A', 'B', 'C', 'N1', 'N2'])
    // 若目前新節點順序顛倒，應保留目前相對順序
    const current2 = { 1: ['A', 'B', 'C', 'N2', 'N1'] }
    const { targets: t2 } = buildRestorePlan(snap, current2)
    expect(t2[0].order).toEqual(['A', 'B', 'C', 'N2', 'N1'])
  })

  it('已在正確位置時 target 等於 current（不會產生移動）', () => {
    const current = { 1: ['A', 'B', 'C'] }
    const { targets } = buildRestorePlan(snap, current)
    expect(targets[0].order).toEqual(['A', 'B', 'C'])
    expect(planFolderMoves(current['1'], targets[0].order)).toHaveLength(0)
  })

  it('重建計畫具有等冪性（復原中斷後再次計算結果一致）', () => {
    const current = { 1: ['C', 'A', 'B'] }
    const r1 = buildRestorePlan(snap, current)
    const r2 = buildRestorePlan(snap, current)
    expect(r1.targets).toEqual(r2.targets)
    expect(r1.stats).toEqual(r2.stats)
  })
})

describe('planFolderMoves — Chrome 向後搬語意', () => {
  const applyChromeMove = (order: string[], from: number, index: number): string[] => {
    const next = [...order]
    const [id] = next.splice(from, 1)
    next.splice(index > from ? index - 1 : index, 0, id)
    return next
  }
  const simulate = (initial: string[], target: string[]) => {
    let order = [...initial]
    for (const step of planFolderMoves(initial, target)) {
      const from = order.indexOf(step.id)
      expect(from).toBe(step.from)
      expect(from).toBeGreaterThan(step.to) // 只向後搬
      order = applyChromeMove(order, from, step.to)
    }
    return order
  }
  it('reverse A/B/C/D → D/C/B/A', () => {
    expect(simulate(['A', 'B', 'C', 'D'], ['D', 'C', 'B', 'A'])).toEqual(['D', 'C', 'B', 'A'])
  })
  it('already sorted → no moves', () => {
    expect(planFolderMoves(['A', 'B', 'C'], ['A', 'B', 'C'])).toHaveLength(0)
  })
  it('ignores ids missing from current', () => {
    const steps = planFolderMoves(['A', 'B'], ['B', 'A', 'gone'])
    expect(steps.every(s => s.id !== 'gone')).toBe(true)
  })
})

describe('isNodeInOriginalPlace', () => {
  it('detects external move/index change', () => {
    const tree = treeWith({ 1: [bm('A', 0), bm('B', 1)] })
    const snap = captureSnapshot(tree, ['1'])
    expect(isNodeInOriginalPlace(snap, 'A', '1', 0)).toBe(true)
    expect(isNodeInOriginalPlace(snap, 'A', '1', 1)).toBe(false) // index 變
    expect(isNodeInOriginalPlace(snap, 'A', '2', 0)).toBe(false) // 被移走
    expect(isNodeInOriginalPlace(snap, 'X', '1', 0)).toBe(false) // 未知節點
  })
})
