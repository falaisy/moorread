import type { NativeSortRule, NativeSortScope, PlannerNode } from './sort-types'
import { describe, expect, it } from 'vitest'
import {
  buildSortPlan,
  compareNodes,
  computeTargetOrder,
  DEFAULT_SORT_CRITERIA,
  MAX_SORT_CRITERIA,
  normalizeSortCriteria,
  normalizeSortRule,
  resolveScopeFolderIds,
} from './sort-planner'

function folder(id: string, children: PlannerNode[] = [], partial: Partial<PlannerNode> = {}): PlannerNode {
  return { id, title: id, children, ...partial }
}

function bm(id: string, partial: Partial<PlannerNode> = {}): PlannerNode {
  return { id, title: id, url: `https://${id}.test`, index: 0, ...partial }
}

const defaultRule: NativeSortRule = { mode: 'criteria', criteria: DEFAULT_SORT_CRITERIA, foldersFirst: true }

/** 建構一棵測試樹：root(0) → bar(1) [A,B,C] + sub(2) [X,Y] + deep(3 子資料夾) */
function sampleTree(): PlannerNode[] {
  return [
    folder('0', [
      folder('1', [bm('A'), bm('B'), bm('C')]),
      folder('2', [bm('X'), bm('Y')]),
      folder('3', [
        folder('31', [bm('P'), bm('Q')]),
        folder('32', [bm('R')]),
      ]),
    ]),
  ]
}

describe('normalizeSortCriteria', () => {
  it('caps to MAX_SORT_CRITERIA (4) so all fields can combine', () => {
    expect(MAX_SORT_CRITERIA).toBe(4)
    const raw = [
      { field: 'title', direction: 'asc' },
      { field: 'url', direction: 'asc' },
      { field: 'dateAdded', direction: 'asc' },
      { field: 'dateLastUsed', direction: 'asc' },
      { field: 'title', direction: 'desc' },
    ]
    expect(normalizeSortCriteria(raw)).toHaveLength(4)
  })
})

describe('compareNodes', () => {
  it('folders first when foldersFirst=true', () => {
    const cmp = compareNodes(DEFAULT_SORT_CRITERIA)
    expect(cmp(folder('f'), bm('b'))).toBeLessThan(0)
  })
  it('does not separate folder/bookmark when foldersFirst=false', () => {
    const cmp = compareNodes([{ field: 'title', direction: 'asc' }], false)
    // 同標題時不分類型，平手回 0（此處標題不同）
    expect(cmp({ id: 'a', title: 'a' }, { id: 'b', title: 'b', url: 'x' })).toBeLessThan(0)
  })
  it('missing values always last regardless of direction', () => {
    const cmpDesc = compareNodes([{ field: 'title', direction: 'desc' }])
    expect(cmpDesc({ id: 'a', title: 'A', url: 'x' }, { id: 'b', title: '', url: 'y' })).toBe(-1)
  })
  it('stable: falls back to index when all criteria tie', () => {
    const cmp = compareNodes([{ field: 'title', direction: 'asc' }])
    expect(cmp({ id: 'a', title: 'Same', url: 'x', index: 0 }, { id: 'b', title: 'Same', url: 'y', index: 5 })).toBeLessThan(0)
  })
  it('multi-criteria chain', () => {
    const cmp = compareNodes([
      { field: 'title', direction: 'asc' },
      { field: 'dateAdded', direction: 'desc' },
    ])
    const a = { id: 'a', title: 'Same', url: 'x', dateAdded: 100 }
    const b = { id: 'b', title: 'Same', url: 'y', dateAdded: 200 }
    expect(cmp(a, b)).toBeGreaterThan(0) // 同 title → dateAdded desc：b 在前
  })
})

describe('normalizeSortRule', () => {
  it('falls back safely for invalid input without expanding scope', () => {
    expect(normalizeSortRule(null).mode).toBe('criteria')
    expect(normalizeSortRule('x').mode).toBe('criteria')
    expect(normalizeSortRule({ mode: 'random', seed: 42 }).seed).toBe(42)
  })
})

