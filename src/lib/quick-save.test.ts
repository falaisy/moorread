import type { QuickSaveBookmarkInput, SaveParentResolver } from './quick-save'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalizeBookmarkUrl } from './bookmark-urls'
import { LocalizedError } from './localized-error'
import {
  currentPageFromTab,
  getDuplicateBookmark,
  resolveSaveParentId,
  saveQuickBookmark,
} from './quick-save'

// loadQuickSaveData uses @plasmohq/storage.Storage (internal), complex to mock;
// the URL dedup, currentPageFromTab, and saveQuickBookmark paths are covered here.

// --- URL dedup ---

describe('quick save — URL dedup', () => {
  it('canonicalizes cosmetic URL differences', () => {
    expect(canonicalizeBookmarkUrl('HTTPS://Example.COM:443/#section'))
      .toBe('https://example.com/')
  })

  it('finds an existing bookmark after canonicalization', () => {
    const bookmarks = [{ url: 'https://example.com/' }]
    expect(getDuplicateBookmark(bookmarks, 'https://EXAMPLE.com/#top'))
      .toBe(bookmarks[0])
  })

  it('returns undefined when url is empty after canonicalization', () => {
    expect(getDuplicateBookmark<{ url: string }>([], '')).toBeUndefined()
  })

  it('returns undefined when no duplicate after canonicalization', () => {
    const bookmarks = [{ url: 'https://a.com/' }]
    expect(getDuplicateBookmark(bookmarks, 'https://b.com/')).toBeUndefined()
  })
})

// --- currentPageFromTab ---

describe('quick save — currentPageFromTab', () => {
  function makeTab(title: string, url: string): Pick<chrome.tabs.Tab, 'title' | 'url'> {
    return { title, url }
  }

  it('returns null for browser-internal pages', () => {
    expect(currentPageFromTab(makeTab('Extensions', 'chrome://extensions'))).toBeNull()
    expect(currentPageFromTab(makeTab('', 'about:blank'))).toBeNull()
    expect(currentPageFromTab(makeTab('', 'edge://settings'))).toBeNull()
  })

  it('returns null when tab is undefined', () => {
    expect(currentPageFromTab(undefined)).toBeNull()
  })

  it('returns null when URL is empty', () => {
    expect(currentPageFromTab(makeTab('', ''))).toBeNull()
  })

  it('normalizes and returns title + URL', () => {
    const result = currentPageFromTab(makeTab('  My Page  ', 'https://example.com/page?q=1'))
    expect(result).toEqual({ title: 'My Page', url: 'https://example.com/page?q=1' })
  })

  it('uses hostname as title fallback when title is empty', () => {
    const result = currentPageFromTab(makeTab('', 'https://example.com/page'))
    expect(result).toEqual({ title: 'example.com', url: 'https://example.com/page' })
  })

  it('preserves original URL casing (normalizeBookmarkUrl, not canonicalize)', () => {
    // currentPageFromTab uses normalizeBookmarkUrl which preserves protocol/hostname case
    const result = currentPageFromTab(makeTab('Test', 'HTTP://EXAMPLE.COM/'))
    expect(result).toEqual({ title: 'Test', url: 'HTTP://EXAMPLE.COM/' })
  })
})

// --- saveQuickBookmark ---

describe('quick save — saveQuickBookmark', () => {
  const input: QuickSaveBookmarkInput = {
    name: 'Example',
    url: 'https://example.com/',
    categoryId: 'cat-1',
    tags: ['test'],
    inboxAt: Date.now(),
  }

  let response: { ok: boolean, errorKey?: string, params?: Record<string, unknown> }

  beforeEach(() => {
    vi.resetAllMocks()
    response = { ok: true }
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => response),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends message and resolves when ok=true', async () => {
    response = { ok: true }

    await expect(saveQuickBookmark(input)).resolves.toBeUndefined()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'moorread:quick-save-bookmark',
      bookmark: input,
    })
  })

  it('throws LocalizedError when response has ok=false with default key', async () => {
    response = { ok: false }

    try {
      await saveQuickBookmark(input)
      expect.fail('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(LocalizedError)
      expect((err as LocalizedError).messageKey).toBe('runtimeQuickSaveFailed')
    }
  })

  it('throws LocalizedError with custom errorKey and params', async () => {
    response = { ok: false, errorKey: 'customSaveFailed', params: { reason: 'duplicate' } }

    try {
      await saveQuickBookmark(input)
      expect.fail('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(LocalizedError)
      expect((err as LocalizedError).messageKey).toBe('customSaveFailed')
      expect((err as LocalizedError).params).toEqual({ reason: 'duplicate' })
    }
  })
})

// --- resolveSaveParentId（命令面板／快速儲存的分類解析）---

describe('quick save — resolveSaveParentId', () => {
  const nodes: Record<string, { id: string, url?: string }> = {
    '5': { id: '5' },
    '12': { id: '12' },
    'bookmark-node': { id: 'bookmark-node', url: 'https://example.com/' },
  }

  function makeResolver(fallbackParentId = '1') {
    const getNode = vi.fn(async (nodeId: string) => nodes[nodeId])
    const fallback = vi.fn(async () => fallbackParentId)
    const resolver: SaveParentResolver = { getNode, fallbackParentId: fallback }
    return { resolver, getNode, fallback }
  }

  it('resolves a real category id to the native folder id', async () => {
    const { resolver, getNode } = makeResolver()
    await expect(resolveSaveParentId('cat-12', resolver)).resolves.toBe('12')
    expect(getNode).toHaveBeenCalledWith('12')
  })

  it('resolves cat-5 to native folder 5', async () => {
    const { resolver } = makeResolver()
    await expect(resolveSaveParentId('cat-5', resolver)).resolves.toBe('5')
  })

  it('never returns a virtual category id', async () => {
    const { resolver } = makeResolver()
    for (const categoryId of ['cat-12', 'cat-5', 'all', '']) {
      const parentId = await resolveSaveParentId(categoryId, resolver)
      expect(parentId).not.toBe('all')
      expect(parentId.startsWith('cat-')).toBe(false)
    }
  })

  it('uses the fallback location for "all" (virtual "全部書籤" view)', async () => {
    const { resolver, getNode, fallback } = makeResolver('7')
    await expect(resolveSaveParentId('all', resolver)).resolves.toBe('7')
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(getNode).not.toHaveBeenCalled()
  })

  it('uses the fallback location when no category is specified', async () => {
    const { resolver, getNode, fallback } = makeResolver('7')
    await expect(resolveSaveParentId(undefined, resolver)).resolves.toBe('7')
    await expect(resolveSaveParentId('', resolver)).resolves.toBe('7')
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(getNode).not.toHaveBeenCalled()
  })

  it('falls back to Inbox when the category no longer exists', async () => {
    const { resolver } = makeResolver('7')
    await expect(resolveSaveParentId('cat-404', resolver)).resolves.toBe('1')
  })

  it('falls back to Inbox and reports when chrome.bookmarks.get throws', async () => {
    const reportFallback = vi.fn()
    const getNode = vi.fn(async () => {
      throw new Error('Invalid bookmark id')
    })
    const resolver: SaveParentResolver = {
      getNode,
      fallbackParentId: async () => '7',
      reportFallback,
    }
    await expect(resolveSaveParentId('cat-gone', resolver)).resolves.toBe('1')
    expect(reportFallback).toHaveBeenCalledTimes(1)
  })

  it('falls back to Inbox when the target node is a bookmark instead of a folder', async () => {
    const { resolver } = makeResolver('7')
    await expect(resolveSaveParentId('cat-bookmark-node', resolver)).resolves.toBe('1')
  })
})
