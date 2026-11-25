import type { Page } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { aiPermissionGranted, grantAiEndpointPermission } from './support/ai-permission'

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
}

async function openAiConfiguration(page: Page, baseUrl: string, token = 'e2e-token', model = 'e2e-model') {
  await openSettings(page)
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  const configurationTrigger = page.getByRole('button', { name: /OpenAI 相容設定/ })
  if (!(await page.getByLabel('Base URL').isVisible()))
    await configurationTrigger.click()
  await page.getByLabel('Base URL').fill(baseUrl)
  await page.getByRole('textbox', { name: 'Token', exact: true }).fill(token)
  await page.getByLabel('模型').fill(model)
}

// 每次新執行都要在獨立同意視窗按下明確同意，才會送出書籤資料。
async function agreeClassificationTransfer(page: Page) {
  await expect(
    page.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '同意並送出' }).click()
}

// 讓頁面端的權限 API 回傳指定結果；只影響測試頁面，不改產品程式。
async function stubPermissionApi(
  page: Page,
  options: { request: 'denied' | 'pending' },
) {
  await page.addInitScript((mode) => {
    const deny = async () => false
    const pending = () => new Promise<boolean>(() => {})
    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value: async () => false,
    })
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: mode === 'denied' ? deny : pending,
    })
  }, options.request)
}

test('previews AI classification before moving a bookmark', async ({
  extensionWorker,
  newTabPage,
}) => {
  const seeded = await extensionWorker.evaluate(async () => {
    const source = await chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Source',
    })
    const target = await chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Target',
    })
    const bookmark = await chrome.bookmarks.create({
      parentId: source.id,
      title: 'AI Preview Bookmark',
      url: 'https://ai-preview.example/docs?private=value',
    })
    return {
      sourceId: source.id,
      targetId: target.id,
      bookmarkId: bookmark.id,
    }
  })
  await newTabPage.reload()
  let classificationRequestCount = 0
  await newTabPage.route(
    'https://www.google.com/v1/chat/completions',
    async (route) => {
      classificationRequestCount += 1
      if (classificationRequestCount === 1) {
        await route.fulfill({ status: 401, body: 'invalid token' })
        return
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    bookmarkId: `bm-${seeded.bookmarkId}`,
                    targetCategoryId: `cat-${seeded.targetId}`,
                    confidence: 0.94,
                    reason: 'Matches the target folder',
                  },
                ]),
              },
            },
          ],
        }),
      })
    },
  )
  await newTabPage.route('https://www.google.com/v1/models', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'e2e-model' }] }),
    })
  })

  await openSettings(newTabPage)
  await newTabPage.getByRole('tab', { name: 'AI', exact: true }).click()
  const classificationTop = await newTabPage
    .getByRole('heading', {
      name: '智慧分類',
      exact: true,
    })
    .evaluate(element => element.getBoundingClientRect().top)
  const configurationTrigger = newTabPage.getByRole('button', {
    name: /OpenAI 相容設定/,
  })
  const providerTop = await configurationTrigger.evaluate(
    element => element.getBoundingClientRect().top,
  )
  expect(classificationTop).toBeLessThan(providerTop)
  await expect(newTabPage.getByLabel('Base URL')).not.toBeVisible()
  await configurationTrigger.click()
  await expect(newTabPage.getByLabel('Base URL')).toBeVisible()
  await expect(newTabPage.getByLabel('每批書籤數')).toHaveValue('80')
  await newTabPage.getByLabel('Base URL').fill('https://www.google.com/v1')
  await newTabPage
    .getByRole('textbox', { name: 'Token', exact: true })
    .fill('e2e-token')
  await newTabPage.getByLabel('模型').fill('e2e-model')
  // 未封裝擴充在此 harness 的全新 profile 就已具備可選主機權限（實測 contains 為 true），
  // 因此無法在此環境演練「手勢授予」本身；仍先確認狀態，未授予就立即失敗。
  const permissionBeforeGesture = await aiPermissionGranted(
    extensionWorker,
    'https://www.google.com/v1',
  )
  console.log(`[e2e] ai endpoint permission before gesture: ${permissionBeforeGesture}`)
  await grantAiEndpointPermission(
    newTabPage,
    extensionWorker,
    'https://www.google.com/v1',
  )
  expect(
    await aiPermissionGranted(extensionWorker, 'https://www.google.com/v1'),
  ).toBe(true)
  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await agreeClassificationTransfer(newTabPage)

  const requestError = newTabPage.getByText(
    'AI 請求失敗，請檢查位址、Token、模型和服務相容性。',
    { exact: true },
  )
  await expect(requestError).toBeVisible()
  const generateButtonBottom = await newTabPage
    .getByRole('button', {
      name: '產生分類預覽',
    })
    .evaluate(element => element.getBoundingClientRect().bottom)
  const errorTop = await requestError.evaluate(
    element => element.getBoundingClientRect().top,
  )
  expect(errorTop).toBeGreaterThanOrEqual(generateButtonBottom)

  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await agreeClassificationTransfer(newTabPage)

  await expect(
    newTabPage.getByRole('heading', { name: '智慧分類預覽' }),
  ).toBeVisible()
  await expect(newTabPage.getByText('AI Source / AI Target')).toHaveCount(0)
  expect(
    await extensionWorker.evaluate(
      async bookmarkId =>
        (await chrome.bookmarks.get(bookmarkId))[0].parentId,
      seeded.bookmarkId,
    ),
  ).toBe(seeded.sourceId)

  await newTabPage.getByRole('button', { name: '取消' }).click()
  expect(
    await extensionWorker.evaluate(
      async bookmarkId =>
        (await chrome.bookmarks.get(bookmarkId))[0].parentId,
      seeded.bookmarkId,
    ),
  ).toBe(seeded.sourceId)

  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await agreeClassificationTransfer(newTabPage)
  await newTabPage.getByRole('button', { name: '確認移動' }).click()
  await expect
    .poll(() =>
      extensionWorker.evaluate(
        async bookmarkId =>
          (await chrome.bookmarks.get(bookmarkId))[0].parentId,
        seeded.bookmarkId,
      ),
    )
    .toBe(seeded.targetId)
  await expect(
    newTabPage.getByRole('button', { name: '撤銷智慧分類' }),
  ).toBeVisible()

  const syncStorage = await extensionWorker.evaluate(async () =>
    chrome.storage.sync.get(null),
  )
  expect(JSON.stringify(syncStorage)).not.toContain('e2e-token')
})

