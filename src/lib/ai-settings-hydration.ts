import type { AiSettings } from './ai-settings'

export interface AiHydrationSnapshot {
  settings: AiSettings
  token: string
}

// 設定是非同步載入的：若使用者在載入完成前已經開始編輯，
// 較晚回來的預設值或已儲存值不得覆蓋使用者輸入。
export function resolveHydratedAiSettings(
  current: AiHydrationSnapshot,
  loaded: AiHydrationSnapshot,
  editedDuringLoad: boolean,
): AiHydrationSnapshot {
  return editedDuringLoad ? current : loaded
}
