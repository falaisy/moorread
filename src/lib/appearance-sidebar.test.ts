import { describe, expect, it } from 'vitest'

import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './appearance'

describe('sidebar width constants', () => {
  it('defines safe defaults within clamp range', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
    expect(SIDEBAR_WIDTH_COLLAPSED).toBeLessThan(SIDEBAR_WIDTH_MIN)
  })
})

describe('normalizeAppearanceSettings sidebar fields', () => {
  it('fills missing sidebarWidth with default', () => {
    const result = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: undefined as never,
    })
    expect(result.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('clamps sidebarWidth to [MIN, MAX]', () => {
    let r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: 100,
    })
    expect(r.sidebarWidth).toBe(SIDEBAR_WIDTH_MIN)

    r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: 500,
    })
    expect(r.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('preserves a valid width in range', () => {
    const r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: 280,
    })
    expect(r.sidebarWidth).toBe(280)
  })

  it('rejects NaN and non-finite values with default', () => {
    let r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: Number.NaN,
    })
    expect(r.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)

    r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: Number.POSITIVE_INFINITY,
    })
    expect(r.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('normalizes non-integer widths to nearest integer', () => {
    const r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarWidth: 232.7,
    })
    expect(r.sidebarWidth).toBe(233)
  })

  it('fills missing sidebarCollapsed with false', () => {
    const r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarCollapsed: undefined as never,
    })
    expect(r.sidebarCollapsed).toBe(false)
  })

  it('preserves explicit collapsed=true', () => {
    const r = normalizeAppearanceSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      sidebarCollapsed: true,
    })
    expect(r.sidebarCollapsed).toBe(true)
  })
})
