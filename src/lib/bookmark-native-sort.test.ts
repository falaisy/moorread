import type { NativeSortCriterion } from './bookmark-native-sort'
import type { BookmarkTreeNode } from './bookmark-tree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareNodes,
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
  handleBookmarkMoved,
  MAX_SORT_CRITERIA,

  normalizeSortCriteria,
  planFolderMoves,
  sortNativeBookmarks,
} from './bookmark-native-sort'

function node(partial: Partial<BookmarkTreeNode> & { id: string }): BookmarkTreeNode {
  return { syncing: false, children: undefined, ...partial } as BookmarkTreeNode
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('compareNodes', () => {
  const sortTitleAsc: NativeSortCriterion[] = [{ field: 'title', direction: 'asc' }]
  const sortTitleDesc: NativeSortCriterion[] = [{ field: 'title', direction: 'desc' }]

  it('puts folders before bookmarks (Chrome default)', () => {
    const a = node({ id: 'a', title: 'Alpha' }) // 無 url → 資料夾
    const b = node({ id: 'b', title: 'Beta', url: 'https://example.com' }) // 有 url → 書籤
    const cmp = compareNodes(sortTitleAsc)
    expect(cmp(a, b)).toBe(-1)
    expect(cmp(b, a)).toBe(1)
  })

  it('sorts titles ascending with localeCompare base sensitivity', () => {
    const a = node({ id: 'a', title: 'Apple', url: 'https://a.co' })
    const b = node({ id: 'b', title: 'banana', url: 'https://b.co' })
    const cmp = compareNodes(sortTitleAsc)
    expect(cmp(a, b)).toBeLessThan(0) // Apple < banana（base sensitivity 忽略大小寫，但 localeCompare 仍有方向）
    expect(cmp(b, a)).toBeGreaterThan(0)
  })

  it('sorts titles descending when direction is desc', () => {
    const a = node({ id: 'a', title: 'Apple', url: 'https://a.co' })
    const b = node({ id: 'b', title: 'banana', url: 'https://b.co' })
    const cmp = compareNodes(sortTitleDesc)
    expect(cmp(a, b)).toBeGreaterThan(0)
    expect(cmp(b, a)).toBeLessThan(0)
  })

  it('always pushes missing values last regardless of direction', () => {
    const hasTitle = node({ id: 'a', title: 'Has Title', url: 'https://a.co' })
    const noTitle = node({ id: 'b', title: '', url: 'https://b.co' })
    const cmpAsc = compareNodes(sortTitleAsc)
    const cmpDesc = compareNodes(sortTitleDesc)
    // 缺失永遠排在有值後面
    expect(cmpAsc(hasTitle, noTitle)).toBe(-1)
    expect(cmpAsc(noTitle, hasTitle)).toBe(1)
    expect(cmpDesc(hasTitle, noTitle)).toBe(-1) // desc 也一樣！
    expect(cmpDesc(noTitle, hasTitle)).toBe(1)
  })

  it('pushes missing dateLastUsed last when sorting by that field', () => {
    const hasDate = node({ id: 'a', title: 'A', url: 'https://a.co', dateLastUsed: 100 })
    const noDate = node({ id: 'b', title: 'B', url: 'https://b.co' })
    const cmp = compareNodes([{ field: 'dateLastUsed', direction: 'desc' }])
    expect(cmp(hasDate, noDate)).toBe(-1)
    expect(cmp(noDate, hasDate)).toBe(1)
  })

  it('sorts by multiple criteria in order', () => {
    const criteria: NativeSortCriterion[] = [
      { field: 'title', direction: 'asc' },
      { field: 'dateAdded', direction: 'desc' },
    ]
    // 同 title 時看 dateAdded desc
    const a = node({ id: 'a', title: 'Same', url: 'https://a.co', dateAdded: 100 })
    const b = node({ id: 'b', title: 'Same', url: 'https://b.co', dateAdded: 200 })
    const cmp = compareNodes(criteria)
    expect(cmp(a, b)).toBeGreaterThan(0) // b.dateAdded 較大 → asc 鏈中的第二層 desc 較優先
  })

  it('falls back to index when all criteria tie', () => {
    const a = node({ id: 'a', title: 'Same', url: 'https://a.co', index: 0 })
    const b = node({ id: 'b', title: 'Same', url: 'https://b.co', index: 5 })
    const cmp = compareNodes(sortTitleAsc)
    expect(cmp(a, b)).toBeLessThan(0)
  })

  it('sorts URLs case-insensitively with localeCompare', () => {
    const a = node({ id: 'a', title: 'A', url: 'https://Alpha.com' })
    const b = node({ id: 'b', title: 'B', url: 'https://beta.com' })
    const cmp = compareNodes([{ field: 'url', direction: 'asc' }])
    // localeCompare base sensitivity 應讓 alpha < beta 成立
    expect(cmp(a, b)).toBeLessThan(0)
  })
})

describe('normalizeSortCriteria', () => {
  it('passes through valid array', () => {
    const raw: NativeSortCriterion[] = [
      { field: 'title', direction: 'asc' },
      { field: 'dateAdded', direction: 'desc' },
    ]
    expect(normalizeSortCriteria(raw)).toEqual(raw)
  })

  it('converts legacy single object to array', () => {
    const raw = { field: 'dateAdded', direction: 'desc' }
    expect(normalizeSortCriteria(raw)).toEqual([{ field: 'dateAdded', direction: 'desc' }])
  })

  it('returns DEFAULT_SORT_CRITERIA for invalid input', () => {
    expect(normalizeSortCriteria(null)).toEqual(DEFAULT_SORT_CRITERIA)
    expect(normalizeSortCriteria(undefined)).toEqual(DEFAULT_SORT_CRITERIA)
    expect(normalizeSortCriteria('garbage')).toEqual(DEFAULT_SORT_CRITERIA)
    expect(normalizeSortCriteria([])).toEqual(DEFAULT_SORT_CRITERIA)
  })

  it('filters out invalid entries and keeps valid ones', () => {
    const raw = [
      { field: 'title', direction: 'asc' },
      { field: 'bogus', direction: 'asc' },
      { field: 'dateAdded', direction: 'bogus' },
      null,
      undefined,
      { field: 'url', direction: 'desc' },
    ]
    expect(normalizeSortCriteria(raw)).toEqual([
      { field: 'title', direction: 'asc' },
      { field: 'url', direction: 'desc' },
    ])
  })

  it('caps to MAX_SORT_CRITERIA entries (cap raised to 4 so all fields combine)', () => {
    const raw: NativeSortCriterion[] = [
      { field: 'title', direction: 'asc' },
      { field: 'url', direction: 'asc' },
      { field: 'dateAdded', direction: 'asc' },
      { field: 'dateLastUsed', direction: 'asc' }, // 第 4 個
    ]
    expect(normalizeSortCriteria(raw)).toHaveLength(MAX_SORT_CRITERIA)
    expect(MAX_SORT_CRITERIA).toBe(4)
  })

  it('returns DEFAULT_SORT_CRITERIA when array has no valid entries after filtering', () => {
    const raw = [{ field: 'bogus', direction: 'asc' }]
    expect(normalizeSortCriteria(raw)).toEqual(DEFAULT_SORT_CRITERIA)
  })
})

describe('deriveScopeFromLegacy', () => {
  it('returns all when targetMode is all regardless of includeSubfolders', () => {
    expect(deriveScopeFromLegacy('all', false)).toBe('all')
    expect(deriveScopeFromLegacy('all', true)).toBe('all')
  })

  it('returns selected-with-sub when includeSubfolders, selected-only otherwise (no scope expansion)', () => {
    expect(deriveScopeFromLegacy('selected', true)).toBe('selected-with-sub')
    // includeSubfolders=false：使用者不要子資料夾，遷移不得擴大範圍 → selected-only
    expect(deriveScopeFromLegacy('selected', false)).toBe('selected-only')
  })
})

/* ----------------------- 新引擎整合測試的 in-memory chrome ----------------------- */

interface FakeNode { id: string, title: string, url?: string, parentId?: string, index?: number }

function inMemoryStorage() {
  const local: Record<string, unknown> = {}
  const session: Record<string, unknown> = {}
  const area = (store: Record<string, unknown>) => ({
    get: (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      const r: Record<string, unknown> = {}
      for (const k of ks) {
        if (k in store)
          r[k] = store[k]
      }
      return Promise.resolve(r)
    },
    set: (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store[k] = v
      return Promise.resolve()
    },
    remove: (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      for (const k of ks) delete store[k]
      return Promise.resolve()
    },
    getBytesInUse: (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      let n = 0
      for (const k of ks) {
        if (k in store)
          n += JSON.stringify(store[k]).length
      }
      return Promise.resolve(n)
    },
    QUOTA_BYTES: 10 * 1024 * 1024,
  })
  return { local: area(local), session: area(session) }
}

function makeChromeMock(initial: Record<string, FakeNode[]>, failMoveIds: Set<string> = new Set()) {
  const live: Record<string, FakeNode[]> = {}
  for (const [f, nodes] of Object.entries(initial))
    live[f] = nodes.map((n, i) => ({ ...n, index: i, parentId: f }))

  const moveLog: Array<{ id: string, parentId: string, index: number }> = []
  const movedListeners: Array<(id: string, info: { parentId: string, oldParentId: string, index: number, oldIndex: number }) => void> = []
  const noopEvent = { addListener: () => {}, removeListener: () => {}, hasListener: () => false }

  const bookmarks = {
    getTree: vi.fn(async () => {
      const children = Object.entries(live).map(([fid, nodes]) => ({
        id: fid,
        title: fid,
        children: nodes.map(n => ({ ...n })),
      }))
      return [{ id: '0', title: '', children }]
    }),
    getChildren: vi.fn(async (folderId: string) => (live[folderId] ?? []).map(n => ({ ...n }))),
    move: vi.fn(async (id: string, dest: { parentId: string, index: number }) => {
      moveLog.push({ id, parentId: dest.parentId, index: dest.index })
      if (failMoveIds.has(id))
        throw new Error('move failed')
      const list = live[dest.parentId]
      const from = list.findIndex(n => n.id === id)
      const oldIndex = from
      if (from !== -1) {
        const [n] = list.splice(from, 1)
        list.splice(dest.index, 0, { ...n, parentId: dest.parentId, index: dest.index })
      }
      // 模擬 Chrome 觸發 onMoved（向後搬 index 不位移）
      for (const fn of [...movedListeners])
        fn(id, { parentId: dest.parentId, oldParentId: dest.parentId, index: dest.index, oldIndex })
      return {}
    }),
    onMoved: {
      addListener: (fn: (id: string, info: { parentId: string, oldParentId: string, index: number, oldIndex: number }) => void) => movedListeners.push(fn),
      removeListener: () => {},
      hasListener: () => true,
    },
    onChildrenReordered: noopEvent,
    onChanged: noopEvent,
    onCreated: noopEvent,
    onRemoved: noopEvent,
  }

  const chromeMock = { bookmarks, storage: inMemoryStorage() }
  // 把原生 onMoved 接到 executor（模擬 background 頂層同步註冊）
  bookmarks.onMoved.addListener((id, info) => {
    void handleBookmarkMoved(id, info)
  })
  return { chromeMock, live, moveLog, failMoveIds }
}

const titleAsc = [{ field: 'title' as const, direction: 'asc' as const }]

describe('sortNativeBookmarks (new engine wiring)', () => {
  it('throws when chrome bookmarks api is unavailable', async () => {
    vi.stubGlobal('chrome', undefined)
    await expect(sortNativeBookmarks({
      scope: 'all',
      targetFolderIds: [],
      ignoreFolderIds: [],
      sortCriteria: DEFAULT_SORT_CRITERIA,
      sortSelf: true,
    })).rejects.toThrow('bookmarks api unavailable')
  })

  it('sorts a folder by title using only move(), preserving native ids', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'z', title: 'Zebra', url: 'https://z.co' },
        { id: 'a', title: 'Alpha', url: 'https://a.co' },
        { id: 'm', title: 'Mango', url: 'https://m.co' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })

    expect(res.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['a', 'm', 'z'])
    // 所有寫入都經過 move；沒有 delete/create
    expect(m.chromeMock.bookmarks.move).toHaveBeenCalled()
    expect(res.movedBookmarks).toBe(2)
  })

  it('sorts all writable folders (scope=all)', async () => {
    const m = makeChromeMock({
      f1: [{ id: 'b', title: 'B', url: 'u' }, { id: 'a', title: 'A', url: 'u' }],
      f2: [{ id: 'y', title: 'Y', url: 'u' }, { id: 'x', title: 'X', url: 'u' }],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks({
      scope: 'all',
      targetFolderIds: [],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
    })

    expect(res.status).toBe('completed')
    expect(m.live.f1.map(n => n.id)).toEqual(['a', 'b'])
    expect(m.live.f2.map(n => n.id)).toEqual(['x', 'y'])
  })

  it('makes no moves and reports completed when already sorted', async () => {
    const m = makeChromeMock({
      f: [{ id: 'a', title: 'Alpha', url: 'u' }, { id: 'm', title: 'Mango', url: 'u' }, { id: 'z', title: 'Zebra', url: 'u' }],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })

    expect(res.status).toBe('completed')
    expect(m.moveLog).toHaveLength(0)
    expect(res.movedBookmarks).toBe(0)
  })

  it('fail-stop: a move failure stops immediately and never claims success', async () => {
    const order = [
      { id: 'z', title: 'Zebra', url: 'u' },
      { id: 'a', title: 'Alpha', url: 'u' },
      { id: 'm', title: 'Mango', url: 'u' },
    ]
    const m = makeChromeMock({ f: order.map(n => ({ ...n })) }, new Set(['a', 'm', 'z']))
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })

    // 失敗立即停止：只嘗試第一筆，後續預先計算的移動不執行
    expect(res.status).not.toBe('completed')
    expect(m.moveLog.length).toBeLessThanOrEqual(1)
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a', 'm']) // 未被改動
  })
})

