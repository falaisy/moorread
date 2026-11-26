import type { NativeSortCriterion } from './bookmark-native-sort'
import type { BookmarkTreeNode } from './bookmark-tree'
import type { SnapshotData } from './sort-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareNodes,
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
  handleBookmarkMoved,
  MAX_SORT_CRITERIA,

  normalizeSortCriteria,
  planFolderMoves,
  RANDOM_SEED_KEY,
  restoreNativeBookmarks,
  sortNativeBookmarks,
} from './bookmark-native-sort'
import { JOB_STORAGE_KEY, SORT_SNAPSHOT_KEY } from './sort-executor'

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

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function inMemoryStorage() {
  const local: Record<string, unknown> = {}
  const session: Record<string, unknown> = {}
  const area = (store: Record<string, unknown>) => ({
    get: (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      const r: Record<string, unknown> = {}
      for (const k of ks) {
        if (k in store)
          r[k] = structuredClone(store[k]) // Chrome 會複製資料，呼叫端不共享參考
      }
      return Promise.resolve(r)
    },
    set: (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v)
      return Promise.resolve()
    },
    remove: (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      for (const k of ks) delete store[k]
      return Promise.resolve()
    },
    getBytesInUse: (keys: string | string[] | null) => {
      // null → 整個 area 已使用位元組（UTF-8）
      const ks = keys === null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
      let n = 0
      for (const k of ks) {
        if (k in store)
          n += utf8Bytes(JSON.stringify(store[k]))
      }
      return Promise.resolve(n)
    },
    QUOTA_BYTES: 10 * 1024 * 1024,
  })
  return { local: area(local), session: area(session) }
}

interface ChromeMockOptions {
  /** onMoved 事件延遲（ms） */
  eventDelayMs?: number
  /** move API 延遲（ms），模擬執行中的 Chrome API 無法被強制中斷 */
  moveDelayMs?: number
}

