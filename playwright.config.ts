import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 除錯用的驗證檔不屬於正式 E2E 清單，也不得混入正式 E2E 數量與結果。
  testIgnore: ['**/_verify-fix.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    // 失敗證據在 onTestEnd 當下即複製到本輪獨立目錄，行程被終止也不會遺失。
    ['./e2e/support/evidence-reporter.ts'],
  ],
  // 失敗證據（trace／截圖／影片）不得被下一次診斷重跑覆蓋。
  // 診斷重跑時設定此環境變數，把產物寫到另一個目錄；正式結果仍留在 test-results。
  // 一般測試產物與歷史證據目錄分離；證據只由明確指定的路徑輸出。
  outputDir: process.env.MOORREAD_E2E_OUTPUT_DIR || '.playwright-artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