describe('resolveScopeFolderIds — 四種範圍', () => {
  const tree = sampleTree()
  const base = (scope: NativeSortScope, targetFolderIds: string[] = []) => ({
    scope,
    targetFolderIds,
    ignoreFolderIds: [],
    defaultRule,
  })

  it('all: every writable folder', () => {
    const ids = resolveScopeFolderIds(tree, base('all'))
    expect(ids.sort()).toEqual(['1', '2', '3', '31', '32'])
  })
  it('selected-only: only the target itself, no recursion', () => {
    const ids = resolveScopeFolderIds(tree, base('selected-only', ['3']))
    expect(ids.sort()).toEqual(['3'])
  })
  it('selected-with-sub: target + all descendants', () => {
    const ids = resolveScopeFolderIds(tree, base('selected-with-sub', ['3']))
    expect(ids.sort()).toEqual(['3', '31', '32'])
  })
  it('children-only: descendants only, not the target itself', () => {
    const ids = resolveScopeFolderIds(tree, base('children-only', ['3']))
    expect(ids.sort()).toEqual(['31', '32'])
  })
})

describe('忽略資料夾', () => {
  const tree = sampleTree()

  it('忽略祖先時排除整個子樹', () => {
    const ids = resolveScopeFolderIds(tree, {
      scope: 'all',
      targetFolderIds: [],
      ignoreFolderIds: ['3'],
      defaultRule,
    })
    expect(ids.sort()).toEqual(['1', '2']) // 3 / 31 / 32 全部排除
  })

  it('ignoreFolderIds 對 selected-with-sub 也排除子樹', () => {
    const ids = resolveScopeFolderIds(tree, {
      scope: 'selected-with-sub',
      targetFolderIds: ['3'],
      ignoreFolderIds: ['31'],
      defaultRule,
    })
    expect(ids.sort()).toEqual(['3', '32'])
  })
})

describe('去重', () => {
  const tree = sampleTree()

  it('父子資料夾重複選取只計算一次', () => {
    const plan = buildSortPlan(tree, {
      scope: 'selected-with-sub',
      targetFolderIds: ['3', '31'], // 31 也是 3 的後代
      ignoreFolderIds: [],
      defaultRule,
    })
    const folderIds = plan.folders.map(f => f.folderId)
    expect(folderIds).toHaveLength(new Set(folderIds).size)
    expect(folderIds).toContain('31')
    expect(folderIds).toContain('3')
  })
})

describe('post-order：子資料夾先、父資料夾後', () => {
  it('orders deepest first', () => {
    const plan = buildSortPlan(sampleTree(), {
      scope: 'selected-with-sub',
      targetFolderIds: ['3'],
      ignoreFolderIds: [],
      defaultRule,
    })
    const ids = plan.folders.map(f => f.folderId)
    // 31 / 32 必須在 3 之前
    expect(ids.indexOf('31')).toBeLessThan(ids.indexOf('3'))
    expect(ids.indexOf('32')).toBeLessThan(ids.indexOf('3'))
  })
})

describe('規則繼承與獨立覆寫', () => {
  const tree = sampleTree()

  it('未覆寫時繼承預設規則', () => {
    // 需要 indexTree；直接用 buildSortPlan 檢查 31 的 rule
    const plan = buildSortPlan(tree, {
      scope: 'selected-with-sub',
      targetFolderIds: ['3'],
      ignoreFolderIds: [],
      defaultRule,
      folderRules: [
        { folderId: '3', rule: { mode: 'manual', inherit: false } },
      ],
    })
    const f3 = plan.folders.find(f => f.folderId === '3')!
    const f31 = plan.folders.find(f => f.folderId === '31')!
    expect(f3.rule.mode).toBe('manual')
    // 31 沒有覆寫 → 繼承最近的覆寫祖先 3 的 manual
    expect(f31.rule.mode).toBe('manual')
  })

  it('獨立覆寫（inherit=false）中斷繼承鏈', () => {
    const plan = buildSortPlan(tree, {
      scope: 'selected-with-sub',
      targetFolderIds: ['3'],
      ignoreFolderIds: [],
      defaultRule,
      folderRules: [
        { folderId: '3', rule: { mode: 'manual', inherit: false } },
        { folderId: '31', rule: { mode: 'random', seed: 7, inherit: false } },
      ],
    })
    expect(plan.folders.find(f => f.folderId === '31')!.rule.mode).toBe('random')
    expect(plan.folders.find(f => f.folderId === '32')!.rule.mode).toBe('manual') // 繼承 3
  })
})