test('keeps values typed while AI settings are still loading', async ({
  newTabPage,
}) => {
  // 讓 storage 讀取延遲，重現「使用者先輸入、載入後才回來」的競態。
  await newTabPage.addInitScript(() => {
    const flag = () => {
      const target = window as unknown as Record<string, unknown>
      target.__aiSlowLoadSeen = true
    }
    const wrap = (area?: chrome.storage.StorageArea) => {
      if (!area || typeof area.get !== 'function')
        return
      const original = area.get.bind(area)
      area.get = (async (...args: Parameters<typeof original>) => {
        flag()
        await new Promise(resolve => setTimeout(resolve, 1_200))
        return original(...args)
      }) as typeof area.get
    }
    try {
      const scoped = globalThis as unknown as {
        browser?: { storage?: { sync?: chrome.storage.StorageArea, local?: chrome.storage.StorageArea } }
      }
      wrap(scoped.browser?.storage?.sync)
      wrap(scoped.browser?.storage?.local)
    }
    catch {}
    try {
      wrap(chrome.storage.sync)
      wrap(chrome.storage.local)
    }
    catch {}
  })
  await newTabPage.reload()
  await openSettings(newTabPage)
  await newTabPage.getByRole('tab', { name: 'AI', exact: true }).click()
  await newTabPage.getByRole('button', { name: /OpenAI 相容設定/ }).click()
  await newTabPage.getByLabel('Base URL').fill('https://www.google.com/v1')
  await newTabPage
    .getByRole('textbox', { name: 'Token', exact: true })
    .fill('typed-token')
  await newTabPage.getByLabel('模型').fill('typed-model')

  await expect
    .poll(() =>
      newTabPage.evaluate(
        () => Boolean((window as unknown as Record<string, unknown>).__aiSlowLoadSeen),
      ),
    )
    .toBe(true)
  // 等待延遲載入確實完成，再確認輸入沒有被預設值覆蓋。
  await newTabPage.waitForTimeout(2_000)
  await expect(newTabPage.getByLabel('Base URL')).toHaveValue(
    'https://www.google.com/v1',
  )
  await expect(
    newTabPage.getByRole('textbox', { name: 'Token', exact: true }),
  ).toHaveValue('typed-token')
  await expect(newTabPage.getByLabel('模型')).toHaveValue('typed-model')
})

