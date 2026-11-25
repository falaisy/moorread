import type { BookmarkMeta } from './types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS, updateBookmarkMetadataGuarded } from './store-persistence'

const storage = vi.hoisted(() => {
  const data = new Map<string, unknown>()
  const setSpy = vi.fn()
  const getSpy = vi.fn()
  return { data, setSpy, getSpy }
})

vi.mock('@plasmohq/storage', () => ({
  Storage: class {
    constructor(_options: { area: string }) {}
    async get(key: string) {
      storage.getSpy(key)
      return storage.data.get(key)
    }

    async set(key: string, value: unknown) {
      // 允許測試以 mockRejectedValue 模擬寫入失敗（例如配額不足）。
      await storage.setSpy(key, value)
      storage.data.set(key, JSON.stringify(value))
    }

    async remove(key: string) {
      storage.data.delete(key)
    }
  },
}))

const rawMetaKey = STORAGE_KEYS.meta

function stubChromeRaw(raw: unknown) {
  const get = vi.fn(async () => ({ [rawMetaKey]: raw }))
  vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } })
  return get
}

/** 讀取會反映目前 mock 儲存內容，用於驗證鎖內序列化的併發行為。 */
function stubChromeLiveStore(initial?: unknown) {
  if (initial !== undefined)
    storage.data.set(rawMetaKey, initial)
  const get = vi.fn(async () => ({ [rawMetaKey]: storage.data.get(rawMetaKey) }))
  vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } })
  return get
}

beforeEach(() => {
  storage.data.clear()
  storage.setSpy.mockClear()
  storage.getSpy.mockClear()
})

describe('updateBookmarkMetadataGuarded（Q3：壞資料不得被當成空記錄覆寫）', () => {
  it('壞 JSON → written:false 且不寫回', async () => {
    stubChromeRaw('{not-json')
    const update = vi.fn(() => ({ 'https://example.com': { tags: ['x'] } }))
    await expect(updateBookmarkMetadataGuarded(update)).resolves.toEqual({ written: false })
    expect(update).not.toHaveBeenCalled()
    expect(storage.setSpy).not.toHaveBeenCalled()
  })

  it('頂層是陣列 → written:false 且不寫回', async () => {
    stubChromeRaw('[1,2,3]')
    const update = vi.fn(() => ({}))
    await expect(updateBookmarkMetadataGuarded(update)).resolves.toEqual({ written: false })
    expect(storage.setSpy).not.toHaveBeenCalled()
  })

  it('頂層是純值字串 → written:false 且不寫回', async () => {
    stubChromeRaw('"corrupted"')
    const update = vi.fn(() => ({}))
    await expect(updateBookmarkMetadataGuarded(update)).resolves.toEqual({ written: false })
    expect(storage.setSpy).not.toHaveBeenCalled()
  })

  it('entry 非純物件 → written:false 且不寫回', async () => {
    const stored = JSON.stringify({
      'https://ok.example': { tags: ['kept'] },
      'https://broken.example': 'oops',
    })
    stubChromeRaw(stored)
    const update = vi.fn((latest: Record<string, BookmarkMeta>) => ({
      ...latest,
      'https://new.example': { tags: ['new'] },
    }))
    await expect(updateBookmarkMetadataGuarded(update)).resolves.toEqual({ written: false })
    expect(storage.setSpy).not.toHaveBeenCalled()
  })

  it('沒有既有資料 → 以空物件初始化並寫入一次', async () => {
    stubChromeRaw(undefined)
    const seen: Record<string, BookmarkMeta>[] = []
    const result = await updateBookmarkMetadataGuarded((latest) => {
      seen.push(latest)
      return { ...latest, 'https://example.com': { inboxAt: 1 } }
    })
    expect(result).toEqual({ written: true })
    expect(seen).toEqual([{}])
    expect(storage.setSpy).toHaveBeenCalledTimes(1)
    expect(storage.data.get(rawMetaKey)).toBe(JSON.stringify({
      'https://example.com': { inboxAt: 1 },
    }))
  })

  it('合法 JSON 字串 → 合併既有記錄並寫入一次', async () => {
    stubChromeRaw(JSON.stringify({
      'https://keep.example': { description: 'keep' },
    }))
    const result = await updateBookmarkMetadataGuarded(latest => ({
      ...latest,
      'https://example.com': { inboxAt: 99 },
    }))
    expect(result).toEqual({ written: true })
    expect(storage.setSpy).toHaveBeenCalledTimes(1)
    expect(storage.data.get(rawMetaKey)).toBe(JSON.stringify({
      'https://keep.example': { description: 'keep' },
      'https://example.com': { inboxAt: 99 },
    }))
  })

  it('舊版直接寫入的物件（非字串）也可讀取', async () => {
    stubChromeRaw({ 'https://legacy.example': { tags: ['old'] } })
    const result = await updateBookmarkMetadataGuarded(latest => ({
      ...latest,
      'https://new.example': { inboxAt: 2 },
    }))
    expect(result).toEqual({ written: true })
    expect(storage.setSpy).toHaveBeenCalledTimes(1)
  })

  it('計算後沒有變更時不重複寫入', async () => {
    stubChromeRaw(JSON.stringify({ 'https://keep.example': { inboxAt: 1 } }))
    const result = await updateBookmarkMetadataGuarded(latest => latest)
    expect(result).toEqual({ written: true })
    expect(storage.setSpy).not.toHaveBeenCalled()
  })

  it('併發更新：鎖內序列化，兩筆更新都保留', async () => {
    stubChromeLiveStore()
    await Promise.all([
      updateBookmarkMetadataGuarded(latest => ({
        ...latest,
        'https://a.example': { tags: ['a'] },
      })),
      updateBookmarkMetadataGuarded(latest => ({
        ...latest,
        'https://b.example': { tags: ['b'] },
      })),
    ])
    expect(JSON.parse(String(storage.data.get(rawMetaKey)))).toEqual({
      'https://a.example': { tags: ['a'] },
      'https://b.example': { tags: ['b'] },
    })
  })

  it('寫入失敗：拒絕且不留下部分資料', async () => {
    stubChromeRaw(undefined)
    storage.setSpy.mockRejectedValueOnce(new Error('quota exceeded'))
    await expect(updateBookmarkMetadataGuarded(() => ({
      'https://x.example': { tags: ['x'] },
    }))).rejects.toThrow('quota exceeded')
    expect(storage.data.get(rawMetaKey)).toBeUndefined()
  })
})
