import type { Worker } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

const FOLDER_NAME = 'E2E Query Folder'
const NESTED_NAME = 'E2E Nested'
const BOOKMARK_NAME = 'E2E Query Bookmark'
const BOOKMARK_URL = 'https://example.com/e2e-query-bookmark'
const LEGACY_NAME = 'E2E Legacy Enter Target'
const LEGACY_URL = 'https://example.com/e2e-legacy-enter'

async function ensureFolder(
  worker: Worker,
  title: string,
  parentId: string,
): Promise<string> {
  const existing = await worker.evaluate(async (name) => {
    const results = await chrome.bookmarks.search({ title: name })
    return results.find(node => !node.url)?.id ?? ''
  }, title)
  if (existing)
    return existing
  return worker.evaluate(async ({ title, parentId }) => {
    const node = await chrome.bookmarks.create({ parentId, title })
    return node.id
  }, { title, parentId })
}

async function ensureBookmark(
  worker: Worker,
  title: string,
  url: string,
  parentId: string,
) {
  await worker.evaluate(async ({ title, url, parentId }) => {
    const existing = await chrome.bookmarks.search({ url })
    if (existing.length === 0)
      await chrome.bookmarks.create({ parentId, title, url })
  }, { title, url, parentId })
}

test.beforeEach(async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = (await chrome.storage.sync.get(key))[key]
    const settings = stored ? JSON.parse(String(stored)) : {}
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...settings, language: 'zh-TW' }) })
  })

  const folderId = await ensureFolder(extensionWorker, FOLDER_NAME, '1')
  const nestedId = await ensureFolder(extensionWorker, NESTED_NAME, folderId)
  await ensureBookmark(extensionWorker, BOOKMARK_NAME, BOOKMARK_URL, '1')
  await ensureBookmark(extensionWorker, 'E2E Nested Bookmark', 'https://example.com/e2e-nested', nestedId)
  await ensureBookmark(extensionWorker, LEGACY_NAME, LEGACY_URL, '1')

  await newTabPage.reload()
})

test('shows bookmark and folder results in separate sections', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E Query')

  const panel = newTabPage.locator('#moorread-search-results')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('group', { name: '書籤' })).toBeVisible()
  await expect(panel.getByRole('group', { name: '資料夾' })).toBeVisible()
  await expect(panel.getByRole('option').filter({ hasText: BOOKMARK_NAME }).first()).toBeVisible()
  await expect(panel.getByRole('option').filter({ hasText: FOLDER_NAME }).first()).toBeVisible()
})

test('shows the full folder path for nested folder results', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E Nested')

  const option = newTabPage
    .locator('#moorread-search-results')
    .getByRole('option')
    .filter({ hasText: NESTED_NAME })
    .first()
  await expect(option).toBeVisible()
  await expect(option).toContainText(new RegExp(`${FOLDER_NAME}\\s*/\\s*${NESTED_NAME}`))
})

test('moves the active result with arrow keys and exposes ARIA state', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E Query')
  await expect(input).toHaveAttribute('aria-expanded', 'true')

  const options = newTabPage.locator('#moorread-search-results').getByRole('option')
  const total = await options.count()
  expect(total).toBeGreaterThan(1)

  await input.press('ArrowDown')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', 'moorread-search-results-0')

  await input.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false')

  for (let i = 2; i < total; i += 1)
    await input.press('ArrowDown')
  await expect(options.nth(total - 1)).toHaveAttribute('aria-selected', 'true')

  await input.press('ArrowDown')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')

  await input.press('ArrowUp')
  await expect(options.nth(total - 1)).toHaveAttribute('aria-selected', 'true')
})

test('opens the keyboard-selected folder instead of the first result', async ({
  extensionWorker,
  newTabPage,
}) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E Query')
  const options = newTabPage.locator('#moorread-search-results').getByRole('option')
  await expect(options.nth(1)).toBeVisible()

  await input.press('ArrowDown')
  await input.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')

  await input.press('Enter')
  await expect(newTabPage).toHaveURL(/newtab\.html/)
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await expect(newTabPage.locator('#moorread-search-results')).toHaveCount(0)
  // 選取的是資料夾，因此第一個書籤結果不得被開啟。
  expect(await extensionWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    return tabs.filter(tab => tab.url === url).length
  }, BOOKMARK_URL)).toBe(0)
})

