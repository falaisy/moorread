import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavStore } from './store'

const storageState = vi.hoisted(() => ({
  writes: [] as Array<{ area: string, key: string, value: unknown }>,
  values: new Map<string, unknown>(),
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    area: string

    constructor(options: { area: string }) {
      this.area = options.area
    }

    async get(key: string) {
      return structuredClone(storageState.values.get(`${this.area}:${key}`))
    }

    async set(key: string, value: unknown) {
      storageState.writes.push({ area: this.area, key, value })
      storageState.values.set(`${this.area}:${key}`, structuredClone(value))
    }

    async remove(key: string) {
      storageState.values.delete(`${this.area}:${key}`)
    }
  },
}))

const initialState = useNavStore.getInitialState()
const pageUrl = 'https://example.test/page'
const metaKey = 'local:moorread:meta'

function stubChrome() {
  const move = vi.fn(async () => ({}))
  const update = vi.fn(async () => ({}))
  const tree = [{
    id: '0',
    title: '',
    children: [
      { id: '1', title: 'Bookmarks bar', children: [] },
      { id: '5', title: 'Reading', children: [] },
    ],
  }]
  vi.stubGlobal('chrome', {
    bookmarks: {
      getTree: async () => structuredClone(tree),
      move,
      update,
    },
  })
  return { move, update }
}

function seedBookmark(categoryId: string) {
  useNavStore.setState({
    bookmarks: [{ id: 'bm-1', name: 'Site', url: pageUrl, categoryId }],
    meta: { [pageUrl]: { inboxAt: 1234, description: 'keep me' } },
    categories: [
      { id: 'cat-1', name: 'Bookmarks bar', emoji: '📁', parentId: 'all', modifiable: true },
      { id: 'cat-5', name: 'Reading', emoji: '📚', parentId: 'all', modifiable: true },
    ],
  })
  storageState.values.set(metaKey, { [pageUrl]: { inboxAt: 1234, description: 'keep me' } })
}

beforeEach(() => {
  storageState.writes.length = 0
  storageState.values.clear()
  useNavStore.setState(initialState, true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('updateBookmark 分類變更清 inboxAt（Q2 入口②）', () => {
  it('搬到一般資料夾 → move 到該資料夾，metadata 不再有 inboxAt 但保留其他欄位', async () => {
    const { move } = stubChrome()
    seedBookmark('cat-1')

    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'cat-5' })

    expect(move).toHaveBeenCalledWith('1', { parentId: '5' })
    expect(storageState.values.get(metaKey)).toEqual({ [pageUrl]: { description: 'keep me' } })
    expect(useNavStore.getState().meta[pageUrl]?.inboxAt).toBeUndefined()
  })

  it('搬到 cat-1（書籤列）也要清 inboxAt：cat-1 不是 Inbox', async () => {
    const { move } = stubChrome()
    seedBookmark('cat-5')

    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'cat-1' })

    expect(move).toHaveBeenCalledWith('1', { parentId: '1' })
    expect(storageState.values.get(metaKey)).toEqual({ [pageUrl]: { description: 'keep me' } })
  })

  it('分類未變更 → 不改寫 metadata', async () => {
    stubChrome()
    seedBookmark('cat-5')

    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'cat-5' })

    expect(storageState.writes.filter(write => write.key === 'moorread:meta')).toHaveLength(0)
    expect(useNavStore.getState().meta[pageUrl]?.inboxAt).toBe(1234)
  })

  it('呼叫端明確指定 inboxAt 時以呼叫端為準', async () => {
    stubChrome()
    seedBookmark('cat-1')

    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'cat-5', inboxAt: 777 })

    expect(useNavStore.getState().meta[pageUrl]).toEqual({
      description: 'keep me',
      inboxAt: 777,
    })
  })

  it('虛擬分類 inbox／all 不會呼叫 chrome.bookmarks.move，也不清 inboxAt', async () => {
    const { move } = stubChrome()
    seedBookmark('cat-1')

    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'inbox' })
    await useNavStore.getState().updateBookmark('bm-1', { categoryId: 'all' })

    expect(move).not.toHaveBeenCalled()
    expect(useNavStore.getState().meta[pageUrl]?.inboxAt).toBe(1234)
  })
})