function makeChromeMock(
  initial: Record<string, FakeNode[]>,
  failMoveIds: Set<string> = new Set(),
  options: ChromeMockOptions = {},
) {
  const live: Record<string, FakeNode[]> = {}
  for (const [f, nodes] of Object.entries(initial))
    live[f] = nodes.map((n, i) => ({ ...n, index: i, parentId: f }))

  const moveLog: Array<{ id: string, parentId: string, index: number }> = []
  const movedListeners: Array<(id: string, info: { parentId: string, oldParentId: string, index: number, oldIndex: number }) => void> = []
  const noopEvent = { addListener: () => {}, removeListener: () => {}, hasListener: () => false }
  const moveState = { inFlight: 0, maxInFlight: 0 }

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
      moveState.inFlight++
      moveState.maxInFlight = Math.max(moveState.maxInFlight, moveState.inFlight)
      try {
        if (options.moveDelayMs)
          await new Promise(r => setTimeout(r, options.moveDelayMs))
        const list = live[dest.parentId]
        const from = list.findIndex(n => n.id === id)
        const oldIndex = from
        if (from !== -1) {
          const [n] = list.splice(from, 1)
          list.splice(dest.index, 0, { ...n, parentId: dest.parentId, index: dest.index })
        }
        // 模擬 Chrome 觸發 onMoved（向後搬 index 不位移）
        const fire = () => {
          for (const fn of [...movedListeners])
            fn(id, { parentId: dest.parentId, oldParentId: dest.parentId, index: dest.index, oldIndex })
        }
        if (options.eventDelayMs)
          setTimeout(fire, options.eventDelayMs)
        else
          fire()
      }
      finally {
        moveState.inFlight--
      }
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
  return { chromeMock, live, moveLog, failMoveIds, moveState }
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

describe('restoreNativeBookmarks — 復原統計、原始快照保護與 awaiting-user（缺陷 5/6、HQ-3）', () => {
  it('restore 統計以實際移動數計，且不覆蓋最初快照', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'z', title: 'Zebra', url: 'https://z.co' },
        { id: 'a', title: 'Alpha', url: 'https://a.co' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    // 排序：z,a → a,z（1 次 move）
    const sorted = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })
    expect(sorted.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['a', 'z'])

    // 最初快照已獨立保存
    const snapBefore = await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY)
    expect(snapBefore[SORT_SNAPSHOT_KEY]).toBeTruthy()

    // 復原：a,z → z,a
    const restored = await restoreNativeBookmarks()
    expect(restored.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a'])
    // 缺陷 5：restored 為實際移動數（1 次），不是計畫預估
    expect(restored.stats.restored).toBe(1)
    expect(restored.stats.failed).toBe(0)
    // 缺陷 6：最初快照未被 restore 覆蓋或刪除
    const snapAfter = await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY)
    expect(snapAfter[SORT_SNAPSHOT_KEY]).toBeTruthy()
  })

  it('已是最初順序時：no-op 不建立原始 Snapshot，restore 明確回報無可復原', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'a', title: 'Alpha', url: 'https://a.co' },
        { id: 'z', title: 'Zebra', url: 'https://z.co' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    // 排序後仍為 a,z（本來就正確）→ no-op 不建立 baseline
    await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })
    expect((await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY]).toBeUndefined()
    // 沒有原始 Snapshot → 不得猜測或用 JobRecord.snapshot fallback
    await expect(restoreNativeBookmarks()).rejects.toThrow(/no original snapshot/)
    expect(m.live.f.map(n => n.id)).toEqual(['a', 'z'])
  })

  it('原始順序已復原後再次 restore 不移動任何節點', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'z', title: 'Zebra', url: 'https://z.co' },
        { id: 'a', title: 'Alpha', url: 'https://a.co' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })
    const first = await restoreNativeBookmarks()
    expect(first.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a'])
    const movesAfterFirst = m.moveLog.length

    // 已在原始順序 → 復原工作 0 次 move
    const second = await restoreNativeBookmarks()
    expect(second.status).toBe('completed')
    expect(second.stats.restored).toBe(0)
    expect(m.moveLog).toHaveLength(movesAfterFirst)
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a'])
  })

  it('hQ-3：awaiting-user 的排序工作可被安全復原（cancel 後 preflight 通過）', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'z', title: 'Zebra', url: 'https://z.co' },
        { id: 'a', title: 'Alpha', url: 'https://a.co' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    // 先排序並完成，留下最初快照
    await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['f'],
      ignoreFolderIds: [],
      sortCriteria: titleAsc,
      sortSelf: true,
      recurse: false,
    })
    expect(m.live.f.map(n => n.id)).toEqual(['a', 'z'])

    // 模擬瀏覽器重啟後待使用者確認的中斷工作
    const raw = await m.chromeMock.storage.local.get(JOB_STORAGE_KEY)
    const job = raw[JOB_STORAGE_KEY] as { status: string }
    job.status = 'awaiting-user'
    await m.chromeMock.storage.local.set({ [JOB_STORAGE_KEY]: job })

    // 復原不應因 awaiting-user 被 preflight 拒絕
    const restored = await restoreNativeBookmarks()
    expect(restored.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a'])
  })
})

/* ============ MR-261126-003-D2（第二輪）— 原始 Snapshot 保護與 restore 安全等待 ============ */

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function sortF() {
  return {
    scope: 'selected-with-sub' as const,
    targetFolderIds: ['f'],
    ignoreFolderIds: [],
    sortCriteria: titleAsc,
    sortSelf: true,
    recurse: false,
  }
}

const threeUnsorted: FakeNode[] = [
  { id: 'z', title: 'Zebra', url: 'https://z.co' },
  { id: 'a', title: 'Alpha', url: 'https://a.co' },
  { id: 'm', title: 'Mango', url: 'https://m.co' },
]

