import { runLegacyStorageMigration } from './migrate-yunji-storage'

/**
 * 「舊資料搬完之前不要寫 `keep-new` 目標鍵」的共同入口。
 *
 * 背景 service worker 沒有 `useNavStore.init()`，書籤事件與自動備份會在
 * SW 啟動時就生效；若它們搶在 `runLegacyStorageMigration()` 之前建立／覆寫
 * 目標鍵，遷移會誤判「新資料優先」（`keep-new`）而跳過 `yunji-tab:*` 的舊資料
 * （垃圾桶／歷史／WebDAV 狀態）。
 *
 * 因此把順序保證放在唯一的寫入入口，而不是散在各呼叫端：
 * - 同一 context 內單飛，避免事件暴發時重複跑遷移；
 * - 成功（含 already-migrated / nothing-to-migrate）後快取為 ready；
 * - 失敗不快取，下一次呼叫會重試，不會因為一次失敗就永久跳過。
 */
let inFlight: Promise<boolean> | null = null
let ready = false

export function legacyMigrationReady(): Promise<boolean> {
  if (ready)
    return Promise.resolve(true)
  if (inFlight)
    return inFlight
  const task = runLegacyStorageMigration()
    .then((result) => {
      const migrated = result.status === 'migrated'
        || result.status === 'already-migrated'
        || result.status === 'nothing-to-migrate'
      if (migrated)
        ready = true
      return migrated
    })
    // 取鎖失敗／storage 不可用：回報未就緒，下次再試。
    .catch(() => false)
  inFlight = task
  void task.then(() => {
    if (inFlight === task)
      inFlight = null
  })
  return task
}

/** 僅供測試：清掉快取與單飛狀態，讓每個測試從乾淨的 gate 開始。 */
export function resetLegacyMigrationGateState(): void {
  ready = false
  inFlight = null
}
