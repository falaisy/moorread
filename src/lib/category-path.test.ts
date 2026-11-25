import type { Category } from './types'

import { describe, expect, it } from 'vitest'
import {
  buildCategoryPathMap,
  findCategoryByPath,
  getCategoryPath,
  resolveCategorySavePreview,
} from './category-path'

const categories: Category[] = [
  {
    id: 'cat-work',
    name: '工作',
    emoji: '📁',
    parentId: 'all',
    modifiable: true,
  },
  {
    id: 'cat-docs',
    name: '文档',
    emoji: '📁',
    parentId: 'cat-work',
    modifiable: true,
  },
]

describe('category paths', () => {
  it('builds a nested category path', () => {
    expect(getCategoryPath('cat-docs', categories)).toEqual(['工作', '文档'])
  })

  it('finds a category by path', () => {
    expect(findCategoryByPath(['工作', '文档'], categories)?.id).toBe(
      'cat-docs',
    )
  })

  it('builds a map for every reachable category', () => {
    expect(buildCategoryPathMap(categories).get('cat-docs')).toEqual([
      '工作',
      '文档',
    ])
  })
})

describe('category save preview', () => {
  const tree: Category[] = [
    { id: 'cat-1', name: '書籤列', emoji: '📁', parentId: 'all', modifiable: true },
    { id: 'cat-work', name: '工作', emoji: '📁', parentId: 'cat-1', modifiable: true },
    { id: 'cat-docs', name: '文档', emoji: '📁', parentId: 'cat-work', modifiable: true },
    { id: 'cat-other', name: '其他書籤', emoji: '📁', parentId: 'all', modifiable: true },
    { id: 'cat-docs-2', name: '文档', emoji: '📁', parentId: 'cat-other', modifiable: true },
  ]

  it('shows the full path of an existing folder that will be reused', () => {
    expect(resolveCategorySavePreview('文档', tree, 'cat-1')).toEqual({
      path: ['書籤列', '工作', '文档'],
      existing: true,
    })
  })

  it('shows the bookmarks-bar path for a new folder', () => {
    expect(resolveCategorySavePreview('閱讀清單', tree, 'cat-1')).toEqual({
      path: ['書籤列', '閱讀清單'],
      existing: false,
    })
  })

  it('ignores blank input', () => {
    expect(resolveCategorySavePreview('   ', tree, 'cat-1')).toBeUndefined()
  })

  it('matches the same first-by-name rule used when creating categories', () => {
    // addCategory 以陣列順序取第一個同名資料夾；預覽必須顯示同一個目標。
    expect(resolveCategorySavePreview('文档', tree, 'cat-1')?.path).toEqual([
      '書籤列',
      '工作',
      '文档',
    ])
  })
})
