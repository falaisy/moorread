import { describe, expect, it } from 'vitest'
import { gridClass, normalizeAppearanceSettings } from './appearance'

describe('appearance settings', () => {
  it('enables category tree and smart categories by default while preserving explicit choices', () => {
    const defaults = normalizeAppearanceSettings()
    const explicitChoices = normalizeAppearanceSettings({
      navItems: { categoryTree: false, smartCategories: false },
    })

    expect(defaults.navItems.smartCategories).toBe(true)
    expect(defaults.navItems.categoryTree).toBe(true)
    expect(explicitChoices.navItems.smartCategories).toBe(false)
    expect(explicitChoices.navItems.categoryTree).toBe(false)
  })

  it('shows icons for older settings and preserves explicit hidden choices', () => {
    const defaults = normalizeAppearanceSettings({ cardFields: { tags: false }, navItems: { counts: false } })
    expect(defaults.cardFields.websiteIcon).toBe(true)
    expect(defaults.navItems.icons).toBe(true)
    const hidden = normalizeAppearanceSettings({ cardFields: { websiteIcon: false }, navItems: { icons: false } })
    expect(hidden.cardFields.websiteIcon).toBe(false)
    expect(hidden.navItems.icons).toBe(false)
  })
})

describe('separate bookmark and folder grid columns', () => {
  it('defaults new installs to auto for both grids', () => {
    const defaults = normalizeAppearanceSettings()
    expect(defaults.bookmarkGridCols).toBe(0)
    expect(defaults.folderGridCols).toBe(0)
  })

  it('migrates the legacy gridCols into both grids without losing the choice', () => {
    const migrated = normalizeAppearanceSettings({ gridCols: 5 })
    expect(migrated.bookmarkGridCols).toBe(5)
    expect(migrated.folderGridCols).toBe(5)
    // 舊欄位保留，供其他讀取點使用
    expect(migrated.gridCols).toBe(5)
  })

  it('keeps explicit auto (0) and independent values', () => {
    const normalized = normalizeAppearanceSettings({ bookmarkGridCols: 0, folderGridCols: 8 })
    expect(normalized.bookmarkGridCols).toBe(0)
    expect(normalized.folderGridCols).toBe(8)
  })

  it('clamps numeric values to the 1-8 range', () => {
    expect(normalizeAppearanceSettings({ bookmarkGridCols: 12 }).bookmarkGridCols).toBe(8)
    expect(normalizeAppearanceSettings({ folderGridCols: -3 }).folderGridCols).toBe(0)
    expect(normalizeAppearanceSettings({ bookmarkGridCols: 3.8 }).bookmarkGridCols).toBe(3)
  })

  it('maps 1-8 columns and auto to static Tailwind classes', () => {
    expect(gridClass(8, false)).toContain('2xl:grid-cols-8')
    expect(gridClass(7, false)).toContain('2xl:grid-cols-7')
    expect(gridClass(0, false)).toBe(gridClass(4, false))
    expect(gridClass(8, true)).toContain('2xl:grid-cols-8')
    expect(gridClass(0, true)).toBe(gridClass(2, true))
  })
})
