import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from './extension.fixture'

/**
 * R-03 Inbox 儲存語意（spec v7.1 §8）。
 *
 * 透過真的把命令面板 iframe 注入到一個真實頁面，再用面板存檔，
 * 走完整 production 路徑（palette → background → chrome.bookmarks ＋ metadata），
 * 而不是直接呼叫內部函式。
 *
 * 目標頁使用 https://www.google.com/* （在 host_permissions 內，才能注入），
 * 內容由 Playwright route 直接 fulfill，不連外網。
 */

const SETTINGS_KEY = 'moorread:settings'
const META_KEY = 'moorread:meta'
const OPEN_FOR_TAB = 'moorread:global-palette-open-for-tab'
const BASE = 'https://www.google.com/moorread-e2e'

const PAGE_HTML = '<!doctype html><html><head><title>Palette Target</title></head><body><h1>Target</h1></body></html>'

async function seedSettings(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async ({ key, next }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const current = raw ? JSON.parse(String(raw)) : {}
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...current, ...next }) })
  }, { key: SETTINGS_KEY, next: patch })
}

async function readSettings(page: Page) {
  return page.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    return raw ? JSON.parse(String(raw)) : null
  }, SETTINGS_KEY) as Promise<Record<string, unknown> | null>
}

async function readMeta(page: Page) {
  return page.evaluate(async (key) => {
    const raw = (await chrome.storage.local.get(key))[key]
    return raw ? JSON.parse(String(raw)) : {}
  }, META_KEY) as Promise<Record<string, { tags?: string[], description?: string, inboxAt?: number }>>
}

async function bookmarksFor(page: Page, url: string) {
  return page.evaluate(async (target) => {
    const nodes = await chrome.bookmarks.search({ url: target })
    return nodes.map(node => ({ id: node.id, parentId: node.parentId, url: node.url }))
  }, url) as Promise<{ id: string, parentId?: string, url?: string }[]>
}

async function openNewtab(context: BrowserContext, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

async function openCase(context: BrowserContext, extensionId: string, path: string) {
  const page = await context.newPage()
  await page.route('https://www.google.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: PAGE_HTML,
  }))
  const url = `${BASE}${path}`
  await page.goto(url)
  await page.waitForLoadState('domcontentloaded')
  return { page, url }
}

async function openPalette(context: BrowserContext, extensionId: string, page: Page, url: string): Promise<Frame> {
  const helper = await openNewtab(context, extensionId)
  try {
    await helper.evaluate(async ({ type, target }) => {
      const tabs = await chrome.tabs.query({})
      const match = tabs.find(item => item.url === target)
      if (!match?.id)
        throw new Error('target tab not found')
      await chrome.runtime.sendMessage({ type, tabId: match.id })
    }, { type: OPEN_FOR_TAB, target: url })
  }
  finally {
    await helper.close()
  }

  let frame: Frame | undefined
  await expect.poll(() => {
    frame = page.frames().find(candidate => candidate.url().includes('tabs/global-command-palette'))
    return Boolean(frame)
  }, { timeout: 20_000 }).toBe(true)
  return frame as Frame
}

function saveButton(frame: Frame) {
  return frame.getByRole('button', { name: 'Save current page' })
}

async function createCategory(control: Page, title: string) {
  return control.evaluate(async (name) => {
    const node = await chrome.bookmarks.create({ parentId: '1', title: name })
    return `cat-${node.id}`
  }, title) as Promise<string>
}

async function removeCategory(control: Page, categoryId: string) {
  try {
    await control.evaluate(async (id) => {
      await chrome.bookmarks.remove(id.replace(/^cat-/, ''))
    }, categoryId)
  }
  catch {}
}

async function seed(context: BrowserContext, extensionId: string, extra: Record<string, unknown> = {}) {
  const page = await openNewtab(context, extensionId)
  await seedSettings(page, { language: 'en', globalCommandPaletteEnabled: true, defaultCategoryId: 'cat-1', ...extra })
  return page
}

