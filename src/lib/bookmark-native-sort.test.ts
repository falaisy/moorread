import type { NativeSortCriterion } from './bookmark-native-sort'
import type { BookmarkTreeNode } from './bookmark-tree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareNodes,
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
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

  it('caps to MAX_SORT_CRITERIA entries', () => {
    const raw: NativeSortCriterion[] = [
      { field: 'title', direction: 'asc' },
      { field: 'url', direction: 'asc' },
      { field: 'dateAdded', direction: 'asc' },
      { field: 'dateLastUsed', direction: 'asc' }, // 第 4 個
    ]
    expect(normalizeSortCriteria(raw)).toHaveLength(MAX_SORT_CRITERIA)
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

  it('returns selected-with-sub for selected mode', () => {
    expect(deriveScopeFromLegacy('selected', false)).toBe('selected-with-sub')
    expect(deriveScopeFromLegacy('selected', true)).toBe('selected-with-sub')
  })
})

describe('sortNativeBookmarks', () => {
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

  it('sorts children of a single writable folder', async () => {
    const children: BookmarkTreeNode[] = [
      node({ id: '1', title: 'Zebra', url: 'https://z.co', dateAdded: 300 }),
      node({ id: '2', title: 'Alpha', url: 'https://a.co', dateAdded: 200 }),
      node({ id: '3', title: 'Mango', url: 'https://m.co', dateAdded: 100 }),
    ]

    const moveCalls: Array<[string, { parentId: string, index: number }]> = []
    const getTree = vi.fn(async () => [{
      id: '0',
      title: '',
      children: [
        { id: '1', title: '' },
        { id: '2', title: 'Other', children: [] },
      ],
    }])
    const getChildren = vi.fn(async () => children)
    const move = vi.fn(async (id, opts) => {
      moveCalls.push([id, opts])
      return { id, title: '', parentId: opts.parentId, index: opts.index }
    })

    vi.stubGlobal('chrome', {
      bookmarks: { getTree, getChildren, move },
    })

    const result = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['2'],
      ignoreFolderIds: [],
      sortCriteria: [{ field: 'title', direction: 'asc' }],
      sortSelf: true,
      recurse: false,
    })

    expect(result.foldersProcessed).toBe(1)
    expect(moveCalls.length).toBeGreaterThan(0)
    expect(getChildren).toHaveBeenCalledWith('2')
  })

  it('skips folders that cannot be read', async () => {
    const getTree = vi.fn(async () => [
      { id: '0', title: '', children: [] },
    ])
    const getChildren = vi.fn(async () => {
      throw new Error('no permission')
    })

    vi.stubGlobal('chrome', {
      bookmarks: { getTree, getChildren, move: vi.fn() },
    })

    const result = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['forbidden'],
      ignoreFolderIds: [],
      sortCriteria: DEFAULT_SORT_CRITERIA,
      sortSelf: true,
      recurse: false,
    })

    expect(result.skipped).toContainEqual({ folderId: 'forbidden', reason: 'cannot read folder' })
  })

  it('skips folders with fewer than 2 children (no move needed)', async () => {
    const getTree = vi.fn(async () => [{ id: '0', title: '', children: [] }])
    const getChildren = vi.fn(async () => [node({ id: 'a', title: 'Only', url: 'https://x.co' })])

    vi.stubGlobal('chrome', {
      bookmarks: { getTree, getChildren, move: vi.fn() },
    })

    const result = await sortNativeBookmarks({
      scope: 'selected-with-sub',
      targetFolderIds: ['folder'],
      ignoreFolderIds: [],
      sortCriteria: DEFAULT_SORT_CRITERIA,
      sortSelf: true,
      recurse: false,
    })

    expect(result.movedBookmarks).toBe(0)
    expect(getChildren).toHaveBeenCalledWith('folder')
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

describe('sortNativeBookmarks write-back', () => {
  function statefulChrome(order: string[], failIds: Set<string> = new Set()) {
    const ids: Record<string, string> = {}
    for (const [i, title] of order.entries())
      ids[title] = `id-${i}`
    const moveCalls: Array<{ id: string, index: number, parentId: string }> = []
    const live = [...order]
    const chromeMock = {
      bookmarks: {
        getTree: vi.fn(async () => [{ id: '0', title: '', children: [{ id: 'folder', title: '', children: [] }] }]),
        getChildren: vi.fn(async (folderId: string) =>
          live.map((title, index) => node({ id: ids[title], title, url: `https://example.com/${title}`, index, parentId: folderId }))),
        move: vi.fn(async (id: string, opts: { parentId: string, index: number }) => {
          moveCalls.push({ id, index: opts.index, parentId: opts.parentId })
          if (failIds.has(id))
            throw new Error('move failed')
          const from = live.findIndex(title => ids[title] === id)
          const title = live[from]
          live.splice(from, 1)
          live.splice(opts.index > from ? opts.index - 1 : opts.index, 0, title)
          return {}
        }),
      },
    }
    return { chromeMock, moveCalls, live, ids }
  }

  const options = {
    scope: 'selected-with-sub' as const,
    targetFolderIds: ['folder'],
    ignoreFolderIds: [],
    sortCriteria: [{ field: 'title' as const, direction: 'asc' as const }],
    sortSelf: true,
    recurse: false,
  }

  it('writes back the correct native order and counts only real moves', async () => {
    const { chromeMock, live } = statefulChrome(['Zebra', 'Alpha', 'Mango'])
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    expect(live).toEqual(['Alpha', 'Mango', 'Zebra'])
    expect(result.movedBookmarks).toBe(2)
    expect(result.skipped).toHaveLength(0)
  })

  it('does not move or report anything when the folder is already sorted', async () => {
    const { chromeMock, moveCalls } = statefulChrome(['Alpha', 'Mango', 'Zebra'])
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    expect(moveCalls).toHaveLength(0)
    expect(result.movedBookmarks).toBe(0)
    expect(result.movedFolders).toBe(0)
  })

  it('does not claim success when every move fails', async () => {
    const order = ['Zebra', 'Alpha', 'Mango']
    const { chromeMock, live, ids } = statefulChrome(order, new Set(['id-0', 'id-1', 'id-2']))
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    expect(live).toEqual(order)
    expect(result.movedBookmarks).toBe(0)
    expect(result.movedFolders).toBe(0)
    expect(result.verificationFailures).toBe(1)
    expect(result.skipped).toContainEqual({ folderId: 'id-1', reason: 'move failed' })
    expect(result.skipped).toContainEqual({ folderId: 'folder', reason: 'order verification failed' })
    expect(ids).toBeTruthy()
  })

  it('counts only successful moves when one node cannot be moved (unmodifiable-like)', async () => {
    const { chromeMock, live } = statefulChrome(['Zebra', 'Alpha', 'Mango'], new Set(['id-1']))
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    // Alpha 無法移動；Mango 仍被搬到 index 1，最終順序核對失敗，不得回報整批成功
    expect(result.skipped).toContainEqual({ folderId: 'id-1', reason: 'move failed' })
    expect(result.movedBookmarks).toBe(1)
    expect(result.verificationFailures).toBe(1)
    expect(live).not.toEqual(['Alpha', 'Mango', 'Zebra'])
  })

  function statefulChromeMixed(nodes: Array<{ title: string, folder?: boolean }>) {
    const ids: Record<string, string> = {}
    for (const [i, n] of nodes.entries())
      ids[n.title] = `id-${i}`
    const kind: Record<string, boolean> = Object.fromEntries(nodes.map(n => [n.title, Boolean(n.folder)]))
    const live = nodes.map(n => n.title)
    const chromeMock = {
      bookmarks: {
        getTree: vi.fn(async () => [{ id: '0', title: '', children: [{ id: 'folder', title: '', children: [] }] }]),
        getChildren: vi.fn(async (folderId: string) =>
          live.map((title, index) => node({
            id: ids[title],
            title,
            url: kind[title] ? undefined : `https://example.com/${title}`,
            index,
            parentId: folderId,
          }))),
        move: vi.fn(async (id: string, opts: { parentId: string, index: number }) => {
          const from = live.findIndex(title => ids[title] === id)
          const title = live[from]
          live.splice(from, 1)
          live.splice(opts.index > from ? opts.index - 1 : opts.index, 0, title)
          return {}
        }),
      },
    }
    return { chromeMock, live }
  }

  it('counts folder moves in movedFolders only', async () => {
    const { chromeMock, live } = statefulChromeMixed([
      { title: 'Zeta', folder: true },
      { title: 'Alpha', folder: true },
    ])
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    expect(live).toEqual(['Alpha', 'Zeta'])
    expect(result.movedBookmarks).toBe(0)
    expect(result.movedFolders).toBe(1)
    expect(result.verificationFailures).toBe(0)
  })

  it('separates bookmark and folder counts when both move', async () => {
    const { chromeMock, live } = statefulChromeMixed([
      { title: 'Zulu' },
      { title: 'AlphaFolder', folder: true },
      { title: 'Beta' },
    ])
    vi.stubGlobal('chrome', chromeMock)

    const result = await sortNativeBookmarks(options)

    expect(live).toEqual(['AlphaFolder', 'Beta', 'Zulu'])
    expect(result.movedBookmarks).toBe(1)
    expect(result.movedFolders).toBe(1)
  })
})
