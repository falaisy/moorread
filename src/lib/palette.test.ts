import type { Hsl } from './palette'
import type { StoragePort } from './storage-port'
import { describe, expect, it } from 'vitest'
import {
  AA_TEXT_CONTRAST,
  AA_UI_CONTRAST,
  contrastRatio,
  DEFAULT_THEME_BASE_COLOR,
  deriveThemePalette,
  EMPTY_THEME_PALETTE,
  hexToRgb,
  hslToRgb,
  isHexColor,
  normalizeHexColor,
  normalizeThemePalette,
  randomBaseColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
  THEME_PALETTE_TOKENS,
} from './palette'
import {
  readThemePalette,
  writeThemePalette,
} from './theme-palette-storage'

const EXTREME_BASES = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
  '#777777',
  '#123456',
  '#2f6fed',
  '#f5f5dc',
]

function parseCssHsl(value: string): Hsl {
  const match = /^(\d{1,3}) (\d{1,3})% (\d{1,3})%$/.exec(value)
  if (!match)
    throw new Error(`unexpected hsl token: ${value}`)
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) }
}

function tokenContrast(first: string, second: string): number {
  return contrastRatio(
    hslToRgb(parseCssHsl(first)),
    hslToRgb(parseCssHsl(second)),
  )
}

describe('hex parsing', () => {
  it('accepts three and six digit hex with or without hash', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('2F6FED')).toBe('#2f6fed')
    expect(isHexColor(' #FFF ')).toBe(true)
  })

  it('rejects invalid input instead of guessing a color', () => {
    for (const value of ['', '#12', 'red', '#12345', '#1234567', 'hsl(0 0% 0%)', null, 42])
      expect(normalizeHexColor(value)).toBeNull()
  })
})

describe('color conversion', () => {
  it('round-trips primary colors through HSL', () => {
    expect(rgbToHex(hslToRgb({ h: 0, s: 100, l: 50 }))).toBe('#ff0000')
    expect(rgbToHex(hslToRgb({ h: 120, s: 100, l: 50 }))).toBe('#00ff00')
    expect(rgbToHex(hslToRgb({ h: 240, s: 100, l: 50 }))).toBe('#0000ff')
    // 整數 HSL 量化允許每通道 2 以內的差異。
    const roundTrip = hslToRgb(rgbToHsl({ r: 47, g: 111, b: 237 }))
    expect(Math.abs(roundTrip.r - 47)).toBeLessThanOrEqual(2)
    expect(Math.abs(roundTrip.g - 111)).toBeLessThanOrEqual(2)
    expect(Math.abs(roundTrip.b - 237)).toBeLessThanOrEqual(2)
  })
})

describe('wcag contrast math', () => {
  it('matches the 21:1 black/white reference and known gray pairs', () => {
    const black = hexToRgb('#000000')!
    const white = hexToRgb('#ffffff')!
    expect(relativeLuminance(black)).toBe(0)
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    // #767676 對白底為 WCAG 常見的 4.54:1 參考值。
    expect(contrastRatio(hexToRgb('#767676')!, white)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hexToRgb('#777777')!, white)).toBeCloseTo(4.48, 1)
  })
})

