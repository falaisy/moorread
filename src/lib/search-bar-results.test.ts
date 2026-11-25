import type { Bookmark, Category } from './types'
import { describe, expect, it } from 'vitest'
import { createBookmarkSearchEntry } from './bookmark-search'
import { buildCategoryPathMap } from './category-path'
import {
  buildSearchBarResults,
  EMPTY_SEARCH_BAR_RESULTS,
} from './search-bar-results'

function bookmark(patch: Partial<Bookmark>): Bookmark {
  return {
    id: 'bookmark-1',
    name: '微信公众平台',
    url: 'https://mp.weixin.qq.com',
    categoryId: 'dev',
    ...patch,
  }
}

const categories: Category[] = [
  { id: 'work', name: '工作文档', emoji: '📁', parentId: 'all', modifiable: true },
  { id: 'dev', name: '开发', emoji: '📁', parentId: 'work', modifiable: true },
  { id: 'read', name: '阅读', emoji: '📁', parentId: 'all', modifiable: true },
]
const categoryPathMap = buildCategoryPathMap(categories)

function entriesFor(bookmarks: Bookmark[]) {
  return bookmarks.map(item =>
    createBookmarkSearchEntry(item, categoryPathMap.get(item.categoryId) ?? []))
}

function search(query: string, bookmarks: Bookmark[], limits?: {
  bookmarkLimit?: number
  folderLimit?: number
}) {
  return buildSearchBarResults({
    query,
    entries: entriesFor(bookmarks),
    categories,
    categoryPathMap,
    ...limits,
  })
}

describe('buildSearchBarResults', () => {
  it('returns nothing for an empty or whitespace query', () => {
    const bookmarks = [bookmark({})]
    expect(search('', bookmarks)).toEqual(EMPTY_SEARCH_BAR_RESULTS)
    expect(search('   ', bookmarks)).toEqual(EMPTY_SEARCH_BAR_RESULTS)
    expect(search('', bookmarks).items).toHaveLength(0)
  })

  it('splits matches into bookmark and folder sections', () => {
    const results = search('github', [
      bookmark({ id: 'gh', name: 'GitHub', url: 'https://github.com/acme/repo' }),
    ])

    expect(results.bookmarks.map(item => item.bookmark.id)).toEqual(['gh'])
    expect(results.folders).toHaveLength(0)
    // 書籤區在資料夾區之前，鍵盤上下移動可直接沿用這個扁平順序。
    expect(results.items.map(item => item.kind)).toEqual(['bookmark'])
  })

  it('keeps the full folder path for folder results', () => {
    const results = search('kf', [])
    const dev = results.folders.find(item => item.category.id === 'dev')

    expect(dev?.path).toEqual(['工作文档', '开发'])
    expect(dev?.path.join(' / ')).toBe('工作文档 / 开发')
  })

  it('keeps pinyin initial matching for bookmarks and folders', () => {
    // 微信公众平台 → wx
    const bookmarkResults = search('wx', [bookmark({})])
    expect(bookmarkResults.bookmarks.map(item => item.bookmark.id)).toEqual([
      'bookmark-1',
    ])
    // 开发 → kf
    expect(search('kf', []).folders.map(item => item.category.id)).toEqual([
      'dev',
    ])
  })

  it('ranks each section by score and lists bookmark matches before folders', () => {
    const results = search('work', [
      bookmark({ id: 'weak', name: 'Work log', url: 'https://example.com/log' }),
      bookmark({ id: 'exact', name: 'work', url: 'https://example.com/work' }),
    ])

    expect(results.bookmarks.map(item => item.bookmark.id)).toEqual([
      'exact',
      'weak',
    ])
    expect(results.items[0].kind).toBe('bookmark')
  })

  it('applies section limits without touching the other section', () => {
    const bookmarks = Array.from({ length: 8 }, (_, index) =>
      bookmark({
        id: `b-${index}`,
        name: `Probe ${index}`,
        url: `https://probe-${index}.example.com`,
      }))
    const results = search('probe', bookmarks, { bookmarkLimit: 2 })

    expect(results.bookmarks).toHaveLength(2)
    expect(results.items.filter(item => item.kind === 'bookmark')).toHaveLength(2)
    expect(results.folders).toHaveLength(0)
  })

  it('keeps bookmarks whose folder is missing, with an empty path', () => {
    const results = search('orphan', [
      bookmark({
        id: 'orphan',
        name: 'Orphan',
        url: 'https://orphan.example.com',
        categoryId: 'missing-folder',
      }),
    ])

    expect(results.bookmarks).toHaveLength(1)
    expect(results.bookmarks[0].path).toBe('')
  })

  it('returns empty sections when nothing matches', () => {
    const results = search('nothing-matches-this', [bookmark({})])

    expect(results.bookmarks).toHaveLength(0)
    expect(results.folders).toHaveLength(0)
    expect(results.items).toHaveLength(0)
  })
})