describe('d2-r2-1 — 原始 Snapshot 只在取得執行權後保存', () => {
  it('活躍工作期間再次呼叫排序：被拒絕且原始 Snapshot 不變', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) }, new Set(), { eventDelayMs: 60 })
    vi.stubGlobal('chrome', m.chromeMock)

    const first = sortNativeBookmarks(sortF())
    await sleep(10)
    const before = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY]
    expect(before).toBeTruthy()

    await expect(sortNativeBookmarks(sortF())).rejects.toThrow(/already in progress/)

    const after = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY]
    expect(after).toEqual(before)
    expect((await first).status).toBe('completed')
  })

  it('手動排序事件後的自動排序 no-op：原始 Snapshot 仍是排序前狀態', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) })
    vi.stubGlobal('chrome', m.chromeMock)

    const first = await sortNativeBookmarks(sortF())
    expect(first.status).toBe('completed')
    expect(m.live.f.map(n => n.id)).toEqual(['a', 'm', 'z'])
    const before = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY] as SnapshotData
    expect(before.folderOrders.f).toEqual(['z', 'a', 'm'])

    // 排序引擎自己的 onMoved 事件會觸發自動排序 → 對已排序資料夾是 no-op
    const second = await sortNativeBookmarks(sortF())
    expect(second.status).toBe('completed')
    expect(m.moveLog).toHaveLength(2) // 只有第一次排序的兩筆

    const after = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY]
    expect(after).toEqual(before)
  })

  it('自動排序的 no-op 不建立也不覆寫原始 Snapshot', async () => {
    const m = makeChromeMock({
      f: [
        { id: 'a', title: 'Alpha', url: 'u' },
        { id: 'm', title: 'Mango', url: 'u' },
        { id: 'z', title: 'Zebra', url: 'u' },
      ],
    })
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks(sortF())
    expect(res.status).toBe('completed')
    expect(m.moveLog).toHaveLength(0)
    const stored = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY]
    expect(stored).toBeUndefined()
  })

  it('snapshot 寫入失敗 → 工作 failed，且不執行任何 move', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) })
    const originalSet = m.chromeMock.storage.local.set
    m.chromeMock.storage.local.set = (items: Record<string, unknown>) => {
      if (SORT_SNAPSHOT_KEY in items)
        return Promise.reject(new Error('quota exceeded'))
      return originalSet(items)
    }
    vi.stubGlobal('chrome', m.chromeMock)

    const res = await sortNativeBookmarks(sortF())
    expect(res.status).toBe('failed')
    expect(res.error).toMatch(/quota/)
    expect(m.moveLog).toHaveLength(0)
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a', 'm'])
  })
})

describe('d2-r2-2 — restore 等待目前工作到達安全停止點', () => {
  it('move API 延遲時 restore 不與執行中的工作重疊，也不依賴固定延遲', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) }, new Set(), { moveDelayMs: 100 })
    vi.stubGlobal('chrome', m.chromeMock)

    const first = sortNativeBookmarks(sortF())
    await sleep(20) // 第一筆 move 正在延遲中（無法強制中斷）

    const restored = await restoreNativeBookmarks()
    const sortResult = await first

    expect(sortResult.status).toBe('failed') // 取消 → 明確失敗，不虛報
    expect(restored.status).toBe('completed')
    // 兩個工作不得同時呼叫 move API（restore 等到安全停止點才開始）
    expect(m.moveState.maxInFlight).toBe(1)
    // 最終回到排序前順序
    expect(m.live.f.map(n => n.id)).toEqual(['z', 'a', 'm'])
  })
})

/* ================= D3 — P0-2：原始 Snapshot 生命週期與 restore 嚴格讀取 ================= */

