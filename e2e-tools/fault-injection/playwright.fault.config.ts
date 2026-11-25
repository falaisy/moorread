import { defineConfig } from '@playwright/test'

// 故障注入用：故意產生一次失敗，再讓第二個測試長時間掛住，
// 由 runner 在執行中途強制終止，驗證失敗證據是否已即時落盤。
export default defineConfig({
  testDir: '.',
  testMatch: 'fault.spec.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['../../e2e/support/evidence-reporter.ts']],
  outputDir: process.env.MOORREAD_FAULT_OUTPUT_DIR || 'fault-output',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
