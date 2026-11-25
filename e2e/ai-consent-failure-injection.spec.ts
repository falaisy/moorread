import type { Page, Worker } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { grantAiEndpointPermission } from './support/ai-permission'

const BASE_URL = 'https://www.google.com/v1'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
}

async function openAiConfiguration(page: Page) {
  await openSettings(page)
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  const configurationTrigger = page.getByRole('button', {
    name: /OpenAI 相容設定/,
  })
  if (!(await page.getByLabel('Base URL').isVisible()))
    await configurationTrigger.click()
  await page.getByLabel('Base URL').fill(BASE_URL)
  await page.getByRole('textbox', { name: 'Token', exact: true }).fill('e2e-token')
  await page.getByLabel('模型').fill('e2e-model')
}

async function prepareAiPage(
  extensionWorker: Worker,
  newTabPage: Page,
) {
  await extensionWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'AI consent failure injection',
      url: 'https://ai-consent-failure.example/docs?secret=1',
    }),
  )
  await newTabPage.reload()
  await openAiConfiguration(newTabPage)
  await grantAiEndpointPermission(newTabPage, extensionWorker, BASE_URL)
}

function countChatRequests(page: Page) {
  let requestCount = 0
  page.route(`${BASE_URL}/chat/completions`, async (route) => {
    requestCount += 1
    await route.fulfill({ status: 200, body: '{}' })
  })
  return () => requestCount
}

test('sends nothing when the mounted consent dialog disappears before consent', async ({
  extensionWorker,
  newTabPage,
}) => {
  await prepareAiPage(extensionWorker, newTabPage)
  const requests = countChatRequests(newTabPage)

  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await expect(
    newTabPage.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()
  await newTabPage.evaluate(() => {
    document.querySelector('[role="alertdialog"]')?.remove()
  })

  await newTabPage.waitForTimeout(1_500)
  expect(requests()).toBe(0)
  await expect(
    newTabPage.locator('[role="alertdialog"]'),
  ).toHaveCount(0)
  // 沒有退回舊的直接分類流程：同意入口仍在，且沒有開始任何進度。
  expect(
    await newTabPage.evaluate(() =>
      document.body.textContent?.includes('產生分類預覽'),
    ),
  ).toBe(true)
  await expect(
    newTabPage.getByRole('progressbar'),
  ).toHaveCount(0)
})

test('sends nothing when the consent callback never runs', async ({
  extensionWorker,
  newTabPage,
}) => {
  await prepareAiPage(extensionWorker, newTabPage)
  const requests = countChatRequests(newTabPage)

  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await expect(
    newTabPage.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()

  // 移除 React 對該節點的事件處理後再點擊：等同同意 callback 未執行。
  await newTabPage.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(item =>
      item.textContent?.includes('同意並送出'),
    )
    if (!button)
      throw new Error('consent button not found')
    button.replaceWith(button.cloneNode(true))
  })
  await newTabPage.getByRole('button', { name: '同意並送出' }).click()

  await newTabPage.waitForTimeout(1_500)
  expect(requests()).toBe(0)
  await expect(
    newTabPage.getByRole('progressbar'),
  ).toHaveCount(0)
})

test('sends nothing and shows an error when establishing consent throws', async ({
  extensionWorker,
  newTabPage,
}) => {
  await newTabPage.addInitScript(() => {
    const prototype = window.Crypto?.prototype
    const original = prototype?.randomUUID
    if (prototype && original) {
      prototype.randomUUID = function randomUUID(this: Crypto) {
        if ((window as unknown as { __failConsent?: boolean }).__failConsent)
          throw new Error('injected consent failure')
        return original.call(this)
      }
    }
  })
  await prepareAiPage(extensionWorker, newTabPage)
  const requests = countChatRequests(newTabPage)

  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await expect(
    newTabPage.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()

  await newTabPage.evaluate(() => {
    (window as unknown as { __failConsent?: boolean }).__failConsent = true
  })
  await newTabPage.getByRole('button', { name: '同意並送出' }).click()

  await expect(
    newTabPage.getByText(
      'AI 請求失敗，請檢查位址、Token、模型和服務相容性。',
      { exact: true },
    ),
  ).toBeVisible()
  await newTabPage.waitForTimeout(1_000)
  expect(requests()).toBe(0)
  await expect(newTabPage.getByRole('progressbar')).toHaveCount(0)
  await expect(
    newTabPage.getByRole('button', { name: '產生分類預覽' }),
  ).toBeVisible()
})
