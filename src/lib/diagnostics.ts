const LOG_PREFIX = '[moorread]'

/**
 * 擴充功能內沒有後端可收集錯誤，因此把「刻意降級但仍失敗」的原因留在
 * Service Worker 或頁面的 Console，事後才追得到是哪個環節退化。
 */
export function reportDiagnostic(scope: string, cause: unknown): void {
  if (typeof console === 'undefined')
    return
  console.error(`${LOG_PREFIX} ${scope}`, cause)
}

/**
 * 可預期的外部狀態（例如資料夾已被其他裝置刪除）不是錯誤，但若完全不記錄，
 * 使用者回報問題時會缺少線索，因此以 warn 等級留下。
 */
export function reportExpectedFallback(scope: string, cause: unknown): void {
  if (typeof console === 'undefined')
    return
  console.warn(`${LOG_PREFIX} ${scope}`, cause)
}