describe('theme palette derivation', () => {
  it('is deterministic for the same input and mode', () => {
    for (const base of EXTREME_BASES) {
      expect(deriveThemePalette(base, 'light')).toEqual(deriveThemePalette(base, 'light'))
      expect(deriveThemePalette(base, 'dark')).toEqual(deriveThemePalette(base, 'dark'))
    }
  })

  it('returns null for invalid base colors', () => {
    expect(deriveThemePalette('not-a-color', 'light')).toBeNull()
    expect(deriveThemePalette('#12', 'dark')).toBeNull()
  })

  it('emits every existing CSS token in a valid HSL triplet', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = deriveThemePalette(DEFAULT_THEME_BASE_COLOR, mode)!
      expect(Object.keys(palette).sort()).toEqual([...THEME_PALETTE_TOKENS].sort())
      for (const token of THEME_PALETTE_TOKENS)
        expect(palette[token]).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/)
    }
  })

  it('keeps required text pairs at WCAG AA 4.5:1 for extreme base colors', () => {
    const textPairs: Array<[string, string]> = [
      ['--foreground', '--background'],
      ['--card-foreground', '--card'],
      ['--popover-foreground', '--popover'],
      ['--primary-foreground', '--primary'],
      ['--secondary-foreground', '--secondary'],
      ['--muted-foreground', '--muted'],
      ['--muted-foreground', '--background'],
      ['--accent-foreground', '--accent'],
    ]
    for (const base of EXTREME_BASES) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = deriveThemePalette(base, mode)!
        for (const [text, surface] of textPairs) {
          expect(
            tokenContrast(palette[text as keyof typeof palette], palette[surface as keyof typeof palette]),
            `${base} ${mode} ${text}/${surface}`,
          ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST)
        }
      }
    }
  })

  it('keeps essential UI boundaries at 3:1 for extreme base colors', () => {
    for (const base of EXTREME_BASES) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = deriveThemePalette(base, mode)!
        expect(tokenContrast(palette['--ring'], palette['--background'])).toBeGreaterThanOrEqual(AA_UI_CONTRAST)
        expect(tokenContrast(palette['--input'], palette['--background'])).toBeGreaterThanOrEqual(AA_UI_CONTRAST)
        for (const surface of ['--background', '--card'] as const) {
          expect(
            tokenContrast(palette['--border-strong'], palette[surface]),
            `${base} ${mode} vs ${surface}`,
          ).toBeGreaterThanOrEqual(AA_UI_CONTRAST)
        }
      }
    }
  })
})

describe('random base color', () => {
  it('always returns a valid color', () => {
    for (let index = 0; index < 200; index += 1)
      expect(isHexColor(randomBaseColor())).toBe(true)
  })

  it('is deterministic when a seeded random source is injected', () => {
    const seeded = () => 0.42
    expect(randomBaseColor(seeded)).toBe(randomBaseColor(seeded))
    expect(randomBaseColor(() => 0)).toBe(randomBaseColor(() => 0))
    expect(randomBaseColor(() => 0.999999)).toBe(randomBaseColor(() => 0.999999))
  })
})

describe('theme palette state normalization', () => {
  it('falls back to the default state for malformed storage values', () => {
    for (const value of [undefined, null, 'x', 42, [], {}])
      expect(normalizeThemePalette(value)).toEqual(EMPTY_THEME_PALETTE)
  })

  it('keeps valid colors, falls back to saved color and coerces lock', () => {
    expect(normalizeThemePalette({
      baseColor: '#ABC',
      savedBaseColor: '#123456',
      locked: true,
    })).toEqual({ baseColor: '#aabbcc', savedBaseColor: '#123456', locked: true })
    expect(normalizeThemePalette({
      baseColor: 'not-a-color',
      savedBaseColor: '#123456',
    })).toEqual({ baseColor: '#123456', savedBaseColor: '#123456', locked: false })
  })
})

describe('theme palette storage', () => {
  it('propagates write failures so the UI never reports a false save', async () => {
    const failing: StoragePort = {
      get: async () => undefined,
      set: async () => {
        throw new Error('quota exceeded')
      },
      remove: async () => {},
    }
    await expect(writeThemePalette({
      baseColor: '#2f6fed',
      savedBaseColor: '#2f6fed',
      locked: false,
    }, failing)).rejects.toThrow('quota exceeded')
  })

  it('falls back to defaults when reading fails', async () => {
    const failing: StoragePort = {
      get: async () => {
        throw new Error('denied')
      },
      set: async () => {},
      remove: async () => {},
    }
    await expect(readThemePalette(failing)).resolves.toEqual(EMPTY_THEME_PALETTE)
  })
})