test('keeps the open results panel clickable for folder actions', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill(FOLDER_NAME)
  const panel = newTabPage.locator('#moorread-search-results')
  await expect(panel).toBeVisible()

  const edit = newTabPage.getByRole('main').getByRole('button', { name: `編輯資料夾 ${FOLDER_NAME}`, exact: true })
  await edit.click()

  // 真實點擊必須開啟編輯對話框；若面板在 mousedown 與 mouseup 之間收合，按鈕位移會讓點擊落空。
  const dialog = newTabPage.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // 焦點進入對話框後，結果面板依原設計收合。
  await expect(panel).toHaveCount(0)

  await newTabPage.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 收合後搜尋框與鍵盤操作仍然正常。
  await input.click()
  await expect(panel).toBeVisible()
  await input.press('ArrowDown')
  await expect(panel.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await input.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('closes the results panel with Escape without submitting', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E Query')
  await expect(newTabPage.locator('#moorread-search-results')).toBeVisible()

  await input.press('Escape')
  await expect(newTabPage.locator('#moorread-search-results')).toHaveCount(0)
  await expect(input).toHaveValue('E2E Query')
  await expect(newTabPage).toHaveURL(/newtab\.html/)
})

test('keeps the legacy Enter-opens-first-result flow when arrows are unused', async ({
  extensionWorker,
  newTabPage,
}) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill(LEGACY_NAME)
  await expect(newTabPage.getByRole('option').filter({ hasText: LEGACY_NAME }).first()).toBeVisible()

  await input.press('Enter')
  await expect.poll(async () => extensionWorker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === url)
    return tab?.id ?? 0
  }, LEGACY_URL)).not.toBe(0)

  await extensionWorker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === url)
    if (tab?.id)
      await chrome.tabs.remove(tab.id)
  }, LEGACY_URL)
})

test('handles empty query, no results, and rapid typing', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await expect(newTabPage.locator('#moorread-search-results')).toHaveCount(0)

  await input.fill('zzzz-no-such-bookmark-zzzz')
  const panel = newTabPage.locator('#moorread-search-results')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('沒有相符的內容')).toBeVisible()
  await expect(panel.getByRole('option')).toHaveCount(0)

  await input.fill('')
  await expect(newTabPage.locator('#moorread-search-results')).toHaveCount(0)

  for (const value of ['E2E', 'E2E Q', 'E2E Qu', 'E2E Que', 'E2E Query'])
    await input.fill(value)
  await expect(panel.getByRole('option').first()).toBeVisible()
  await expect(panel.getByRole('option').filter({ hasText: BOOKMARK_NAME }).first()).toBeVisible()
})

test('renders only one visible results panel when both search inputs mount', async ({
  extensionWorker,
  newTabPage,
}) => {
  // 先補足書籤列高度，讓 hero 搜尋框有足夠捲動距離滑入 sticky header。
  await extensionWorker.evaluate(async () => {
    const existing = await chrome.bookmarks.search({ title: 'E2E Filler' })
    if (existing.length > 0)
      return
    for (let i = 1; i <= 30; i += 1) {
      await chrome.bookmarks.create({
        parentId: '1',
        title: `E2E Filler ${String(i).padStart(2, '0')}`,
        url: `https://example.com/e2e-filler-${i}`,
      })
    }
  })
  await newTabPage.reload()

  const hero = newTabPage.locator('#moorread-search')
  const docked = newTabPage.locator('#moorread-search-docked')

  // 位於頁首時，centered 版面只掛載 hero 搜尋框；header 尚未掛載 docked 版本。
  await expect(hero).toHaveCount(1)
  await expect(docked).toHaveCount(0)

  // 使用可匹配大量書籤的關鍵字，讓書籤格仍有足夠高度可捲動。
  await hero.fill('E2E')
  await expect(newTabPage.locator('#moorread-search-results')).toBeVisible()
  await expect(newTabPage.locator('[role="listbox"]')).toHaveCount(1)

  // 先捲動讓 hero 搜尋框滑入 sticky header；此刻 header 才掛載 docked 版本。
  await newTabPage.evaluate(() => {
    const search = document.getElementById('moorread-search')
    const header = document.querySelector('header')
    if (!search || !header)
      return
    const delta = search.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom + 10
    window.scrollBy(0, Math.max(delta, 0))
  })
  await expect(docked).toHaveCount(1)

  // 兩個搜尋框同時掛載，但 hero 已被 sticky header 遮住，且其面板因焦點轉移而關閉。
  await expect(hero).toHaveCount(1)
  await expect(hero).toHaveAttribute('aria-expanded', 'false')
  await expect(newTabPage.locator('#moorread-search-results')).toHaveCount(0)
  await expect(newTabPage.locator('[role="listbox"]')).toHaveCount(1)
  await expect(newTabPage.locator('#moorread-search-docked-results')).toBeVisible()

  // header 以下真正可見的結果面板只有一個。
  const visiblePanels = await newTabPage.locator('[role="listbox"]').evaluateAll((nodes) => {
    const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom
    return nodes.filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0
        && Math.min(rect.bottom, window.innerHeight) > Math.max(rect.top, headerBottom)
    }).length
  })
  expect(visiblePanels).toBe(1)

  await newTabPage.screenshot({ path: artifactPath('evidence-dual-searchbar-docked.png') })

  // 在 docked 繼續輸入更精確的關鍵字：書籤格縮短使頁面回到頂端，
  // 搜尋框與面板交還 hero；任一時刻仍只有一個面板。
  await docked.fill('E2E Query')
  await expect(hero).toHaveValue('E2E Query')
  await expect(hero).toHaveAttribute('aria-expanded', 'true')
  await expect(newTabPage.locator('[role="listbox"]')).toHaveCount(1)
  await expect(newTabPage.locator('#moorread-search-results')).toBeVisible()

  await newTabPage.screenshot({ path: artifactPath('evidence-dual-searchbar-centered.png') })
})
