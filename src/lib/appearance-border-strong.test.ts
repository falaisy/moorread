import type { Hsl } from './palette'
import { describe, expect, it } from 'vitest'
import { colorThemeVars } from './appearance'
import { AA_UI_CONTRAST, contrastRatio, hslToRgb } from './palette'

/**
 * 既有六組主題與 CSS 預設值不經 palette 引擎產生，
 * 因此 `--border-strong` 必須逐組驗證仍達 WCAG 3:1。
 */
function parseCssHsl(value: string): Hsl {
  const match = /^(\d{1,3}(?:\.\d+)?) (\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/.exec(value)
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

const CSS_DEFAULTS = {
  light: {
    '--background': '40 24% 97%',
    '--card': '40 33% 99%',
    '--border-strong': '34 14% 55%',
  },
  dark: {
    '--background': '225 14% 14%',
    '--card': '225 13% 10%',
    '--border-strong': '225 9% 44%',
  },
} as const

// 元件實際可能位於 --background 或 --card，兩者都必須達標。
const SURFACES = ['--background', '--card'] as const

describe('existing theme border-strong contrast', () => {
  it('keeps every preset above 3:1 on background and card', () => {
    for (const [name, modes] of Object.entries(colorThemeVars)) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = modes[mode]
        expect(tokens['--border-strong'], `${name} ${mode}`).toBeDefined()
        for (const surface of SURFACES) {
          expect(
            tokenContrast(tokens['--border-strong'], tokens[surface]),
            `${name} ${mode} vs ${surface}`,
          ).toBeGreaterThanOrEqual(AA_UI_CONTRAST)
        }
      }
    }
  })

  it('keeps the CSS default tokens above 3:1 on background and card', () => {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = CSS_DEFAULTS[mode]
      for (const surface of SURFACES) {
        expect(
          tokenContrast(tokens['--border-strong'], tokens[surface]),
          `${mode} vs ${surface}`,
        ).toBeGreaterThanOrEqual(AA_UI_CONTRAST)
      }
    }
  })
})
