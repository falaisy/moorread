import type { ThemeMode } from './types'
import { deriveThemePalette, normalizeHexColor } from './palette'

/**
 * 主題首次繪製快取。
 *
 * `chrome.storage.sync` 只能非同步讀取，React 首次繪製前拿不到使用者設定，
 * 因此把「上次實際套用的結果」同步存在 localStorage，讓頁面載入時可先套用，
 * 避免先畫出整頁淺色 UI 再轉成深色。localStorage 只是快取的鏡像，
 * 設定的唯一真相來源仍是 `chrome.storage.sync` 的 `moorread:settings`。
 */
const THEME_CACHE_KEY = 'moorread:theme'

/**
 * 自訂配色的首繪快取：只快取已正式儲存的 Base Color，
 * 真正的配色仍由 `palette.ts` 依當下明暗模式重新衍生。
 */
const PALETTE_CACHE_KEY = 'moorread:theme-palette-cache'
const PALETTE_CACHE_VERSION = 1

export type ResolvedTheme = 'light' | 'dark'

export function readCachedTheme(): ResolvedTheme | null {
  try {
    const value = globalThis.localStorage?.getItem(THEME_CACHE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  }
  catch {
    return null
  }
}

export function writeCachedTheme(resolved: ResolvedTheme) {
  try {
    globalThis.localStorage?.setItem(THEME_CACHE_KEY, resolved)
  }
  catch {
    // localStorage 不可用時放棄快取；主題仍會由設定載入後套用。
  }
}

export function resolveTheme(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  return theme === 'dark' || (theme === 'system' && prefersDark)
    ? 'dark'
    : 'light'
}

/** 同時更新 `<html>` 的 `dark` class、`color-scheme` 與同步快取。 */
export function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.setProperty('color-scheme', resolved)
  writeCachedTheme(resolved)
}

/**
 * 讀取自訂配色快取；格式錯誤、版本不符或顏色無效時回傳 null，
 * 讓首繪安全回退既有預設主題。
 */
export function readCachedPaletteBaseColor(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(PALETTE_CACHE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as { v?: unknown, baseColor?: unknown }
    if (!parsed || parsed.v !== PALETTE_CACHE_VERSION)
      return null
    return normalizeHexColor(parsed.baseColor)
  }
  catch {
    return null
  }
}

/**
 * 更新自訂配色快取。僅能在正式儲存成功或正式狀態確定後呼叫；
 * 傳入 null 會清除快取（還原預設、清除配色、重設設定）。
 */
export function writeCachedPaletteBaseColor(baseColor: string | null) {
  try {
    const normalized = normalizeHexColor(baseColor)
    if (!normalized) {
      globalThis.localStorage?.removeItem(PALETTE_CACHE_KEY)
      return
    }
    globalThis.localStorage?.setItem(
      PALETTE_CACHE_KEY,
      JSON.stringify({ v: PALETTE_CACHE_VERSION, baseColor: normalized }),
    )
  }
  catch {
    // 快取不可用時只影響下次首繪，正式設定仍以 chrome.storage.local 為準。
  }
}

/** 在首次繪製前把已儲存的自訂配色寫入既有 CSS Token。 */
function applyCachedPalette(resolved: ResolvedTheme) {
  const baseColor = readCachedPaletteBaseColor()
  if (!baseColor)
    return
  const palette = deriveThemePalette(baseColor, resolved)
  if (!palette)
    return
  const root = document.documentElement
  Object.entries(palette).forEach(([key, value]) =>
    root.style.setProperty(key, value),
  )
}

/**
 * 在 React 首次繪製前同步套用上次主題。
 * 沒有快取（例如第一次安裝）時退回系統偏好，與預設 `theme: 'system'` 一致。
 */
export function bootstrapTheme() {
  if (typeof window === 'undefined')
    return
  const cached = readCachedTheme()
  const resolved = cached
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  applyResolvedTheme(resolved)
  applyCachedPalette(resolved)
}
