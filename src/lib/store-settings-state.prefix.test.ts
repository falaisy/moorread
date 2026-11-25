import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveAvailableCategoryId,
} from './store-settings-state'

describe('normalizeSettings.defaultCategoryId migration', () => {
  it('migrates legacy raw native id "5" → "cat-5"', () => {
    const result = normalizeSettings({ defaultCategoryId: '5' })
    expect(result.defaultCategoryId).toBe('cat-5')
  })

  it('does NOT double-prefix already-prefixed "cat-5"', () => {
    const result = normalizeSettings({ defaultCategoryId: 'cat-5' })
    expect(result.defaultCategoryId).toBe('cat-5')
  })

  it('leaves virtual ids unchanged ("all", "pinned", "inbox", "frequent", "recent")', () => {
    for (const id of ['all', 'pinned', 'inbox', 'frequent', 'recent', 'untagged', 'undescribed']) {
      const result = normalizeSettings({ defaultCategoryId: id })
      expect(result.defaultCategoryId).toBe(id)
    }
  })

  it('falls back to DEFAULT on empty/null/undefined', () => {
    expect(normalizeSettings({ defaultCategoryId: '' }).defaultCategoryId).toBe(DEFAULT_SETTINGS.defaultCategoryId)
    expect(normalizeSettings({ defaultCategoryId: undefined }).defaultCategoryId).toBe(DEFAULT_SETTINGS.defaultCategoryId)
  })

  it('preserves non-numeric custom strings (future-proofing)', () => {
    // e.g. a future category type "ai-folder" or "imported-batch-42"
    expect(normalizeSettings({ defaultCategoryId: 'ai-folder' }).defaultCategoryId).toBe('ai-folder')
    expect(normalizeSettings({ defaultCategoryId: 'cat-tree-root' }).defaultCategoryId).toBe('cat-tree-root')
  })
})

describe('resolveAvailableCategoryId (cross-check)', () => {
  const catAll = { id: 'all', name: '全部' } as const
  const catPinned = { id: 'pinned', name: '置頂' } as const
  const catNative5 = { id: 'cat-5', name: '我的資料夾' } as const
  const categories: any[] = [catAll, catPinned, catNative5]

  it('virtual ids match directly', () => {
    expect(resolveAvailableCategoryId('pinned', categories)).toBe('pinned')
    expect(resolveAvailableCategoryId('all', categories)).toBe('all')
  })

  it('prefixed native id matches', () => {
    expect(resolveAvailableCategoryId('cat-5', categories)).toBe('cat-5')
  })

  it('nonexistent id falls back to "all"', () => {
    expect(resolveAvailableCategoryId('cat-999', categories)).toBe('all')
  })
})
