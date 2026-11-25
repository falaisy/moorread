import type { StateCreator } from 'zustand'
import type { ThemePaletteState } from './palette'
import type { NavState } from './store-types'
import {
  EMPTY_THEME_PALETTE,
  normalizeHexColor,
  randomBaseColor,
} from './palette'
import { writeCachedPaletteBaseColor } from './theme-boot'
import {
  clearThemePalette,
  writeThemePalette,
} from './theme-palette-storage'

export interface ThemePaletteSlice {
  /** 主題引擎狀態；baseColor 為 null 時沿用既有六組主題。 */
  themePalette: ThemePaletteState
  /** 微調／即時預覽：只改目前套用值，不動已儲存值。 */
  previewThemeBaseColor: (color: string) => void
  /** 隨機產生合法 Base Color；鎖定時不改動。 */
  randomizeThemeBaseColor: () => void
  setThemePaletteLocked: (locked: boolean) => void
  /** 寫入 chrome.storage.local；失敗時拋錯，呼叫端不得顯示成功。 */
  saveThemePalette: () => Promise<void>
  /** 還原上次儲存的主題；未曾儲存則回到既有六組主題。 */
  restoreThemePalette: () => void
  /** 清除自訂主題（供恢復外觀預設使用）。 */
  resetThemePalette: () => Promise<void>
}

export const createThemePaletteSlice: StateCreator<
  NavState,
  [],
  [],
  ThemePaletteSlice
> = (set, get) => ({
  themePalette: EMPTY_THEME_PALETTE,

  previewThemeBaseColor: (color) => {
    const baseColor = normalizeHexColor(color)
    if (!baseColor)
      return
    set({ themePalette: { ...get().themePalette, baseColor } })
  },

  randomizeThemeBaseColor: () => {
    const current = get().themePalette
    if (current.locked)
      return
    set({ themePalette: { ...current, baseColor: randomBaseColor() } })
  },

  setThemePaletteLocked: (locked) => {
    set({ themePalette: { ...get().themePalette, locked } })
  },

  saveThemePalette: async () => {
    const current = get().themePalette
    if (!current.baseColor)
      throw new Error('theme-palette.empty')
    const next: ThemePaletteState = {
      baseColor: current.baseColor,
      savedBaseColor: current.baseColor,
      locked: current.locked,
    }
    await writeThemePalette(next)
    set({ themePalette: next })
    // 正式儲存成功後才更新首繪快取；失敗時維持舊快取。
    writeCachedPaletteBaseColor(next.savedBaseColor)
  },

  restoreThemePalette: () => {
    const current = get().themePalette
    set({ themePalette: { ...current, baseColor: current.savedBaseColor } })
  },

  resetThemePalette: async () => {
    await clearThemePalette()
    set({ themePalette: { ...EMPTY_THEME_PALETTE } })
    writeCachedPaletteBaseColor(null)
  },
})
