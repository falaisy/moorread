import type { ThemePaletteState } from './palette'
import type { StoragePort } from './storage-port'
import { normalizeThemePalette } from './palette'
import { createStoragePort } from './storage-port'

/**
 * 主題配色只存在 `chrome.storage.local`：整套配色與衍生結果不進 sync 配額，
 * 也不與 `moorread:settings` 混在一起。
 */
export const THEME_PALETTE_STORAGE_KEY = 'moorread:theme-palette'

export const themePaletteStorage = createStoragePort('local')

/**
 * 讀取已存主題；讀取失敗或形狀異常時回退預設（不影響書籤等必要資料）。
 */
export async function readThemePalette(
  port: StoragePort = themePaletteStorage,
): Promise<ThemePaletteState> {
  try {
    return normalizeThemePalette(await port.get(THEME_PALETTE_STORAGE_KEY))
  }
  catch {
    return normalizeThemePalette(undefined)
  }
}

/** 寫入主題；失敗時向上拋出，呼叫端不得顯示成已儲存。 */
export async function writeThemePalette(
  state: ThemePaletteState,
  port: StoragePort = themePaletteStorage,
): Promise<void> {
  await port.set(THEME_PALETTE_STORAGE_KEY, state)
}

/** 清除自訂主題；失敗時向上拋出。 */
export async function clearThemePalette(
  port: StoragePort = themePaletteStorage,
): Promise<void> {
  await port.remove(THEME_PALETTE_STORAGE_KEY)
}