test('shows a permission message and sends no request when access is denied', async ({

  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Denied Bookmark',
      url: 'https://ai-denied.example/docs',
    }),
  )
  await stubPermissionApi(newTabPage, { request: 'denied' })
  await newTabPage.reload()
  let requestCount = 0
  await newTabPage.route(
    'https://www.google.com/v1/chat/completions',
    async (route) => {
      requestCount += 1
      await route.fulfill({ status: 200, body: '{}' })
    },
  )
  await openAiConfiguration(newTabPage, 'https://www.google.com/v1')
  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await agreeClassificationTransfer(newTabPage)

  await expect(
    newTabPage.getByText('未獲得此服務位址的存取權限。', { exact: true }),
  ).toBeVisible()
  expect(requestCount).toBe(0)
})

test('reports a permission timeout, sends no request and restores the UI', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Timeout Bookmark',
      url: 'https://ai-timeout.example/docs',
    }),
  )
  await stubPermissionApi(newTabPage, { request: 'pending' })
  await newTabPage.reload()
  let requestCount = 0
  await newTabPage.route(
    'https://www.google.com/v1/chat/completions',
    async (route) => {
      requestCount += 1
      await route.fulfill({ status: 200, body: '{}' })
    },
  )
  await openAiConfiguration(newTabPage, 'https://www.google.com/v1')
  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await agreeClassificationTransfer(newTabPage)

  // 等待產品自己的 10 秒權限逾時訊息，而不是延長斷言等待。
  await expect(
    newTabPage.getByText(
      '瀏覽器在時限內未回應權限請求，未傳送任何內容到 AI 服務。',
      { exact: true },
    ),
  ).toBeVisible({ timeout: 20_000 })
  expect(requestCount).toBe(0)
  await expect(
    newTabPage.getByRole('button', { name: '產生分類預覽' }),
  ).toBeEnabled()
  await expect(
    newTabPage.getByText(
      'AI 請求失敗，請檢查位址、Token、模型和服務相容性。',
      { exact: true },
    ),
  ).toHaveCount(0)
})

test('shows the full disclosure and sends nothing when consent is cancelled', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Consent Cancel',
      url: 'https://ai-consent-cancel.example/docs?secret=1',
    }),
  )
  await newTabPage.reload()
  let requestCount = 0
  await newTabPage.route(
    'https://www.google.com/v1/chat/completions',
    async (route) => {
      requestCount += 1
      await route.fulfill({ status: 200, body: '{}' })
    },
  )
  await openAiConfiguration(newTabPage, 'https://www.google.com/v1')
  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()

  await expect(
    newTabPage.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()
  await expect(newTabPage.getByText('目的地：你設定的 AI 服務 www.google.com。')).toBeVisible()
  await expect(newTabPage.getByText('書籤內部識別碼（bookmarkId）')).toBeVisible()
  await expect(newTabPage.getByText('完整資料夾清單（資料夾 ID 與路徑）')).toBeVisible()
  await expect(newTabPage.getByText('你設定的分類提示詞（prompt）')).toBeVisible()
  await expect(
    newTabPage.getByText('不會送出：瀏覽記錄、開啟次數、分頁、垃圾桶與操作歷史。'),
  ).toBeVisible()
  await expect(
    newTabPage.getByText('若請求暫時失敗，同一次執行內最多自動重試 2 次，送出內容相同。'),
  ).toBeVisible()

  await newTabPage.getByRole('button', { name: '取消' }).click()
  await expect(
    newTabPage.getByText('已取消，未送出任何資料。', { exact: true }),
  ).toBeVisible()
  expect(requestCount).toBe(0)
})

test('sends nothing when the consent dialog is dismissed with Escape', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'AI Consent Escape',
      url: 'https://ai-consent-escape.example/docs',
    }),
  )
  await newTabPage.reload()
  let requestCount = 0
  await newTabPage.route(
    'https://www.google.com/v1/chat/completions',
    async (route) => {
      requestCount += 1
      await route.fulfill({ status: 200, body: '{}' })
    },
  )
  await openAiConfiguration(newTabPage, 'https://www.google.com/v1')
  await newTabPage.getByRole('button', { name: '產生分類預覽' }).click()
  await expect(
    newTabPage.getByRole('heading', { name: '傳送書籤資料給 AI 服務前請確認' }),
  ).toBeVisible()

  await newTabPage.keyboard.press('Escape')
  await expect(
    newTabPage.getByRole('button', { name: '同意並送出' }),
  ).toHaveCount(0)
  expect(requestCount).toBe(0)
})
