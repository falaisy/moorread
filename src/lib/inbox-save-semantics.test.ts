import type { NewBookmarkParentResolver, ResolvedSaveTarget } from './quick-save'
import { describe, expect, it, vi } from 'vitest'
import {
  inboxParentId,
  nextBookmarkMetaAfterSave,
  resolveDefaultCategoryForSwitch,
  resolveDefaultTargetFromSetting,
  resolveSaveTarget,
  saveBookmarkWithInboxSemantics,
} from './quick-save'

interface FakeNode {
  id: string
  url?: string
}

function createResolver(options: {
  nodes?: Record<string, FakeNode>
  rejects?: string[]
  defaultTarget?: ResolvedSaveTarget
} = {}) {
  const getNode = vi.fn(async (nodeId: string) => {
    if (options.rejects?.includes(nodeId))
      throw new Error(`invalid bookmark id: ${nodeId}`)
    return options.nodes?.[nodeId]
  })
  const resolveDefaultTarget = vi.fn(async () => (
    options.defaultTarget ?? { parentId: inboxParentId, isInbox: true }
  ))
  const reportFallback = vi.fn()
  const resolver: NewBookmarkParentResolver = { getNode, resolveDefaultTarget, reportFallback }
  return { resolver, getNode, resolveDefaultTarget, reportFallback }
}

const folderNodes: Record<string, FakeNode> = {
  1: { id: '1' },
  7: { id: '7' },
  9: { id: '9', url: 'https://already-a-bookmark.example' },
}

describe('resolveSaveTarget（三值分類語意）', () => {
  it('①未帶分類 → Inbox，且不讀取預設分類', async () => {
    const { resolver, resolveDefaultTarget } = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget(undefined, resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })
    expect(resolveDefaultTarget).not.toHaveBeenCalled()
  })

  it('②明確 inbox → Inbox，且 resolveDefaultTarget 未被呼叫（不得併入 all）', async () => {
    const { resolver, resolveDefaultTarget, getNode } = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget('inbox', resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })
    expect(resolveDefaultTarget).not.toHaveBeenCalled()
    expect(getNode).not.toHaveBeenCalled()
  })

  it('③all → 跟隨正式預設分類', async () => {
    const { resolver, resolveDefaultTarget, getNode } = createResolver({
      nodes: folderNodes,
      defaultTarget: { parentId: '7', isInbox: false },
    })
    await expect(resolveSaveTarget('all', resolver)).resolves.toEqual({
      parentId: '7',
      isInbox: false,
    })
    expect(resolveDefaultTarget).toHaveBeenCalledTimes(1)
    expect(getNode).not.toHaveBeenCalled()
  })

  it('④有效 cat-7 → 該資料夾且不算 Inbox', async () => {
    const { resolver, resolveDefaultTarget } = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget('cat-7', resolver)).resolves.toEqual({
      parentId: '7',
      isInbox: false,
    })
    expect(resolveDefaultTarget).not.toHaveBeenCalled()
  })

  it('⑤cat-1（書籤列）是普通資料夾，不是 Inbox', async () => {
    const { resolver } = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget('cat-1', resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: false,
    })
  })

  it('⑥節點不存在／節點是書籤／節點查詢拋錯 → 安全回退 Inbox', async () => {
    const missing = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget('cat-999', missing.resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })
    expect(missing.reportFallback).not.toHaveBeenCalled()

    const nodeIsBookmark = createResolver({ nodes: folderNodes })
    await expect(resolveSaveTarget('cat-9', nodeIsBookmark.resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })

    const rejects = createResolver({ nodes: folderNodes, rejects: ['9'] })
    await expect(resolveSaveTarget('cat-9', rejects.resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })
    expect(rejects.reportFallback).toHaveBeenCalledTimes(1)
  })
})

describe('resolveDefaultTargetFromSetting', () => {
  it('⑦預設值為 inbox → Inbox', async () => {
    const { resolver, getNode } = createResolver({ nodes: folderNodes })
    await expect(resolveDefaultTargetFromSetting('inbox', resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: true,
    })
    expect(getNode).not.toHaveBeenCalled()
  })

  it('⑧預設值為 cat-1 → 書籤列資料夾，不可當成 Inbox', async () => {
    const { resolver } = createResolver({ nodes: folderNodes })
    await expect(resolveDefaultTargetFromSetting('cat-1', resolver)).resolves.toEqual({
      parentId: '1',
      isInbox: false,
    })
  })

  it('⑨預設值為 all／undefined／空字串／無效分類 → 安全回退 Inbox', async () => {
    const cases = ['all', undefined, '', 'cat-999', 42, null]
    for (const value of cases) {
      const { resolver } = createResolver({ nodes: folderNodes })
      await expect(resolveDefaultTargetFromSetting(value, resolver)).resolves.toEqual({
        parentId: '1',
        isInbox: true,
      })
    }
  })

  it('⑨b 預設值為有效 cat-7 → 該資料夾', async () => {
    const { resolver } = createResolver({ nodes: folderNodes })
    await expect(resolveDefaultTargetFromSetting('cat-7', resolver)).resolves.toEqual({
      parentId: '7',
      isInbox: false,
    })
  })
})