describe('d3-p0-2 — 原始 Snapshot 由 Executor 管理且 restore 嚴格讀取', () => {
  it('新的一次真正排序取代舊基準；no-op 保留基準', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) })
    vi.stubGlobal('chrome', m.chromeMock)

    await sortNativeBookmarks(sortF())
    const first = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY] as SnapshotData
    expect(first.folderOrders.f).toEqual(['z', 'a', 'm'])

    // 使用者手動改成 m,z,a（真正需要移動）→ 新排序建立新基準
    m.live.f = ['m', 'z', 'a'].map((id, index) => ({ ...m.live.f.find(n => n.id === id)!, index }))
    const second = await sortNativeBookmarks(sortF())
    expect(second.status).toBe('completed')
    const replaced = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY] as SnapshotData
    expect(replaced.folderOrders.f).toEqual(['m', 'z', 'a'])

    // 已排序 → 再次排序為 no-op，不覆寫基準
    const noop = await sortNativeBookmarks(sortF())
    expect(noop.status).toBe('completed')
    const kept = (await m.chromeMock.storage.local.get(SORT_SNAPSHOT_KEY))[SORT_SNAPSHOT_KEY] as SnapshotData
    expect(kept.folderOrders.f).toEqual(['m', 'z', 'a'])
  })

  it('原始 Snapshot 讀取失敗 → 停止，不用 JobRecord.snapshot 代替', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) })
    vi.stubGlobal('chrome', m.chromeMock)
    await sortNativeBookmarks(sortF())
    const movesBefore = m.moveLog.length

    // 只讓原始 Snapshot 的讀取失敗（其他 key 正常）
    const originalGet = m.chromeMock.storage.local.get
    m.chromeMock.storage.local.get = (keys: string | string[]) => {
      const ks = Array.isArray(keys) ? keys : [keys]
      if (ks.includes(SORT_SNAPSHOT_KEY))
        return Promise.reject(new Error('storage read failed'))
      return originalGet(keys)
    }

    await expect(restoreNativeBookmarks()).rejects.toThrow(/cannot read original snapshot/)
    expect(m.moveLog).toHaveLength(movesBefore)
    // JobRecord.snapshot 仍存在，但不得被當成復原基準
    expect((await m.chromeMock.storage.local.get(JOB_STORAGE_KEY))[JOB_STORAGE_KEY]).toBeTruthy()
  })

  it('原始 Snapshot 格式錯誤 → 停止，不得靜默採用', async () => {
    const m = makeChromeMock({ f: threeUnsorted.map(n => ({ ...n })) })
    vi.stubGlobal('chrome', m.chromeMock)
    await sortNativeBookmarks(sortF())
    const movesBefore = m.moveLog.length

    await m.chromeMock.storage.local.set({ [SORT_SNAPSHOT_KEY]: { bad: true } })
    await expect(restoreNativeBookmarks()).rejects.toThrow(/invalid original snapshot/)
    expect(m.moveLog).toHaveLength(movesBefore)
  })

  it('random 未指定 seed：seed 持久化且重複排序冪等（0 次額外 move）', async () => {
    const many: FakeNode[] = ['F', 'E', 'D', 'C', 'B', 'A'].map(id => ({
      id,
      title: `Title ${id}`,
      url: `https://${id}.test`,
    }))
    const m = makeChromeMock({ f: many })
    vi.stubGlobal('chrome', m.chromeMock)

    const randomOpts = { ...sortF(), sortMode: 'random' as const }
    const first = await sortNativeBookmarks(randomOpts)
    expect(first.status).toBe('completed')
    const order1 = m.live.f.map(n => n.id)
    const moves1 = m.moveLog.length
    const seed1 = (await m.chromeMock.storage.local.get(RANDOM_SEED_KEY))[RANDOM_SEED_KEY]
    expect(typeof seed1).toBe('number')

    const second = await sortNativeBookmarks(randomOpts)
    expect(second.status).toBe('completed')
    // 相同 seed + 相同 ID 集合 → 目標相同 → 第二輪 0 move
    expect(m.live.f.map(n => n.id)).toEqual(order1)
    expect(m.moveLog).toHaveLength(moves1)
    const seed2 = (await m.chromeMock.storage.local.get(RANDOM_SEED_KEY))[RANDOM_SEED_KEY]
    expect(seed2).toBe(seed1)
  })
})