describe('computeTargetOrder — 手動/隨機/置頂置底', () => {
  const children = [bm('A'), bm('B'), bm('C')]

  it('manual: keeps current order (no moves)', () => {
    expect(computeTargetOrder(children, { mode: 'manual' })).toEqual(['A', 'B', 'C'])
  })

  it('random: same seed produces same order, different seed differs', () => {
    const a = computeTargetOrder(children, { mode: 'random', seed: 1 })
    const a2 = computeTargetOrder(children, { mode: 'random', seed: 1 })
    const b = computeTargetOrder(children, { mode: 'random', seed: 999 })
    expect(a).toEqual(a2) // 可重現
    expect(a).not.toEqual(b) // 不同 seed 不同（極高機率）
  })

  it('pinnedTop / pinnedBottom preserve specified ids and order', () => {
    const order = computeTargetOrder(children, {
      mode: 'criteria',
      criteria: [{ field: 'title', direction: 'asc' }],
      pinnedTop: ['C'],
      pinnedBottom: ['A'],
    })
    expect(order[0]).toBe('C')
    expect(order[order.length - 1]).toBe('A')
    expect(order).toContain('B')
  })

  it('ignores pin ids not present in folder', () => {
    const order = computeTargetOrder(children, {
      mode: 'criteria',
      criteria: [{ field: 'title', direction: 'asc' }],
      pinnedTop: ['ZZZ'],
    })
    expect(order).toEqual(['A', 'B', 'C'])
  })
})

describe('d2 pinned 去重與互斥（HQ-6）', () => {
  const children = [bm('A'), bm('B'), bm('C')]

  it('pinnedTop 內重複 id 只出現一次，target 長度不變', () => {
    const order = computeTargetOrder(children, {
      mode: 'criteria',
      criteria: [{ field: 'title', direction: 'asc' }],
      pinnedTop: ['C', 'C', 'C'],
    })
    expect(order.filter(id => id === 'C')).toHaveLength(1)
    expect(order).toHaveLength(3)
  })

  it('同一 id 同時在 top 與 bottom → 留在 top，不重複', () => {
    const order = computeTargetOrder(children, {
      mode: 'criteria',
      criteria: [{ field: 'title', direction: 'asc' }],
      pinnedTop: ['B'],
      pinnedBottom: ['B'],
    })
    expect(order[0]).toBe('B')
    expect(order.filter(id => id === 'B')).toHaveLength(1)
    expect(order).toHaveLength(3)
  })

  it('top/bottom 各自去重後仍保持使用者指定順序', () => {
    const order = computeTargetOrder(children, {
      mode: 'criteria',
      criteria: [{ field: 'title', direction: 'asc' }],
      pinnedTop: ['C', 'A', 'C'],
      pinnedBottom: ['B', 'B'],
    })
    expect(order.slice(0, 2)).toEqual(['C', 'A'])
    expect(order[order.length - 1]).toBe('B')
  })
})

describe('d2 random seed 可重現且可恢復（HQ-7）', () => {
  const children = [bm('A'), bm('B'), bm('C'), bm('D'), bm('E')]

  it('相同 seed → 完全相同順序（恢復時不會重新洗牌）', () => {
    const a = computeTargetOrder(children, { mode: 'random', seed: 12345 })
    const b = computeTargetOrder(children, { mode: 'random', seed: 12345 })
    expect(a).toEqual(b)
  })

  it('不同 seed → 至少一種排列不同（避免固定 seed 永遠同序）', () => {
    const a = computeTargetOrder(children, { mode: 'random', seed: 1 })
    const b = computeTargetOrder(children, { mode: 'random', seed: 2 })
    const c = computeTargetOrder(children, { mode: 'random', seed: 3 })
    const distinct = new Set([a.join(','), b.join(','), c.join(',')])
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('random 結果是原集合的排列（不增不減不重複）', () => {
    const order = computeTargetOrder(children, { mode: 'random', seed: 777 })
    expect([...order].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('buildSortPlan end-to-end', () => {
  it('sorts a folder by title asc', () => {
    const tree = [folder('0', [folder('1', [bm('Zebra'), bm('Alpha'), bm('Mango')])])]
    const plan = buildSortPlan(tree, {
      scope: 'selected-only',
      targetFolderIds: ['1'],
      ignoreFolderIds: [],
      defaultRule: { mode: 'criteria', criteria: [{ field: 'title', direction: 'asc' }] },
    })
    expect(plan.folders[0].target.order).toEqual(['Alpha', 'Mango', 'Zebra'])
  })

  it('skips folders with <2 children but still includes them in plan (no moves)', () => {
    const tree = [folder('0', [folder('1', [bm('only')])])]
    const plan = buildSortPlan(tree, {
      scope: 'all',
      targetFolderIds: [],
      ignoreFolderIds: [],
      defaultRule,
    })
    expect(plan.folders.find(f => f.folderId === '1')?.skipReason).toBe('fewer than 2 children')
  })
})
