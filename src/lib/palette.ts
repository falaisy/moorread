/**
 * 主題配色引擎：由單一 Base Color 決定性衍生淺色／深色介面配色。
 *
 * 所有輸出都是現有 CSS Token 的 HSL 三元組字串（例如 `217 91% 52%`），
 * UI 直接套用同一組變數，不在元件內各自計算顏色。
 * 對比度以 WCAG 2.2 相對亮度公式計算，衍生時即調整明度避免不合格組合。
 */

export type ThemePaletteMode = 'light' | 'dark'

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

export interface ThemePaletteState {
  /** 目前預覽／套用的 Base Color；null 表示沿用既有六組主題。 */
  baseColor: string | null
  /** 上次儲存的 Base Color；null 表示尚未儲存自訂主題。 */
  savedBaseColor: string | null
  /** 鎖定後「隨機」不得改動目前 Base Color。 */
  locked: boolean
}

export const THEME_PALETTE_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--border-strong',
  '--input',
  '--ring',
  '--brand',
] as const

export type ThemePaletteToken = typeof THEME_PALETTE_TOKENS[number]
export type ThemePalette = Record<ThemePaletteToken, string>

export const DEFAULT_THEME_BASE_COLOR = '#2f6fed'

export const EMPTY_THEME_PALETTE: ThemePaletteState = {
  baseColor: null,
  savedBaseColor: null,
  locked: false,
}

/** WCAG 2.2 AA：一般文字 4.5:1、大型文字與必要 UI 元件 3:1。 */
export const AA_TEXT_CONTRAST = 4.5
export const AA_UI_CONTRAST = 3

const HEX_PATTERN = /^#?([\da-f]{3}|[\da-f]{6})$/i
const WHITE: Hsl = { h: 0, s: 0, l: 100 }
const INK: Hsl = { h: 0, s: 0, l: 7 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hsl(h: number, s: number, l: number): Hsl {
  const hue = ((Math.round(h) % 360) + 360) % 360
  return {
    h: hue,
    s: Math.round(clamp(s, 0, 100)),
    l: Math.round(clamp(l, 0, 100)),
  }
}

/** 補上 `#` 並展開三位簡寫；無效輸入回傳 null。 */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string')
    return null
  const match = HEX_PATTERN.exec(input.trim())
  if (!match)
    return null
  const raw = match[1].toLowerCase()
  const full = raw.length === 3
    ? raw.split('').map(char => char + char).join('')
    : raw
  return `#${full}`
}

export function isHexColor(input: unknown): boolean {
  return normalizeHexColor(input) !== null
}