describe('resolveDefaultCategoryForSwitch（R7）', () => {
  it('⑩非字串 → all；空字串 → inbox；其餘原樣（含 cat-1）', () => {
    expect(resolveDefaultCategoryForSwitch(undefined)).toBe('all')
    expect(resolveDefaultCategoryForSwitch(null)).toBe('all')
    expect(resolveDefaultCategoryForSwitch(1)).toBe('all')
    expect(resolveDefaultCategoryForSwitch('')).toBe('inbox')
    expect(resolveDefaultCategoryForSwitch('inbox')).toBe('inbox')
    expect(resolveDefaultCategoryForSwitch('all')).toBe('all')
    expect(resolveDefaultCategoryForSwitch('cat-5')).toBe('cat-5')
    expect(resolveDefaultCategoryForSwitch('cat-1')).toBe('cat-1')
  })
})

describe('nextBookmarkMetaAfterSave', () => {
  it('⑪Inbox 且未指定時間 → 寫入 now', () => {
    expect(nextBookmarkMetaAfterSave(undefined, true, {}, 1000)).toEqual({ inboxAt: 1000 })
  })

  it('⑫Inbox 且指定時間 → 沿用合法時間；非正值改用 now', () => {
    expect(nextBookmarkMetaAfterSave(undefined, true, { requestedInboxAt: 555 }, 1000))
      .toEqual({ inboxAt: 555 })
    expect(nextBookmarkMetaAfterSave(undefined, true, { requestedInboxAt: 0 }, 1000))
      .toEqual({ inboxAt: 1000 })
  })

  it('⑬非 Inbox → 刪除 inboxAt，其餘 metadata 原樣保留', () => {
    const result = nextBookmarkMetaAfterSave(
      {
        inboxAt: 123,
        description: 'note',
        icon: 'https://icon.example/i.png',
        pinnedAt: 5,
        alternateUrls: ['https://alt.example'],
        tags: ['keep'],
      },
      false,
      {},
      1000,
    )
    expect(result).toEqual({
      description: 'note',
      icon: 'https://icon.example/i.png',
      pinnedAt: 5,
      alternateUrls: ['https://alt.example'],
      tags: ['keep'],
    })
    expect(result && 'inboxAt' in result).toBe(false)
  })

  it('⑭tags 會 trim／去重／上限 12', () => {
    expect(nextBookmarkMetaAfterSave(undefined, false, { tags: [' a ', 'a', '', '  ', 'b'] }, 1000))
      .toEqual({ tags: ['a', 'b'] })
    const many = Array.from({ length: 20 }, (_, index) => `tag-${index}`)
    const limited = nextBookmarkMetaAfterSave(undefined, false, { tags: many }, 1000)
    expect(limited?.tags).toHaveLength(12)
    expect(limited?.tags?.[0]).toBe('tag-0')
  })

  it('⑮沒有內容的 entry → undefined（不留下空記錄）', () => {
    expect(nextBookmarkMetaAfterSave(undefined, false, {}, 1000)).toBeUndefined()
    expect(nextBookmarkMetaAfterSave({ inboxAt: 5 }, false, {}, 1000)).toBeUndefined()
    expect(nextBookmarkMetaAfterSave(undefined, true, { tags: [] }, 1000))
      .toEqual({ inboxAt: 1000 })
  })
})

describe('saveBookmarkWithInboxSemantics', () => {
  it('⑯建立書籤失敗時不寫 metadata', async () => {
    const persistMeta = vi.fn(async () => ({ written: true }))
    await expect(saveBookmarkWithInboxSemantics(
      { url: 'https://example.com/new', parentId: '1', isInbox: true },
      {
        createBookmark: async () => {
          throw new Error('create failed')
        },
        persistMeta,
      },
    )).rejects.toThrow('create failed')
    expect(persistMeta).not.toHaveBeenCalled()
  })

  it('⑰建立回應的 parentId 不影響結果（不依賴未驗證的回傳欄位）', async () => {
    const persisted: Record<string, unknown> = {}
    const result = await saveBookmarkWithInboxSemantics(
      { url: 'https://example.com/new', parentId: '7', isInbox: false },
      {
        createBookmark: async () => ({ id: 'x' }),
        persistMeta: async (update) => {
          Object.assign(persisted, update({}))
          return { written: true }
        },
        now: () => 1000,
      },
    )
    expect(result).toEqual({
      id: 'x',
      parentId: '7',
      inboxMarked: false,
      metaWritten: true,
    })
    expect(persisted).toEqual({})
  })

  it('⑰b 明確分類時即使舊記錄有 inboxAt 也會移除，並保留其他欄位', async () => {
    let written: Record<string, unknown> = {}
    await saveBookmarkWithInboxSemantics(
      { url: 'https://example.com/saved', parentId: '7', isInbox: false },
      {
        createBookmark: async () => ({ id: 'bm-7' }),
        persistMeta: async (update) => {
          written = update({ 'https://example.com/saved': { inboxAt: 42, description: 'keep' } })
          return { written: true }
        },
        now: () => 1000,
      },
    )
    expect(written).toEqual({ 'https://example.com/saved': { description: 'keep' } })
  })
})

describe('儲存路徑不讀 popup 記憶分類', () => {
  it('⑱解析三值時完全不存取 storage', async () => {
    const get = vi.fn()
    const set = vi.fn()
    vi.stubGlobal('chrome', {
      storage: {
        local: { get, set },
        sync: { get, set },
      },
    })
    try {
      const { resolver } = createResolver({
        nodes: folderNodes,
        defaultTarget: { parentId: '7', isInbox: false },
      })
      await resolveSaveTarget('inbox', resolver)
      await resolveSaveTarget('all', resolver)
      expect(resolveDefaultCategoryForSwitch('')).toBe('inbox')
      await resolveDefaultTargetFromSetting('cat-1', resolver)
      expect(get).not.toHaveBeenCalled()
      expect(set).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
