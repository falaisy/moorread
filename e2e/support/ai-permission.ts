import type { Page, Worker } from '@playwright/test'
import { expect } from '../extension.fixture'

// 以真實使用者手勢（點「取得模型清單」）觸發可選主機權限，
// 並用 chrome.permissions.contains 驗證授予確實生效；未生效就立即失敗，
// 不讓後續斷言以「等不到錯誤訊息」的形式模糊收場。
export async function aiPermissionGranted(
  worker: Worker,
  baseUrl: string,
): Promise<boolean> {
  const origin = new URL(baseUrl).origin
  return worker.evaluate(
    pattern => chrome.permissions.contains({ origins: [pattern] }),
    `${origin}/*`,
  )
}

export async function grantAiEndpointPermission(
  page: Page,
  worker: Worker,
  baseUrl: string,
): Promise<void> {
  if (await aiPermissionGranted(worker, baseUrl))
    return
  await page.getByRole('button', { name: '取得模型清單' }).click()
  try {
    await expect
      .poll(() => aiPermissionGranted(worker, baseUrl), { timeout: 5_000 })
      .toBe(true)
  }
  catch {
    throw new Error(
      'AI 端點權限未取得：chrome.permissions.contains 在 5 秒內未變成 true，停止後續斷言',
    )
  }
}
