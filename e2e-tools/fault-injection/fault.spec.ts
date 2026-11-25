import { expect, test } from '@playwright/test'

// 這個檔案只在故障注入時執行（不屬於正式 e2e testDir）。
test('fails immediately so its evidence must be persisted', async () => {
  expect(1).toBe(2)
})

test('keeps running so the runner can kill the process mid-run', async () => {
  await new Promise(resolve => setTimeout(resolve, 90_000))
})
