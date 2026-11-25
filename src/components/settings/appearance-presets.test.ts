import type { AppearanceSettings } from '../../lib/types'

import { describe, expect, it } from 'vitest'

import { DEFAULT_APPEARANCE_SETTINGS } from '../../lib/appearance'
import {
  findStylePreset,
  STYLE_PRESETS,
} from './appearance-presets'

function base(overrides: Partial<AppearanceSettings> = {}): AppearanceSettings {
  return { ...DEFAULT_APPEARANCE_SETTINGS, ...overrides }
}

describe('style preset Omit guards layout fields', () => {
  it('all preset definitions omit contentWidth / sidebarWidth / sidebarCollapsed', () => {
    for (const preset of Object.values(STYLE_PRESETS)) {
      expect(preset.settings).not.toHaveProperty('contentWidth')
      expect(preset.settings).not.toHaveProperty('sidebarWidth')
      expect(preset.settings).not.toHaveProperty('sidebarCollapsed')
    }
  })
})

describe('findStylePreset ignores sidebar/layout differences', () => {
  it('matches balanced preset even when sidebarWidth differs', () => {
    const custom = {
      ...base(),
      cardStyle: 'soft' as const,
      radius: 12,
      iconSize: 48,
      cardHeight: 80,
      gridCols: 4,
      accentColor: 'neutral' as const,
      colorTheme: 'default' as const,
      sidebarWidth: 300,
    }
    const match = findStylePreset(custom)
    expect(match).toBe('balanced')
  })

  it('matches sky preset even when contentWidth differs', () => {
    const custom = base({
      colorTheme: 'sky',
      contentWidth: 'full',
      sidebarCollapsed: true,
    })
    const match = findStylePreset(custom)
    expect(match).toBe('sky')
  })

  it('matches sky preset even when both sidebar fields differ', () => {
    const custom = base({
      colorTheme: 'sky',
      sidebarWidth: 200,
      sidebarCollapsed: true,
    })
    const match = findStylePreset(custom)
    expect(match).toBe('sky')
  })
})