test.describe('palette inbox semantics', () => {
  test('A：未指定 → 進 Inbox 並標記 inboxAt', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId)
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/a')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await frame.getByLabel('Save to').selectOption('inbox')
      await saveButton(frame).click()
      await expect.poll(() => bookmarksFor(control, url)).toHaveLength(1)
      const [node] = await bookmarksFor(control, url)
      expect(node.parentId).toBe('1')
      expect(Boolean((await readMeta(control))[url]?.inboxAt)).toBe(true)
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('C：all ＋ 有效預設 cat-1 → 進書籤列、不得標記 inboxAt', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId)
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/c')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await frame.getByLabel('Save to').selectOption('all')
      await saveButton(frame).click()
      await expect.poll(() => bookmarksFor(control, url)).toHaveLength(1)
      const [node] = await bookmarksFor(control, url)
      expect(node.parentId).toBe('1')
      expect(Boolean((await readMeta(control))[url]?.inboxAt)).toBeFalsy()
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('D：all ＋ 無效預設 → 安全退回 Inbox 並標記', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'cat-999999' })
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/d')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await frame.getByLabel('Save to').selectOption('all')
      await saveButton(frame).click()
      await expect.poll(() => bookmarksFor(control, url)).toHaveLength(1)
      const [node] = await bookmarksFor(control, url)
      expect(node.parentId).toBe('1')
      expect(Boolean((await readMeta(control))[url]?.inboxAt)).toBe(true)
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('K：重複儲存只產生 1 個節點', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId)
    try {
      const first = await openCase(extensionContext, extensionId, '/k')
      const firstFrame = await openPalette(extensionContext, extensionId, first.page, first.url)
      await saveButton(firstFrame).click()
      await expect.poll(() => bookmarksFor(control, first.url)).toHaveLength(1)
      await first.page.close()

      // 第二次從全新的面板存同一個網址，走完整 duplicate 判斷
      const second = await openCase(extensionContext, extensionId, '/k')
      const secondFrame = await openPalette(extensionContext, extensionId, second.page, second.url)
      await saveButton(secondFrame).click()
      await second.page.waitForTimeout(1500)
      expect(await bookmarksFor(control, second.url)).toHaveLength(1)
      await second.page.close()
    }
    finally {
      await control.close()
    }
  })

  test('L：既有 metadata（tags／description）在存檔後保留', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId)
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/l')
      await control.evaluate(async ({ key, target }) => {
        const raw = (await chrome.storage.local.get(key))[key]
        const meta = raw ? JSON.parse(String(raw)) : {}
        meta[target] = { description: 'keep me', tags: ['keep'] }
        await chrome.storage.local.set({ [key]: JSON.stringify(meta) })
      }, { key: META_KEY, target: url })
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await saveButton(frame).click()
      await expect.poll(() => bookmarksFor(control, url)).toHaveLength(1)
      await expect.poll(async () => (await readMeta(control))[url]?.description).toBe('keep me')
      expect((await readMeta(control))[url]?.tags).toEqual(['keep'])
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('R7：命令面板選 inbox → 切換預設，正式預設值存成 inbox（不是 cat-1）', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'cat-1' })
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/r7')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await frame.getByLabel('Save to').selectOption('inbox')
      await frame.getByRole('button', { name: 'Switch default' }).click()
      await expect.poll(async () => (await readSettings(control))?.defaultCategoryId).toBe('inbox')
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('R7b：面板選 all 時星號停用，正式預設不變（inbox／cat-X 仍可用）', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'cat-1' })
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/r7b')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      const star = frame.getByRole('button', { name: 'Switch default' })
      await frame.getByLabel('Save to').selectOption('all')
      await expect(star).toBeDisabled()
      // 切回 inbox 後恢復可用，既有行為不變。
      await frame.getByLabel('Save to').selectOption('inbox')
      await expect(star).toBeEnabled()
      await frame.getByLabel('Save to').selectOption('all')
      await page.waitForTimeout(500)
      expect((await readSettings(control))?.defaultCategoryId).toBe('cat-1')
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('R7c：後端收到 categoryId=all 必須拒絕，不寫入正式預設', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'cat-1' })
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/r7c')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      const token = await frame.evaluate(() => decodeURIComponent(window.location.hash.slice(1)))
      // 走真正的 background 訊息處理器（sender tab 與 session 相符），只把 categoryId 換成 all。
      const response = await frame.evaluate(async ({ token, type }) => {
        return chrome.runtime.sendMessage({ type, token, categoryId: 'all' })
      }, { token, type: 'moorread:global-palette-switch-category' })
      expect(response).toEqual({ ok: false })
      expect((await readSettings(control))?.defaultCategoryId).toBe('cat-1')
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('R8a：正式預設 inbox → 面板初始選取 inbox', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'inbox' })
    try {
      const { page, url } = await openCase(extensionContext, extensionId, '/r8a')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await expect(frame.getByLabel('Save to')).toHaveValue('inbox')
      await page.close()
    }
    finally {
      await control.close()
    }
  })

  test('R8b：正式預設 cat-X → 面板初始選取該資料夾（不硬編碼 inbox）', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'inbox' })
    const categoryId = await createCategory(control, 'Initial Cat A')
    try {
      await seedSettings(control, { defaultCategoryId: categoryId })
      const { page, url } = await openCase(extensionContext, extensionId, '/r8b')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await expect(frame.getByLabel('Save to')).toHaveValue(categoryId)
      await page.close()
    }
    finally {
      await removeCategory(control, categoryId)
      await control.close()
    }
  })

  test('R8c：正式預設另一個 cat-X → 面板初始選取另一個資料夾', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'inbox' })
    const categoryId = await createCategory(control, 'Initial Cat B')
    try {
      await seedSettings(control, { defaultCategoryId: categoryId })
      const { page, url } = await openCase(extensionContext, extensionId, '/r8c')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await expect(frame.getByLabel('Save to')).toHaveValue(categoryId)
      await page.close()
    }
    finally {
      await removeCategory(control, categoryId)
      await control.close()
    }
  })

  test('R8d：未改選項直接按星號 → 寫回原預設、不覆蓋成 all', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'inbox' })
    const categoryId = await createCategory(control, 'Initial Cat C')
    try {
      await seedSettings(control, { defaultCategoryId: categoryId })
      const { page, url } = await openCase(extensionContext, extensionId, '/r8d')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await expect(frame.getByLabel('Save to')).toHaveValue(categoryId)
      await frame.getByRole('button', { name: 'Switch default' }).click()
      await expect.poll(async () => (await readSettings(control))?.defaultCategoryId).toBe(categoryId)
      expect((await readSettings(control))?.defaultCategoryId).not.toBe('all')
      await page.close()
    }
    finally {
      await removeCategory(control, categoryId)
      await control.close()
    }
  })

  test('R8e：初始為 cat-X，改選 all 時星號停用且正式設定不變', async ({ extensionContext, extensionId }) => {
    test.setTimeout(120_000)
    const control = await seed(extensionContext, extensionId, { defaultCategoryId: 'inbox' })
    const categoryId = await createCategory(control, 'Initial Cat D')
    try {
      await seedSettings(control, { defaultCategoryId: categoryId })
      const { page, url } = await openCase(extensionContext, extensionId, '/r8e')
      const frame = await openPalette(extensionContext, extensionId, page, url)
      await expect(frame.getByLabel('Save to')).toHaveValue(categoryId)
      await frame.getByLabel('Save to').selectOption('all')
      await expect(frame.getByRole('button', { name: 'Switch default' })).toBeDisabled()
      await page.waitForTimeout(500)
      expect((await readSettings(control))?.defaultCategoryId).toBe(categoryId)
      await page.close()
    }
    finally {
      await removeCategory(control, categoryId)
      await control.close()
    }
  })
})
