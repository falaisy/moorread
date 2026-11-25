import type { FontOption } from './fonts'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_STACK,
  detectAvailableFonts,

  isFontAvailable,
  resolveFontStack,
} from './fonts'

const installedWidth = 321

// 未安裝的字體會落回 monospace，量到的寬度與基準相同。
function measureInstalledOnly(installed: string) {
  return (fontSpec: string, _text: string): number =>
    fontSpec.includes(`"${installed}"`) ? installedWidth : 200
}

describe('local font detection', () => {
  it('treats a family whose width differs from the monospace baseline as installed', () => {
    expect(isFontAvailable('Installed', measureInstalledOnly('Installed'))).toBe(true)
    expect(isFontAvailable('Missing', measureInstalledOnly('Installed'))).toBe(false)
  })

  it('lists only families available on this machine', () => {
    const catalog: FontOption[] = [
      { label: 'Installed', family: 'Installed', aliases: ['Installed'] },
      { label: 'Missing', family: 'Missing', aliases: ['Missing'] },
    ]
    const fonts = detectAvailableFonts(catalog, measureInstalledOnly('Installed'))
    expect(fonts.map(font => font.label)).toEqual(['Installed'])
  })

  it('returns no fonts when measurement is unavailable', () => {
    expect(detectAvailableFonts(undefined, null)).toEqual([])
  })
})

describe('font stack resolution', () => {
  it('follows the system when no family is selected', () => {
    expect(resolveFontStack('')).toBeNull()
    expect(resolveFontStack('   ')).toBeNull()
  })

  it('keeps every known alias before the system fallback stack', () => {
    const stack = resolveFontStack('Microsoft YaHei')
    expect(stack).toContain('"Microsoft YaHei"')
    expect(stack).toContain('"微软雅黑"')
    expect(stack).toContain(DEFAULT_FONT_STACK)
  })

  it('accepts an alias as the saved value', () => {
    const stack = resolveFontStack('Noto Sans TC')
    expect(stack).toContain('"Source Han Sans TC"')
    expect(stack).toContain('"Noto Sans TC"')
  })

  it('quotes an unknown family instead of dropping it', () => {
    const stack = resolveFontStack('Some Local Font')
    expect(stack).toContain('"Some Local Font"')
    expect(stack).toContain(DEFAULT_FONT_STACK)
  })
})