/** 以 Chrome 實測語意套用一次同層 move：index 以移動前的清單計，往前搬落點為 index-1 */
function applyChromeMove(order: string[], from: number, index: number): string[] {
  const next = [...order]
  const [id] = next.splice(from, 1)
  next.splice(index > from ? index - 1 : index, 0, id)
  return next
}

describe('planFolderMoves', () => {
  const asNodes = (ids: string[]) => ids.map(id => ({ id }))

  function simulate(initial: string[], sorted: string[]) {
    let order = [...initial]
    const steps = planFolderMoves(asNodes(initial), asNodes(sorted))
    for (const step of steps) {
      const from = order.indexOf(step.id)
      // 只規劃向後搬，避開 Chrome 往前搬的 index 位移
      expect(from).toBe(step.from)
      expect(from).toBeGreaterThan(step.to)
      order = applyChromeMove(order, from, step.to)
    }
    return { order, steps }
  }

  it('sorts Zebra/Apple/Mango into Apple/Mango/Zebra', () => {
    const { order, steps } = simulate(
      ['Zebra', 'Apple', 'Mango'],
      ['Apple', 'Mango', 'Zebra'],
    )
    expect(order).toEqual(['Apple', 'Mango', 'Zebra'])
    expect(steps).toHaveLength(2)
  })

  it('reverses A/B/C/D into D/C/B/A', () => {
    const { order, steps } = simulate(['A', 'B', 'C', 'D'], ['D', 'C', 'B', 'A'])
    expect(order).toEqual(['D', 'C', 'B', 'A'])
    expect(steps).toHaveLength(3)
  })

  it('rotates A/B/C/D into B/C/D/A', () => {
    const { order, steps } = simulate(['A', 'B', 'C', 'D'], ['B', 'C', 'D', 'A'])
    expect(order).toEqual(['B', 'C', 'D', 'A'])
    expect(steps).toHaveLength(3)
  })

  it('swaps A/B/C/D into B/A/C/D', () => {
    const { order, steps } = simulate(['A', 'B', 'C', 'D'], ['B', 'A', 'C', 'D'])
    expect(order).toEqual(['B', 'A', 'C', 'D'])
    expect(steps).toHaveLength(1)
  })

  it('produces no moves for an already sorted folder', () => {
    const { order, steps } = simulate(['A', 'B', 'C'], ['A', 'B', 'C'])
    expect(order).toEqual(['A', 'B', 'C'])
    expect(steps).toHaveLength(0)
  })

  it('ignores entries that no longer exist in the folder', () => {
    const steps = planFolderMoves(asNodes(['A', 'B']), asNodes(['B', 'A', 'gone']))
    expect(steps.every(step => step.id !== 'gone')).toBe(true)
  })
})