export function hexToRgb(input: string): Rgb | null {
  const normalized = normalizeHexColor(input)
  if (!normalized)
    return null
  const value = Number.parseInt(normalized.slice(1), 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0'))
    .join('')}`
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0)
    return hsl(0, 0, l * 100)
  const s = delta / (1 - Math.abs(2 * l - 1))
  let hue: number
  if (max === rn)
    hue = ((gn - bn) / delta) % 6
  else if (max === gn)
    hue = (bn - rn) / delta + 2
  else
    hue = (rn - gn) / delta + 4
  return hsl(hue * 60, s * 100, l * 100)
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const lightness = clamp(l, 0, 100) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = lightness - chroma / 2
  let rp = 0
  let gp = 0
  let bp = 0
  if (hue < 60)
    [rp, gp, bp] = [chroma, x, 0]
  else if (hue < 120)
    [rp, gp, bp] = [x, chroma, 0]
  else if (hue < 180)
    [rp, gp, bp] = [0, chroma, x]
  else if (hue < 240)
    [rp, gp, bp] = [0, x, chroma]
  else if (hue < 300)
    [rp, gp, bp] = [x, 0, chroma]
  else
    [rp, gp, bp] = [chroma, 0, x]
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  }
}

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.2 相對亮度。 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r)
    + 0.7152 * channelLuminance(g)
    + 0.0722 * channelLuminance(b)
}

/** WCAG 2.2 對比度，範圍 1–21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

function hslContrast(a: Hsl, b: Hsl): number {
  return contrastRatio(hslToRgb(a), hslToRgb(b))
}

/**
 * 固定色相與飽和度，逐級調整明度直到達到目標對比。
 * 邊界仍不足時退回黑或白，保證至少一方可達 4.5:1。
 */
function ensureContrast(
  color: Hsl,
  against: Hsl,
  target: number,
  direction: 1 | -1,
): Hsl {
  let result = color
  for (let step = 0; step < 100; step += 1) {
    if (hslContrast(result, against) >= target)
      return result
    const nextLightness = result.l + direction
    if (nextLightness < 0 || nextLightness > 100)
      break
    result = { ...result, l: nextLightness }
  }
  if (hslContrast(result, against) >= target)
    return result
  return hslContrast(INK, against) >= hslContrast(WHITE, against) ? INK : WHITE
}

/**
 * 對多個實際表面（例如 `--background` 與 `--card`）同時保證對比。
 * 逐一調整可能讓先前的表面掉回門檻以下，因此重複直到全部達標。
 */
function ensureContrastOnSurfaces(
  color: Hsl,
  surfaces: Hsl[],
  target: number,
  direction: 1 | -1,
): Hsl {
  let result = color
  for (let pass = 0; pass < 10; pass += 1) {
    const failing = surfaces.find(surface => hslContrast(result, surface) < target)
    if (!failing)
      return result
    result = ensureContrast(result, failing, target, direction)
  }
  return result
}

/** 產生主色與其前景色，兩者對比至少 4.5:1。 */
function readablePair(base: Hsl): { color: Hsl, foreground: Hsl } {
  const foreground = hslContrast(base, INK) >= hslContrast(base, WHITE) ? INK : WHITE
  const color = ensureContrast(
    base,
    foreground,
    AA_TEXT_CONTRAST,
    foreground === WHITE ? -1 : 1,
  )
  return { color, foreground }
}

function css({ h, s, l }: Hsl): string {
  return `${h} ${s}% ${l}%`
}

function deriveLightPalette(hue: number, saturation: number): ThemePalette {
  const background = hsl(hue, saturation * 0.28, 96)
  const foreground = ensureContrast(
    hsl(hue, saturation * 0.35, 12),
    background,
    AA_TEXT_CONTRAST,
    -1,
  )
  const card = hsl(hue, saturation * 0.12, 99)
  const cardForeground = ensureContrast(foreground, card, AA_TEXT_CONTRAST, -1)
  const primary = readablePair(hsl(hue, clamp(saturation, 12, 90), 46))
  const secondary = hsl(hue, saturation * 0.22, 90)
  const secondaryForeground = ensureContrast(
    hsl(hue, saturation * 0.3, 16),
    secondary,
    AA_TEXT_CONTRAST,
    -1,
  )
  const muted = hsl(hue, saturation * 0.2, 92)
  const mutedForeground = ensureContrast(
    ensureContrast(hsl(hue, saturation * 0.25, 42), background, AA_TEXT_CONTRAST, -1),
    muted,
    AA_TEXT_CONTRAST,
    -1,
  )
  const accent = hsl(hue, saturation * 0.42, 88)
  const accentForeground = ensureContrast(
    hsl(hue, saturation * 0.45, 26),
    accent,
    AA_TEXT_CONTRAST,
    -1,
  )
  const input = ensureContrast(
    hsl(hue, saturation * 0.16, 80),
    background,
    AA_UI_CONTRAST,
    -1,
  )
  const border = hsl(hue, saturation * 0.16, 84)
  const borderStrong = ensureContrastOnSurfaces(border, [background, card], AA_UI_CONTRAST, -1)
  const ring = ensureContrast(primary.color, background, AA_UI_CONTRAST, -1)

  return {
    '--background': css(background),
    '--foreground': css(foreground),
    '--card': css(card),
    '--card-foreground': css(cardForeground),
    '--popover': css(card),
    '--popover-foreground': css(cardForeground),
    '--primary': css(primary.color),
    '--primary-foreground': css(primary.foreground),
    '--secondary': css(secondary),
    '--secondary-foreground': css(secondaryForeground),
    '--muted': css(muted),
    '--muted-foreground': css(mutedForeground),
    '--accent': css(accent),
    '--accent-foreground': css(accentForeground),
    '--border': css(hsl(hue, saturation * 0.16, 84)),
    '--border-strong': css(borderStrong),
    '--input': css(input),
    '--ring': css(ring),
    '--brand': css(ring),
  }
}

function deriveDarkPalette(hue: number, saturation: number): ThemePalette {
  const background = hsl(hue, saturation * 0.22, 12)
  const foreground = ensureContrast(
    hsl(hue, saturation * 0.3, 94),
    background,
    AA_TEXT_CONTRAST,
    1,
  )
  const card = hsl(hue, saturation * 0.18, 10)
  const cardForeground = ensureContrast(foreground, card, AA_TEXT_CONTRAST, 1)
  const primary = readablePair(hsl(hue, clamp(saturation, 12, 90), 66))
  const secondary = hsl(hue, saturation * 0.18, 16)
  const secondaryForeground = ensureContrast(
    foreground,
    secondary,
    AA_TEXT_CONTRAST,
    1,
  )
  const muted = hsl(hue, saturation * 0.18, 16)
  const mutedForeground = ensureContrast(
    ensureContrast(hsl(hue, saturation * 0.2, 68), background, AA_TEXT_CONTRAST, 1),
    muted,
    AA_TEXT_CONTRAST,
    1,
  )
  const accent = hsl(hue, saturation * 0.2, 18)
  const accentForeground = ensureContrast(
    hsl(hue, saturation * 0.25, 92),
    accent,
    AA_TEXT_CONTRAST,
    1,
  )
  const input = ensureContrast(
    hsl(hue, saturation * 0.16, 26),
    background,
    AA_UI_CONTRAST,
    1,
  )
  const border = hsl(hue, saturation * 0.16, 20)
  const borderStrong = ensureContrastOnSurfaces(border, [background, card], AA_UI_CONTRAST, 1)
  const ring = ensureContrast(primary.color, background, AA_UI_CONTRAST, 1)

  return {
    '--background': css(background),
    '--foreground': css(foreground),
    '--card': css(card),
    '--card-foreground': css(cardForeground),
    '--popover': css(card),
    '--popover-foreground': css(cardForeground),
    '--primary': css(primary.color),
    '--primary-foreground': css(primary.foreground),
    '--secondary': css(secondary),
    '--secondary-foreground': css(secondaryForeground),
    '--muted': css(muted),
    '--muted-foreground': css(mutedForeground),
    '--accent': css(accent),
    '--accent-foreground': css(accentForeground),
    '--border': css(hsl(hue, saturation * 0.16, 20)),
    '--border-strong': css(borderStrong),
    '--input': css(input),
    '--ring': css(ring),
    '--brand': css(ring),
  }
}

/**
 * 由 Base Color 衍生整套配色。相同輸入與模式永遠得到相同結果；
 * 無效輸入回傳 null，呼叫端應維持既有主題。
 */
export function deriveThemePalette(
  baseColor: string,
  mode: ThemePaletteMode,
): ThemePalette | null {
  const rgb = hexToRgb(baseColor)
  if (!rgb)
    return null
  const { h, s } = rgbToHsl(rgb)
  return mode === 'dark'
    ? deriveDarkPalette(h, s)
    : deriveLightPalette(h, s)
}

/**
 * 產生合法的隨機 Base Color。傳入自訂亂數函式可得到確定性結果，供測試使用。
 */
export function randomBaseColor(random: () => number = Math.random): string {
  const hue = Math.floor(random() * 360)
  const saturation = 55 + Math.floor(random() * 35)
  const lightness = 40 + Math.floor(random() * 16)
  return rgbToHex(hslToRgb(hsl(hue, saturation, lightness)))
}

/** 讀取自儲存資料時的安全正規化；任何異常形狀都回到預設狀態。 */
export function normalizeThemePalette(value: unknown): ThemePaletteState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...EMPTY_THEME_PALETTE }
  const record = value as Record<string, unknown>
  const savedBaseColor = normalizeHexColor(record.savedBaseColor)
  const baseColor = normalizeHexColor(record.baseColor) ?? savedBaseColor
  return {
    baseColor,
    savedBaseColor,
    locked: record.locked === true,
  }
}
