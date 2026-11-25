import { test } from '@playwright/test'

/**
 * 一般測試產物一律寫入本輪 testInfo 的獨立輸出目錄（outputDir 之下），
 * 不得寫入固定的 test-results 路徑，以免覆寫既有歷史證據。
 */
export function artifactPath(...segments: string[]) {
  return test.info().outputPath(...segments)
}
