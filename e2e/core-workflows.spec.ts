import type { Locator, Page } from '@playwright/test'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './extension.fixture'

// 命令面板點擊書籤時，產品會同時探測主網址與替代網址並開啟最快回應者。
// 原本替代網址指向 google.com，真實網路一有抖動就會退回主網址（無效網域，永遠載不出來），
// 造成「找不到替代網址分頁」的偶發失敗。改用本機 server 讓探測結果固定可達。
let paletteServer: Server | undefined
let paletteAlternateBaseUrl = ''

test.beforeAll(async () => {
  paletteServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Global palette alternate</title>ok')
  })
  await new Promise<void>(resolve => paletteServer!.listen(0, '127.0.0.1', resolve))
  paletteAlternateBaseUrl = `http://127.0.0.1:${(paletteServer.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  if (!paletteServer)
    return
  paletteServer.closeAllConnections()
  await new Promise<void>(resolve => paletteServer!.close(() => resolve()))
  paletteServer = undefined
})

async function expectNoAccessibilityViolations(page: Page) {
  await page.waitForTimeout(250)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
}

async function openHeaderAction(page: Page, name: string) {
  if (name === '開啟設定') {
    await page.getByRole('button', { name: '開啟設定', exact: true }).click()
    return
  }
  if (name === '開啟垃圾桶與歷史記錄') {
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /^開啟垃圾桶與歷史記錄/ }).click()
    return
  }
  const action = page.getByRole('menuitem', { name, exact: true })
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await action.click()
}

test('allows multiple home tabs by default and reuses them when enabled', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, singleHomeTab: false }),
    })
  })
  const existingTabId = await newTabPage.evaluate(async () =>
    (await chrome.tabs.getCurrent()).id)

  await openHeaderAction(newTabPage, '開啟設定')
  await expect(newTabPage.getByText(/只保留一個書野 Moorread 首頁/)).toBeVisible()
  const singleHomeTabCheckbox = newTabPage.locator('#single-home-tab')
  await expect(singleHomeTabCheckbox).not.toBeChecked()
  await newTabPage.keyboard.press('Escape')

  const createdTabId = await extensionWorker.evaluate(async () =>
    (await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') })).id)

  await expect.poll(async () => extensionWorker.evaluate(async createdTabId =>
    chrome.tabs.get(createdTabId!).then(() => true).catch(() => false), createdTabId)).toBe(true)

  await newTabPage.bringToFront()
  await openHeaderAction(newTabPage, '開啟設定')
  await singleHomeTabCheckbox.click()
  await expect(singleHomeTabCheckbox).toBeChecked()

  await expect.poll(async () => extensionWorker.evaluate(async ({ createdTabId }) => {
    const homeUrl = chrome.runtime.getURL('newtab.html')
    const homeTabs = (await chrome.tabs.query({}))
      .filter(tab => tab.url?.startsWith(homeUrl))
    const createdTabStillExists = await chrome.tabs.get(createdTabId!)
      .then(() => true)
      .catch(() => false)

    return {
      activeTabId: homeTabs.find(tab => tab.active)?.id,
      createdTabStillExists,
      homeTabCount: homeTabs.length,
    }
  }, { createdTabId })).toEqual({
    activeTabId: existingTabId,
    createdTabStillExists: false,
    homeTabCount: 1,
  })

  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, singleHomeTab: false }),
    })
  })
})

test('loads the real extension and manages a native bookmark', async ({
  extensionWorker,
  newTabPage,
}) => {
  await expect(newTabPage.getByText('書野 Moorread', { exact: false }).first()).toBeVisible()
  await newTabPage.getByLabel('新增書籤', { exact: true }).click()
  await newTabPage.getByPlaceholder('github.com').fill('https://example.com/e2e')
  await newTabPage.getByPlaceholder('例如：GitHub').fill('E2E Example')
  await newTabPage.getByRole('button', { name: '新增', exact: true }).click()

  await expect(newTabPage.getByText('E2E Example', { exact: true })).toBeVisible()
  const matches = await extensionWorker.evaluate(async () =>
    chrome.bookmarks.search({ url: 'https://example.com/e2e' }))
  expect(matches).toHaveLength(1)
})

test('keeps the page scrollable when bookmark menus open', async ({
  extensionWorker,
  newTabPage,
}) => {
  const folderId = await extensionWorker.evaluate(async () => {
    const folder = await chrome.bookmarks.create({ parentId: '1', title: 'E2E Menu Folder' })
    for (let index = 0; index < 60; index += 1) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: `E2E Menu ${index}`,
        url: `https://example.com/menu-${index}`,
      })
    }
    return folder.id
  })
  try {
    await newTabPage.reload()
    await newTabPage
      .locator('button[aria-pressed]')
      .filter({ hasText: 'E2E Menu Folder' })
      .first()
      .click()
    await expect(newTabPage.getByRole('button', { name: 'E2E Menu 0 的更多操作' })).toBeVisible()
    expect(await newTabPage.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true)

    await newTabPage.getByRole('button', { name: 'E2E Menu 0 的更多操作' }).click()
    await expect(newTabPage.getByRole('menu')).toBeVisible()
    expect(await newTabPage.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
    await newTabPage.keyboard.press('Escape')

    await newTabPage.getByRole('button', { name: '整理', exact: true }).click()
    await newTabPage.getByRole('menuitem', { name: '批次管理', exact: true }).click()
    await newTabPage.getByRole('checkbox', { name: '選取 E2E Menu 0' }).click()
    await newTabPage.getByRole('button', { name: '更多', exact: true }).click()
    await expect(newTabPage.getByRole('menu')).toBeVisible()
    expect(await newTabPage.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
  }
  finally {
    await extensionWorker.evaluate(async id => chrome.bookmarks.removeTree(id), folderId)
  }
})

test('limits the initial bookmark render batch', async ({
  extensionWorker,
  newTabPage,
}) => {
  const folderId = await extensionWorker.evaluate(async () => {
    const folder = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Batch Folder',
    })
    for (let index = 0; index < 60; index += 1) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: `E2E Batch ${index}`,
        url: `https://example.com/batch-${index}`,
      })
    }
    return folder.id
  })
  try {
    await newTabPage.reload()
    await newTabPage
      .locator('button[aria-pressed]')
      .filter({ hasText: 'E2E Batch Folder' })
      .click()

    await expect(newTabPage.locator('a[data-nav-item]')).toHaveCount(50)
    await newTabPage.getByRole('button', { name: '載入更多（剩餘 10 項）' }).click()
    await expect(newTabPage.locator('a[data-nav-item]')).toHaveCount(60)
  }
  finally {
    await extensionWorker.evaluate(async id => chrome.bookmarks.removeTree(id), folderId)
  }
})

test('reorders native bookmarks by dragging cards in a category', async ({
  extensionWorker,
  newTabPage,
}) => {
  const folderId = await extensionWorker.evaluate(async () => {
    const folder = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Sort Folder',
    })
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: 'E2E Sort First',
      url: 'https://example.com/sort-first-e2e',
    })
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: 'E2E Sort Second',
      url: 'https://example.com/sort-second-e2e',
    })
    return folder.id
  })
  await newTabPage.reload()
  await newTabPage
    .getByRole('button', { name: /E2E Sort Folder/ })
    .first()
    .click()
  await expect(newTabPage.getByText('E2E Sort First', { exact: true }))
    .toBeVisible()

  const source = newTabPage.getByLabel('拖曳書籤 E2E Sort First')
  const target = newTabPage
    .locator('article')
    .filter({ hasText: 'E2E Sort Second' })
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  await newTabPage.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  )
  await newTabPage.mouse.down()
  await newTabPage.mouse.move(
    sourceBox!.x + sourceBox!.width / 2 + 10,
    sourceBox!.y + sourceBox!.height / 2,
  )
  await newTabPage.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 },
  )
  await newTabPage.mouse.up()

  await expect(
    newTabPage.getByText('已將「E2E Sort First」移到「E2E Sort Second」之後'),
  ).toBeVisible()
  await expect.poll(async () => extensionWorker.evaluate(async parentId =>
    (await chrome.bookmarks.getChildren(parentId))
      .filter(node => node.url)
      .map(node => node.title), folderId)).toEqual([
    'E2E Sort Second',
    'E2E Sort First',
  ])
})

test('separates local bookmark search from web search', async ({
  extensionWorker,
  newTabPage,
}) => {
  const url = 'https://example.com/search-mode-e2e'
  await extensionWorker.evaluate(async (targetUrl) => {
    const existing = await chrome.bookmarks.search({ url: targetUrl })
    if (existing.length === 0) {
      await chrome.bookmarks.create({
        parentId: '1',
        title: 'E2E Search Mode Target',
        url: targetUrl,
      })
    }
  }, url)
  await newTabPage.reload()

  const bookmarkSearch = newTabPage.getByLabel('搜尋書籤和資料夾')
  await bookmarkSearch.fill('E2E Search Mode Target')
  await expect(newTabPage.getByText('E2E Search Mode Target', { exact: true })).toBeVisible()
  await expect(newTabPage.getByRole('button', { name: '開啟第一個書籤結果' })).toBeVisible()

  await newTabPage.getByRole('radio', { name: '搜尋網頁' }).click()
  await expect(newTabPage.getByLabel('搜尋網頁或輸入網址')).toHaveValue('E2E Search Mode Target')
  await expect(newTabPage.getByRole('button', { name: '搜尋網頁' }).last()).toBeVisible()

  const engineTrigger = newTabPage.getByRole('button', { name: '選擇網頁搜尋引擎' })
  await engineTrigger.focus()
  await newTabPage.keyboard.press('Enter')
  const engineOptions = newTabPage.getByRole('menuitemradio')
  await expect(engineOptions.first()).toBeFocused()
  await expect(engineOptions.first()).toContainText('瀏覽器預設')
  await expect(newTabPage.getByRole('menuitemradio', { name: /百度/ })).toHaveCount(0)
  await newTabPage.keyboard.press('ArrowDown')
  await expect(engineOptions.nth(1)).toBeFocused()
  await newTabPage.keyboard.press('Escape')
  await expect(newTabPage.getByLabel('搜尋網頁或輸入網址')).toBeFocused()

  await newTabPage.getByRole('radio', { name: '搜尋書籤' }).click()
  await expect(bookmarkSearch).toHaveValue('E2E Search Mode Target')

  await bookmarkSearch.press('Enter')
  await expect.poll(async () => extensionWorker.evaluate(async (targetUrl) => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === targetUrl)
    return tab?.id ?? 0
  }, url)).not.toBe(0)
  await extensionWorker.evaluate(async (targetUrl) => {
    const tab = (await chrome.tabs.query({})).find(item => item.url === targetUrl)
    if (tab?.id)
      await chrome.tabs.remove(tab.id)
  }, url)
})

test('requires an explicit destination before bulk moving bookmarks', async ({
  extensionWorker,
  newTabPage,
}) => {
  const seeded = await extensionWorker.evaluate(async () => {
    const folder = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Bulk Destination',
    })
    await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Bulk Safety',
      url: 'https://example.com/bulk-safety-e2e',
    })
    return { destinationTitle: folder.title }
  })
  await newTabPage.reload()

  await newTabPage.getByRole('button', { name: '整理', exact: true }).click()
  await newTabPage.getByRole('menuitem', { name: '批次管理', exact: true }).click()
  // 0.1.12：批次移動改用與設定頁一致的樹狀資料夾選擇器，不再是扁平原生 select。
  const destination = newTabPage.getByRole('button', { name: '批次移動目標資料夾', exact: true })
  const move = newTabPage.getByRole('button', { name: '移動', exact: true })
  await expect(destination).toHaveText('選擇目標資料夾')
  await newTabPage.getByLabel('選取 E2E Bulk Safety').click()
  await expect(move).toBeDisabled()
  await destination.click()
  await newTabPage.getByRole('menuitem', { name: seeded.destinationTitle, exact: true }).click()
  await expect(destination).toHaveText(seeded.destinationTitle)
  await expect(move).toBeEnabled()
  await newTabPage.getByRole('button', { name: '離開批次管理' }).click()
})

test('keeps the last settings tab when reopened', async ({ newTabPage }) => {
  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('tab', { name: '版面' }).click()
  await expect(newTabPage.getByRole('tab', { name: '版面' }))
    .toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('Escape')
  await expect(newTabPage.getByRole('dialog')).toHaveCount(0)
  await openHeaderAction(newTabPage, '開啟設定')
  await expect(newTabPage.getByRole('tab', { name: '版面' }))
    .toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('Escape')
})

test('shows a visible error when deleting a bookmark fails', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Delete Failure',
      url: 'https://example.com/delete-failure-e2e',
    })
  })
  await newTabPage.reload()
  const card = newTabPage
    .locator('[data-card-key^="bookmark:"]')
    .filter({ hasText: 'E2E Delete Failure' })
  await newTabPage.evaluate(() => {
    const original = chrome.bookmarks.remove.bind(chrome.bookmarks)
    const mutable = chrome.bookmarks as unknown as {
      remove: typeof chrome.bookmarks.remove
    }
    mutable.remove = () => Promise.reject(new Error('E2E injected delete failure'))
    ;(window as unknown as { __restoreRemove?: () => void }).__restoreRemove = () => {
      mutable.remove = original
    }
  })
  await card
    .getByRole('button', { name: 'E2E Delete Failure 的更多操作', exact: true })
    .click()
  await newTabPage.getByRole('menuitem', { name: '刪除書籤', exact: true }).click()
  await expect(card.getByRole('alert')).toHaveText('刪除失敗')
  await newTabPage.evaluate(() => {
    (window as unknown as { __restoreRemove?: () => void }).__restoreRemove?.()
  })
  await extensionWorker.evaluate(async () => {
    const [node] = await chrome.bookmarks.search({ url: 'https://example.com/delete-failure-e2e' })
    if (node)
      await chrome.bookmarks.remove(node.id)
  })
})

test('shows duplicate handling and the settings surfaces', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    const existing = await chrome.bookmarks.search({ url: 'https://example.com/e2e' })
    if (existing.length === 0) {
      await chrome.bookmarks.create({
        parentId: '1',
        title: 'E2E Example',
        url: 'https://example.com/e2e',
      })
    }
  })
  await newTabPage.reload()
  await newTabPage.getByLabel('新增書籤', { exact: true }).click()
  await newTabPage.getByPlaceholder('github.com').fill('https://example.com/e2e#duplicate')
  await newTabPage.getByPlaceholder('例如：GitHub').fill('Duplicate')
  await expect(newTabPage.getByText('這個網址已經收藏')).toBeVisible()
  await newTabPage.getByRole('button', { name: '取消' }).click()

  await openHeaderAction(newTabPage, '開啟設定')
  await expect(newTabPage.getByRole('heading', { name: '設定' })).toBeVisible()
  await newTabPage.getByRole('tab', { name: '書籤外觀' }).click()
  await expect(newTabPage.getByText('整體風格')).toBeVisible()
  const compactStyle = newTabPage.getByRole('radio', { name: '簡潔', exact: true })
  await compactStyle.click()
  await expect(compactStyle).toHaveAttribute('data-state', 'on')
  await expect(newTabPage.getByRole('heading', { name: '顯示欄位' })).toBeVisible()
  const appearanceReset = newTabPage.getByRole('button', { name: '恢復預設' })
  // Chromium 支持非标准的 focusVisible 选项；普通程序化 focus 不会命中 :focus-visible 样式。
  await appearanceReset.evaluate(element =>
    (element.focus as (options?: { focusVisible?: boolean }) => void)({
      focusVisible: true,
    }))
  await expect(appearanceReset).toBeFocused()
  await expect.poll(() => appearanceReset.evaluate(element =>
    getComputedStyle(element).boxShadow)).not.toBe('none')
  await newTabPage.getByRole('tab', { name: '資料與隱私' }).click()
  await expect(newTabPage.getByText('資料備份')).toBeVisible()
  await expect(newTabPage.getByText('隱私與本機資料')).toBeVisible()
  await expect(newTabPage.getByText('跨裝置同步')).toBeVisible()
  await expect(newTabPage.getByText(/需要在 Chrome 登入 Google 帳號並開啟同步/)).toBeVisible()
  await newTabPage.getByRole('button', { name: '瞭解同步方式' }).click()
  await expect(newTabPage.getByRole('heading', { name: '跨裝置同步如何運作' })).toBeVisible()
  await expect(newTabPage.getByText(/不會將資料上傳到 Moorread 自建伺服器/)).toBeVisible()
  await expect(newTabPage.getByText(/登入同一個 Google 帳號/)).toBeVisible()
  const syncGuide = newTabPage.getByRole('dialog').filter({ has: newTabPage.getByRole('heading', { name: '跨裝置同步如何運作' }) })
  await syncGuide.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))))
  await newTabPage.keyboard.press('Escape')
  await expect(syncGuide).toBeHidden()
  await newTabPage.getByRole('button', { name: '進階同步設定' }).click()
  await expect(newTabPage.getByText('同步範圍')).toBeVisible()
  await expect(newTabPage.getByText('選用加密')).toBeVisible()
  await newTabPage.getByLabel('收件匣').click()
  await newTabPage.getByLabel('同步加密密碼').fill('e2e-passphrase')
  await newTabPage.getByRole('button', { name: '啟用加密' }).click()
  await expect(newTabPage.getByText('同步加密密碼已保存在本機')).toBeVisible()

  const syncSettings = await extensionWorker.evaluate(async () => {
    const rawSettings = (await chrome.storage.sync.get('moorread:settings'))['moorread:settings']
    const rawPassphrase = (await chrome.storage.local.get('moorread:metadata-sync-passphrase'))['moorread:metadata-sync-passphrase']
    const settings = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings
    return { settings, rawPassphrase }
  })
  expect(syncSettings.settings.metadataSyncScope.inboxAt).toBe(false)
  expect(syncSettings.settings.metadataSyncEncryptionEnabled).toBe(true)
  expect(String(syncSettings.rawPassphrase)).toContain('e2e-passphrase')

  await newTabPage.getByRole('tab', { name: '內容補全' }).click()
  await expect(newTabPage.getByRole('heading', { name: '補全網站描述' })).toBeVisible()
  await expect(newTabPage.getByText('跨裝置同步')).toHaveCount(0)
})

test('supports settings tab keyboard navigation and labeled bookmark fields', async ({ newTabPage }) => {
  await openHeaderAction(newTabPage, '開啟設定')
  const generalTab = newTabPage.getByRole('tab', { name: '一般' })
  const layoutTab = newTabPage.getByRole('tab', { name: '版面' })
  const appearanceTab = newTabPage.getByRole('tab', { name: '書籤外觀' })
  const visualTab = newTabPage.getByRole('tab', { name: '視覺' })
  const shortcutsTab = newTabPage.getByRole('tab', { name: '快速鍵' })
  const searchTab = newTabPage.getByRole('tab', { name: '搜尋' })
  const aboutTab = newTabPage.getByRole('tab', { name: '關於' })

  await expect(generalTab).toHaveAttribute('aria-controls', 'settings-panel-general')
  await generalTab.focus()
  await newTabPage.keyboard.press('ArrowDown')
  await expect(layoutTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('ArrowDown')
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('ArrowRight')
  await expect(visualTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('ArrowRight')
  await expect(shortcutsTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('ArrowRight')
  await expect(searchTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('End')
  await expect(aboutTab).toHaveAttribute('aria-selected', 'true')
  await expect(newTabPage.getByText(/個人自用版本/))
    .toBeVisible()
  await expect(newTabPage.getByRole('link', { name: /查看專案原始碼/ }))
    .toHaveAttribute('href', 'https://github.com/falaisy/moorread')
  await expect(newTabPage.getByRole('link', { name: /在 X 上追蹤 kiwi/ }))
    .toHaveAttribute('href', 'https://x.com/kiwiflysky')
  await newTabPage.keyboard.press('Home')
  await expect(generalTab).toHaveAttribute('aria-selected', 'true')
  await newTabPage.keyboard.press('Escape')

  await newTabPage.getByLabel('新增書籤', { exact: true }).click()
  await newTabPage.getByLabel('網址', { exact: true }).fill('https://example.com/a11y')
  await newTabPage.getByLabel('名稱', { exact: true }).fill('A11y Example')
  await expect(newTabPage.getByLabel('分類', { exact: true })).toBeVisible()
  await expect(newTabPage.getByLabel('備用 URL（選填）')).toBeHidden()
  await newTabPage.getByRole('button', { name: '更多選項' }).click()
  await expect(newTabPage.getByLabel('備用 URL（選填）')).toBeVisible()
  await expect(newTabPage.getByRole('button', { name: '取得網站資訊' })).toBeVisible()
  await newTabPage.keyboard.press('Escape')
})

test('records, validates, and applies a custom home-page shortcut', async ({
  extensionWorker,
  newTabPage,
}) => {
  await newTabPage.setViewportSize({ width: 375, height: 812 })
  await openHeaderAction(newTabPage, '開啟設定')
  const settingsDialog = newTabPage.getByRole('dialog', { name: '設定' })
  await expect.poll(() => settingsDialog.evaluate(element =>
    element.scrollWidth <= element.clientWidth)).toBe(true)
  await newTabPage.getByRole('tab', { name: '快速鍵' }).click()
  await expect(newTabPage.getByText('快速收藏目前頁面')).toBeVisible()
  const globalCommandRow = newTabPage
    .getByText('全域命令面板', { exact: true })
    .locator('..')
  await expect(globalCommandRow.getByText('未指派', { exact: true }))
    .toBeVisible()
  const globalShortcutSearch = newTabPage.getByRole('switch', {
    name: '啟用全域快速搜尋',
  })
  await expect(globalShortcutSearch).not.toBeChecked()
  await expect.poll(() => settingsDialog.evaluate(element =>
    element.scrollWidth <= element.clientWidth)).toBe(true)
  await globalShortcutSearch.click()
  await expect(globalShortcutSearch).toBeChecked()
  await expect.poll(() => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))[
      'moorread:settings'
    ]
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.globalCommandPaletteEnabled
  })).toBe(true)
  await globalShortcutSearch.click()
  await expect(globalShortcutSearch).not.toBeChecked()
  await expect(newTabPage.getByText(/chrome:\/\/extensions\/shortcuts/))
    .toBeVisible()
  await expect(newTabPage.getByText('開啟後請在清單中找到「書野 Moorread」。'))
    .toBeVisible()
  const [browserShortcutSettingsPage] = await Promise.all([
    newTabPage.context().waitForEvent('page'),
    newTabPage.getByRole('button', { name: '前往瀏覽器修改' }).click(),
  ])
  await expect.poll(() => browserShortcutSettingsPage.url())
    .toBe('chrome://extensions/shortcuts')
  await browserShortcutSettingsPage.close()

  const recorder = newTabPage.getByRole('button', {
    name: /^修改: 開啟命令面板/,
  })
  await recorder.click()
  await newTabPage.keyboard.press('n')
  await expect(newTabPage.getByText('此快速鍵已由「新增書籤」使用。'))
    .toBeVisible()
  await newTabPage.keyboard.press('ControlOrMeta+Shift+P')
  await expect(recorder).toHaveAccessibleName(/(⌘ ⇧ P|Ctrl \+ Shift \+ P)/)

  const persistedShortcut = await extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))[
      'moorread:settings'
    ]
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.keyboardShortcuts.openCommandPalette
  })
  expect(persistedShortcut).toEqual({
    key: 'p',
    primary: true,
    alt: false,
    shift: true,
  })

  await newTabPage.keyboard.press('Escape')
  await newTabPage.keyboard.press('ControlOrMeta+Shift+P')
  await expect(newTabPage.getByRole('heading', { name: '命令面板' }))
    .toBeVisible()
  await newTabPage.keyboard.press('Escape')

  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('tab', { name: '快速鍵' }).click()
  await newTabPage.getByRole('button', { name: '恢復預設' }).click()
  // 恢復預設是异步写入；等持久化完成再结束，避免后续用例读到旧的快捷键配置。
  await expect.poll(() => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))[
      'moorread:settings'
    ]
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    const shortcut = settings.keyboardShortcuts?.openCommandPalette
    return shortcut?.key === 'k'
      && shortcut?.primary === true
      && shortcut?.alt === false
      && shortcut?.shift === false
  })).toBe(true)
})

test('keeps global shortcut search disabled by default', async ({
  extensionContext,
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    delete settings.globalCommandPaletteEnabled
    await chrome.storage.sync.set({ [key]: JSON.stringify(settings) })
  })
  const page = await extensionContext.newPage()
  await page.goto('https://www.google.com/robots.txt')
  const tabId = await extensionWorker.evaluate(async targetUrl =>
    (await chrome.tabs.query({})).find(tab => tab.url === targetUrl)?.id, page.url())

  const response = await newTabPage.evaluate(async targetTabId =>
    chrome.runtime.sendMessage({
      type: 'moorread:global-palette-open-for-tab',
      tabId: targetTabId,
    }), tabId)

  expect(response).toEqual({ ok: false })
  await expect(page.locator('#moorread-global-command-palette')).toHaveCount(0)
  await page.close()
})

test('opens the global command palette on a regular web page', async ({
  extensionContext,
  extensionWorker,
  newTabPage,
}) => {
  const primaryUrl = 'https://global-palette.invalid/e2e'
  const alternateUrl = `${paletteAlternateBaseUrl}/yunji-global-palette=e2e`
  const scrollBookmarkIds = await extensionWorker.evaluate(async ({ alternateUrl, primaryUrl }) => {
    const settingsKey = 'moorread:settings'
    const storedSettings = await chrome.storage.sync.get(settingsKey)
    const settings = typeof storedSettings[settingsKey] === 'string'
      ? JSON.parse(storedSettings[settingsKey]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [settingsKey]: JSON.stringify({
        ...settings,
        globalCommandPaletteEnabled: true,
      }),
    })
    const existing = await chrome.bookmarks.search({
      url: primaryUrl,
    })
    if (existing.length === 0) {
      await chrome.bookmarks.create({
        parentId: '1',
        title: 'E2E Global Palette Target',
        url: primaryUrl,
      })
    }
    const stored = await chrome.storage.local.get('moorread:meta')
    const meta = typeof stored['moorread:meta'] === 'string'
      ? JSON.parse(stored['moorread:meta']) as Record<string, unknown>
      : {}
    meta[primaryUrl] = { alternateUrls: [alternateUrl] }
    await chrome.storage.local.set({
      'moorread:meta': JSON.stringify(meta),
    })
    const createdIds: string[] = []
    for (let index = 0; index < 12; index += 1) {
      const bookmark = await chrome.bookmarks.create({
        parentId: '1',
        title: `E2E Global Scroll ${index}`,
        url: `https://global-scroll-${index}.invalid/e2e`,
      })
      createdIds.push(bookmark.id)
    }
    return createdIds
  }, { alternateUrl, primaryUrl })

  const page = await extensionContext.newPage()
  await page.goto('https://www.google.com/robots.txt')
  const hostOverflowBefore = await page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))
  const tabId = await extensionWorker.evaluate(async targetUrl =>
    (await chrome.tabs.query({})).find(tab => tab.url === targetUrl)?.id, page.url())
  expect(tabId).toBeTruthy()
  const response = await newTabPage.evaluate(async targetTabId =>
    chrome.runtime.sendMessage({
      type: 'moorread:global-palette-open-for-tab',
      tabId: targetTabId,
    }), tabId)
  expect(response).toEqual({ ok: true })
  await page.bringToFront()

  await expect(page.locator('#moorread-global-command-palette')).toHaveCount(1)
  await expect.poll(() => page.frames().some(frame =>
    frame.url().includes('/tabs/global-command-palette.html'))).toBe(true)
  const paletteFrame = page.frames().find(frame =>
    frame.url().includes('/tabs/global-command-palette.html'))!
  const results = paletteFrame.locator('section')
  await expect(results).toBeVisible()
  await expect.poll(() => paletteFrame.evaluate(() => ({
    body: getComputedStyle(document.body).overflowY,
    document: getComputedStyle(document.documentElement).overflowY,
    results: getComputedStyle(document.querySelector('section')!).overflowY,
  }))).toEqual({ body: 'hidden', document: 'hidden', results: 'auto' })
  const scrollMetrics = await results.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => results.evaluate(element => element.scrollTop))
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => ({
    body: document.body.style.overflow,
    document: document.documentElement.style.overflow,
  }))).toEqual(hostOverflowBefore)
  const paletteSearch = paletteFrame.getByLabel('搜尋書籤')
  await paletteSearch.fill('E2E Global Palette Target')
  await expect(
    paletteFrame.getByText('E2E Global Palette Target', { exact: true }),
  ).toBeVisible()
  await paletteFrame
    .getByRole('button', { name: /E2E Global Palette Target/ })
    .first()
    .click()
  await expect(page.locator('#moorread-global-command-palette')).toHaveCount(0)
  await expect.poll(() =>
    extensionWorker.evaluate(async () =>
      Object.keys(await chrome.storage.session.get(null)).filter(key =>
        key.startsWith('moorread:global-palette-session:')).length)).toBe(0)
  await expect.poll(() =>
    extensionWorker.evaluate(async url =>
      (await chrome.tabs.query({})).filter(tab => tab.url === url).length, alternateUrl)).toBe(1)
  await expect.poll(() => extensionWorker.evaluate(async (url) => {
    const stored = await chrome.storage.local.get('moorread:usage')
    const usage = typeof stored['moorread:usage'] === 'string'
      ? JSON.parse(stored['moorread:usage'])
      : {}
    return usage[url]?.openCount ?? 0
  }, primaryUrl)).toBe(1)
  await newTabPage.bringToFront()
  const homeSearch = newTabPage.getByLabel('搜尋書籤和資料夾')
  await homeSearch.fill('E2E Global Palette Target')
  await newTabPage
    // The card title sits under the absolutely positioned actions overlay (pin/drag),
    // so click the primary link instead of the title text (BookmarkCard.tsx:258-266).
    .getByRole('link', { name: /E2E Global Palette Target/ })
    .first()
    .click()
  await expect.poll(() => extensionWorker.evaluate(async (url) => {
    const stored = await chrome.storage.local.get('moorread:usage')
    const usage = typeof stored['moorread:usage'] === 'string'
      ? JSON.parse(stored['moorread:usage'])
      : {}
    return usage[url]?.openCount ?? 0
  }, primaryUrl)).toBe(2)
  await extensionWorker.evaluate(async ({ bookmarkIds, urls }) => {
    const ids = (await chrome.tabs.query({}))
      .filter(tab => tab.url !== undefined && urls.includes(tab.url))
      .flatMap(tab => tab.id === undefined ? [] : [tab.id])
    if (ids.length > 0)
      await chrome.tabs.remove(ids)
    await Promise.all(bookmarkIds.map(id => chrome.bookmarks.remove(id)))
  }, { bookmarkIds: scrollBookmarkIds, urls: [primaryUrl, alternateUrl] })
  await page.close()
})

test('opens both command palette shortcuts in the current home tab', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [key]: JSON.stringify({
        ...settings,
        globalCommandPaletteEnabled: true,
        singleHomeTab: false,
      }),
    })
  })

  // The page reads the shortcut flag at startup; reload so the change is applied.
  await newTabPage.reload()
  await expect(newTabPage.locator('.newtab-shell')).toBeVisible()

  await newTabPage.keyboard.press('ControlOrMeta+k')
  await expect(newTabPage.getByRole('heading', { name: '命令面板' }))
    .toBeVisible()
  await newTabPage.keyboard.press('Escape')

  const homeTabId = await newTabPage.evaluate(async () =>
    (await chrome.tabs.getCurrent()).id)
  const tabCountBefore = await extensionWorker.evaluate(async () =>
    (await chrome.tabs.query({})).length)
  const response = await newTabPage.evaluate(async targetTabId =>
    chrome.runtime.sendMessage({
      type: 'moorread:global-palette-open-for-tab',
      tabId: targetTabId,
    }), homeTabId)

  expect(response).toEqual({ ok: true })
  await expect(newTabPage.getByRole('heading', { name: '命令面板' }))
    .toBeVisible()
  expect(await newTabPage.evaluate(async () =>
    (await chrome.tabs.getCurrent()).id)).toBe(homeTabId)
  expect(await extensionWorker.evaluate(async () =>
    (await chrome.tabs.query({})).length)).toBe(tabCountBefore)
})

test('falls back to the home command palette on a restricted page', async ({
  extensionContext,
  extensionWorker,
  newTabPage,
}) => {
  const homeTabId = await newTabPage.evaluate(async () =>
    (await chrome.tabs.getCurrent()).id)
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [key]: JSON.stringify({
        ...settings,
        globalCommandPaletteEnabled: true,
        singleHomeTab: true,
      }),
    })
  })
  await newTabPage.reload()
  await expect.poll(() => extensionWorker.evaluate(async expectedTabId =>
    (await chrome.storage.session.get('moorread:home-tab-id'))[
      'moorread:home-tab-id'
    ] === expectedTabId, homeTabId)).toBe(true)

  const restrictedPage = await extensionContext.newPage()
  await restrictedPage.goto('chrome://extensions/')
  const tabId = await extensionWorker.evaluate(async targetUrl =>
    (await chrome.tabs.query({})).find(tab => tab.url === targetUrl)?.id, restrictedPage.url())
  expect(tabId).toBeTruthy()

  const response = await newTabPage.evaluate(async targetTabId =>
    chrome.runtime.sendMessage({
      type: 'moorread:global-palette-open-for-tab',
      tabId: targetTabId,
    }), tabId)
  expect(response).toEqual({ ok: true })
  await expect(
    newTabPage.getByRole('heading', { name: '命令面板' }),
  ).toBeVisible()
  expect(await newTabPage.evaluate(async () =>
    (await chrome.tabs.getCurrent()).id)).toBe(homeTabId)

  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = await chrome.storage.sync.get(key)
    const settings = typeof stored[key] === 'string'
      ? JSON.parse(stored[key]) as Record<string, unknown>
      : {}
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, singleHomeTab: false }),
    })
  })
  await restrictedPage.close()
})

test('switches and persists the interface language', async ({
  extensionWorker,
  newTabPage,
}) => {
  await openHeaderAction(newTabPage, '開啟設定')
  const language = newTabPage.locator('#interface-language')

  await language.selectOption('en')
  await expect(newTabPage.getByRole('heading', { name: 'Settings' }))
    .toBeVisible()
  await newTabPage.getByRole('tab', { name: 'Bookmark Style' }).click()
  await expect(newTabPage.getByText('Overall style', { exact: true }))
    .toBeVisible()
  await newTabPage.getByRole('tab', { name: 'Visual' }).click()
  await expect(newTabPage.getByText('Light and dark mode', { exact: true }))
    .toBeVisible()
  await expect(newTabPage.getByRole('radio', { name: 'Light', exact: true }))
    .toBeVisible()
  await expect(newTabPage.getByText('明暗模式', { exact: true })).toHaveCount(0)
  await newTabPage.getByRole('tab', { name: 'General' }).click()
  await expect.poll(async () => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))['moorread:settings']
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.language
  })).toBe('en')

  // 正式支援語系僅 zh-TW 與 en（src/lib/i18n.ts languageOptions）。此矩陣原含
  // ja／ko／es／fr，屬舊版多語系殘留；未支援語系不得計入 PASS，故只保留 zh-TW。
  // en 的完整深度已於上方（Settings／Bookmark Style／Visual／General）驗證。
  for (const [value, heading, appearance, overallStyle, general] of [
    ['zh-TW', '設定', '外觀', '整體風格', '一般'],
  ] as const) {
    await language.selectOption(value)
    await expect(newTabPage.getByRole('heading', { name: heading }))
      .toBeVisible()
    await newTabPage.getByRole('tab', { name: appearance }).click()
    await expect(newTabPage.getByText(overallStyle, { exact: true }))
      .toBeVisible()
    await newTabPage.getByRole('tab', { name: general }).click()
  }
  await language.selectOption('en')

  await newTabPage.keyboard.press('Escape')
  await expect(newTabPage.getByRole('button', { name: 'Add bookmark' }))
    .toBeVisible()
  await newTabPage.getByRole('button', { name: 'Open settings', exact: true }).click()
  await newTabPage.locator('#interface-language').selectOption('zh-TW')
  await expect(newTabPage.getByRole('heading', { name: '設定' })).toBeVisible()
  await newTabPage.getByRole('tab', { name: '書籤外觀' }).click()
  await expect(newTabPage.getByText('整體風格', { exact: true })).toBeVisible()

  // 語言切換是 300ms debounce 後才寫入 storage（store-settings-slice.ts setLanguage）。
  // 若不等寫入完成就結束測試，fixture 關閉頁面會取消 debounce，storage 停留在 'en'；
  // 下一個測試載入時會是英文介面，找不到中文分頁名稱。
  await expect.poll(async () => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))['moorread:settings']
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.language
  })).toBe('zh-TW')
})

test('collapses smart categories while keeping the active item visible', async ({ newTabPage }) => {
  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('tab', { name: '版面' }).click()
  const smartCategoriesSwitch = newTabPage
    .getByRole('dialog')
    .getByLabel('智慧分類')
  if (!(await smartCategoriesSwitch.isChecked()))
    await smartCategoriesSwitch.click()
  await newTabPage.keyboard.press('Escape')

  const toggle = newTabPage.getByRole('button', { name: /^智慧分類 \d+$/ })
  const inbox = newTabPage.locator('button[aria-pressed]').filter({ hasText: '收件匣' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(inbox).toBeHidden()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(inbox).toBeVisible()
  await inbox.click()
  await toggle.click()

  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(inbox).toBeVisible()
  await expect(inbox).toHaveAttribute('aria-pressed', 'true')
})

test('persists and navigates the default sidebar category tree', async ({
  extensionWorker,
  newTabPage,
}) => {
  const runtimeErrors: string[] = []
  newTabPage.on('console', (message) => {
    const text = message.text()
    const expectedFaviconFallback
      = text.includes('https://www.google.com/s2/favicons')
        || text === 'Failed to load resource: net::ERR_FAILED'
    if (message.type() === 'error' && !expectedFaviconFallback)
      runtimeErrors.push(text)
  })
  newTabPage.on('pageerror', error => runtimeErrors.push(error.message))
  await extensionWorker.evaluate(async () => {
    const parent = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Tree Parent',
    })
    await chrome.bookmarks.create({
      parentId: parent.id,
      title: 'E2E Tree Child',
    })
  })
  await newTabPage.reload()

  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('tab', { name: '版面' }).click()
  await expect(newTabPage.getByLabel('樹狀資料夾')).toBeChecked()
  await newTabPage.getByRole('tab', { name: '書籤外觀' }).click()
  await newTabPage.getByRole('radio', { name: '緊湊' }).click()
  await expect(newTabPage.getByRole('radio', { name: '緊湊' })).toBeChecked()
  await newTabPage.keyboard.press('Escape')

  const collapseParent = newTabPage.getByRole('button', { name: '收合資料夾 E2E Tree Parent' })
  const childCategory = newTabPage.locator('button[aria-pressed]').filter({ hasText: 'E2E Tree Child' })
  await expect(collapseParent).toBeVisible()
  await expect(childCategory).toBeVisible()
  await expectNoAccessibilityViolations(newTabPage)
  await collapseParent.click()
  await expect(childCategory).toBeHidden()
  const expandParent = newTabPage.getByRole('button', { name: '展開資料夾 E2E Tree Parent' })
  await expect(expandParent).toBeVisible()
  await expandParent.click()
  await expect(childCategory).toBeVisible()
  await collapseParent.click()
  await expect(childCategory).toBeHidden()

  await newTabPage.keyboard.press('ControlOrMeta+k')
  await newTabPage.getByPlaceholder(/搜尋書籤、資料夾和操作/).fill('E2E Tree Child')
  await newTabPage.keyboard.press('Enter')
  await expect(childCategory).toBeVisible()
  await newTabPage.getByRole('button', { name: '收合資料夾 E2E Tree Parent' }).click()
  await expect(childCategory).toBeHidden()

  await expect.poll(async () => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))['moorread:settings']
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.appearance.navItems.categoryTree
  })).toBe(true)

  await newTabPage.reload()
  await expect(newTabPage.getByRole('button', { name: '收合資料夾 E2E Tree Parent' })).toBeVisible()
  await expect(childCategory).toBeVisible()

  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('tab', { name: '版面' }).click()
  await newTabPage.getByLabel('樹狀資料夾').click()
  await newTabPage.keyboard.press('Escape')
  expect(runtimeErrors).toEqual([])
})

test('creates and applies auto organization rules', async ({
  extensionWorker,
  newTabPage,
}) => {
  const seeded = await extensionWorker.evaluate(async () => {
    const folder = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Auto Target',
    })
    const bookmark = await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Auto Candidate',
      url: 'https://example.com/auto-rule-e2e',
    })
    const values = await chrome.storage.local.get('moorread:meta')
    const meta = typeof values['moorread:meta'] === 'string'
      ? JSON.parse(values['moorread:meta'])
      : {}
    meta['https://example.com/auto-rule-e2e'] = { inboxAt: Date.now() }
    await chrome.storage.local.set({ 'moorread:meta': JSON.stringify(meta) })
    return { folderId: folder.id, bookmarkId: bookmark.id }
  })

  await newTabPage.reload()
  await openHeaderAction(newTabPage, '開啟設定')
  await newTabPage.getByRole('button', { name: '進階：自動整理規則' }).click()
  await expect(newTabPage.getByRole('heading', { name: '自動整理規則' })).toBeVisible()
  await newTabPage.getByLabel('規則名稱').fill('E2E Auto Rule')
  await newTabPage.getByLabel('比對內容').fill('auto-rule-e2e')
  await newTabPage.getByLabel('比對欄位').selectOption('url')
  await newTabPage.getByLabel('目標資料夾').selectOption(`cat-${seeded.folderId}`)
  await newTabPage.getByLabel('新增標籤').fill('auto')
  await newTabPage.getByRole('button', { name: '新增規則' }).click()
  await expect(newTabPage.getByText('E2E Auto Rule')).toBeVisible()
  await newTabPage.getByRole('button', { name: '套用規則' }).click()
  await expect(newTabPage.getByText('已整理 1 個書籤')).toBeVisible()

  const result = await extensionWorker.evaluate(async (input) => {
    const [node] = await chrome.bookmarks.get(input.bookmarkId)
    const raw = (await chrome.storage.local.get('moorread:meta'))['moorread:meta']
    const meta = typeof raw === 'string' ? JSON.parse(raw) : {}
    return {
      parentId: node.parentId,
      meta: meta['https://example.com/auto-rule-e2e'],
    }
  }, seeded)
  expect(result.parentId).toBe(seeded.folderId)
  expect(result.meta.tags).toEqual(['auto'])
  expect(result.meta.inboxAt).toBeUndefined()
})

test('has no critical axe violations on core extension surfaces', async ({ newTabPage }) => {
  await expectNoAccessibilityViolations(newTabPage)

  await openHeaderAction(newTabPage, '開啟設定')
  await expect(newTabPage.getByRole('heading', { name: '設定' })).toBeVisible()
  await expectNoAccessibilityViolations(newTabPage)
  await newTabPage.keyboard.press('Escape')

  await newTabPage.getByLabel('新增書籤', { exact: true }).click()
  await expect(newTabPage.getByRole('heading', { name: '新增書籤' })).toBeVisible()
  await expectNoAccessibilityViolations(newTabPage)
})

test('keeps consolidated header actions keyboard accessible at narrow widths', async ({ newTabPage }) => {
  await newTabPage.setViewportSize({ width: 720, height: 800 })
  expect(newTabPage.url()).toMatch(/^chrome-extension:\/\//)
  await expect(newTabPage).toHaveTitle(/書野 Moorread/)
  await expect(newTabPage.locator('header').getByText('書野 Moorread', { exact: true })).toBeVisible()
  const runtimeErrors: string[] = []
  newTabPage.on('console', (message) => {
    if (message.type() === 'error')
      runtimeErrors.push(message.text())
  })
  newTabPage.on('pageerror', error => runtimeErrors.push(error.message))
  const moreButton = newTabPage.locator('button[aria-label="更多操作"]')

  await moreButton.focus()
  await newTabPage.keyboard.press('Enter')
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true')
  const healthItem = newTabPage.getByRole('menuitem', { name: '開啟書籤健康檢查' })
  await expect(healthItem).toBeFocused()
  await newTabPage.keyboard.press('ArrowDown')
  await expect(newTabPage.getByRole('menuitem', { name: '開啟垃圾桶與歷史記錄' })).toBeFocused()
  await expect(newTabPage.getByRole('menuitem', { name: '管理分頁工作階段' })).toBeVisible()

  await newTabPage.keyboard.press('End')
  await expect(newTabPage.getByRole('menuitem', { name: '切換到工作台佈局' })).toBeFocused()
  await newTabPage.keyboard.press('Escape')
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false')
  const settingsButton = newTabPage.getByRole('button', { name: '開啟設定', exact: true })
  await settingsButton.focus()
  await newTabPage.keyboard.press('Enter')
  await expect(newTabPage.getByRole('heading', { name: '設定' })).toBeVisible()
  await newTabPage.keyboard.press('Escape')

  await moreButton.click()
  await newTabPage.keyboard.press('Escape')
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false')
  await expect(moreButton).toBeFocused()
  expect(runtimeErrors).toEqual([])
})

test('exposes session and activity management dialogs', async ({ newTabPage }) => {
  await openHeaderAction(newTabPage, '管理分頁工作階段')
  await expect(newTabPage.getByRole('heading', { name: '分頁工作階段' })).toBeVisible()
  await newTabPage.keyboard.press('Escape')

  await openHeaderAction(newTabPage, '開啟垃圾桶與歷史記錄')
  await expect(newTabPage.getByRole('heading', { name: '垃圾桶與歷史記錄' })).toBeVisible()
  await newTabPage.keyboard.press('Escape')
})

test('hides the task center when no task needs attention', async ({ newTabPage }) => {
  await newTabPage.getByRole('button', { name: '更多操作', exact: true }).click()
  await expect(newTabPage.getByRole('menuitem', { name: '開啟工作中心' })).toHaveCount(0)
})

test('saves deduped tab sessions and restores selected tabs', async ({
  extensionContext,
  extensionWorker,
  newTabPage,
}) => {
  await newTabPage.bringToFront()
  await Promise.all(
    extensionContext.pages()
      .filter(page => page !== newTabPage)
      .map(page => page.close()),
  )
  await extensionWorker.evaluate(async () => {
    await chrome.storage.local.remove('moorread:tab-sessions')
  })
  const firstTab = await extensionContext.newPage()
  await firstTab.goto('https://example.com/session-a#one')
  const duplicateTab = await extensionContext.newPage()
  await duplicateTab.goto('https://EXAMPLE.com/session-a#two')
  const secondTab = await extensionContext.newPage()
  await secondTab.goto('https://example.com/session-b')
  const urls = await newTabPage.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true })
    return windows.flatMap(window => (window.tabs ?? []).map(tab => tab.url ?? ''))
  })
  expect(urls.join('\n')).toContain('https://example.com/session-a#one')

  await newTabPage.bringToFront()
  await openHeaderAction(newTabPage, '管理分頁工作階段')
  await newTabPage.getByPlaceholder('工作階段名稱（選填）').fill('E2E Session')
  await newTabPage.getByRole('button', { name: '儲存視窗' }).click()
  await expect(newTabPage.getByText('已儲存 2 個去重分頁')).toBeVisible()
  await expect(newTabPage.getByText(/2\s+個分頁/)).toBeVisible()

  await newTabPage.getByRole('button', { name: /展開工作階段 E2E Session/ }).click()
  await expect(newTabPage.getByLabel('Example Domain').first()).toBeVisible()
  await newTabPage.getByLabel('Example Domain').last().click()

  const beforeRestore = await extensionWorker.evaluate(async () =>
    (await chrome.tabs.query({})).length)
  await newTabPage.getByRole('button', { name: '還原工作階段 E2E Session' }).click()
  await expect(newTabPage.getByText('已還原 1 個分頁')).toBeVisible()
  const afterRestore = await extensionWorker.evaluate(async () =>
    (await chrome.tabs.query({})).length)
  expect(afterRestore).toBe(beforeRestore + 1)

  await newTabPage.getByRole('button', { name: '更新工作階段 E2E Session' }).click()
  await expect(newTabPage.getByText('已更新「E2E Session」')).toBeVisible()
  await firstTab.close()
  await duplicateTab.close()
  await secondTab.close()
})

test('previews and restores a deleted bookmark from persistent trash', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Trash',
      url: 'https://example.com/trash-e2e',
    })
  })
  await newTabPage.reload()
  await newTabPage.getByLabel('E2E Trash 的更多操作').click()
  await newTabPage.getByRole('menuitem', { name: '刪除書籤' }).click()
  await expect(newTabPage.getByText('E2E Trash', { exact: true })).toHaveCount(0)

  await openHeaderAction(newTabPage, '開啟垃圾桶與歷史記錄')
  await newTabPage.getByRole('button', { name: '還原 書籤「E2E Trash」' }).click()
  await expect(newTabPage.getByRole('heading', { name: '還原預覽' })).toBeVisible()
  await newTabPage.getByRole('button', { name: '確認還原' }).click()
  await expect(newTabPage.getByText('已還原 1 項')).toBeVisible()
  await newTabPage.keyboard.press('Escape')

  const restored = await extensionWorker.evaluate(async () =>
    chrome.bookmarks.search({ url: 'https://example.com/trash-e2e' }))
  expect(restored).toHaveLength(1)
})

test('triages inbox bookmarks one by one', async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async () => {
    // 反向順序時，前面的 spec（例如 inbox-save-semantics 的 Palette Target）可能留下
    // inbox 書籤，逐筆整理就永遠不會歸零。先清空原生書籤與殘留的 inboxAt，
    // 讓這個測試只處理自己建立的資料，不依賴其他 spec 的執行順序。
    for (const rootId of ['1', '2']) {
      for (const node of await chrome.bookmarks.getChildren(rootId))
        await chrome.bookmarks.removeTree(node.id)
    }
    const current = await chrome.storage.local.get('moorread:meta')
    const meta = typeof current['moorread:meta'] === 'string'
      ? JSON.parse(current['moorread:meta'])
      : {}
    for (const url of Object.keys(meta)) {
      if (meta[url]?.inboxAt !== undefined)
        delete meta[url].inboxAt
    }
    await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Inbox',
      url: 'https://example.com/inbox-e2e',
    })
    meta['https://example.com/inbox-e2e'] = { inboxAt: Date.now() }
    await chrome.storage.local.set({ 'moorread:meta': JSON.stringify(meta) })
    await chrome.storage.local.remove('moorread:metadata-sync:local-document')
    await chrome.storage.sync.clear()
  })
  await newTabPage.reload()
  // 先等首屏序列完成：否則「收件匣」會被載入後的 applyDefaultCategory 覆蓋回「全部」，
  // 逐筆整理按鈕也不會渲染（只在 activeCategoryId === 'inbox' 時出現）。
  await waitForGridReady(newTabPage)
  const inboxTab = await selectInboxCategory(newTabPage)
  // 不可只憑「E2E Inbox 可見」判定成功：該書籤在「全部」視圖也可見（舊測試的假通過來源）。
  await expect(inboxTab).toHaveAttribute('aria-pressed', 'true')
  await expect(newTabPage.getByRole('heading', { name: '收件匣', exact: true })).toBeVisible()
  await expect(newTabPage.getByText('E2E Inbox', { exact: true })).toBeVisible()
  const triageButton = newTabPage.getByRole('button', { name: '逐筆整理' })
  await expect(triageButton).toBeEnabled()
  await triageButton.click()
  await expect(newTabPage.getByRole('heading', { name: '整理收件匣' })).toBeVisible()
  const dialog = newTabPage.getByRole('dialog')
  const tagsInput = newTabPage.getByRole('textbox', { name: '標籤', exact: true })
  // 0.1.12 A1：注音等輸入法組字期間的 Enter 只確認選字，不得完成整理。
  // 這裡用 CDP 真實建立組字狀態，再送 Enter；若守衛失效，書籤會立刻被移走。
  const cdp = await newTabPage.context().newCDPSession(newTabPage)
  await tagsInput.click()
  await cdp.send('Input.imeSetComposition', {
    text: '書',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await newTabPage.keyboard.press('Enter')
  await expect(dialog.getByText('剩餘 1 筆')).toBeVisible()
  const pendingMeta = await extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.local.get('moorread:meta'))['moorread:meta']
    return typeof raw === 'string' ? JSON.parse(raw) : {}
  })
  expect(pendingMeta['https://example.com/inbox-e2e'].inboxAt).toBeTruthy()
  // 取消組字後的一般 Enter 才完成並繼續。
  await cdp.send('Input.imeSetComposition', {
    text: '',
    selectionStart: 0,
    selectionEnd: 0,
  })
  await tagsInput.fill('E2E, Review')
  await newTabPage.keyboard.press('Enter')
  await expect(newTabPage.getByRole('dialog').getByText('收件匣已整理完成').last()).toBeVisible()

  const savedMeta = await extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.local.get('moorread:meta'))['moorread:meta']
    return typeof raw === 'string' ? JSON.parse(raw) : {}
  })
  expect(savedMeta['https://example.com/inbox-e2e'].inboxAt).toBeUndefined()
  expect(savedMeta['https://example.com/inbox-e2e'].tags).toEqual(['E2E', 'Review'])
})

test('keeps the category selected before first-load completion', async ({
  extensionWorker,
  newTabPage,
}) => {
  // 回歸舊缺陷：側欄在骨架屏期間就可點，但 loadBookmarks 之後的 applyDefaultCategory
  // 會把分類覆蓋回預設值（'all'），導致載入完成後「收件匣」不再是選中狀態、
  // 「逐筆整理」按鈕消失。這裡用 addInitScript 延後 chrome.bookmarks.getTree，
  // 穩定製造「載入未完成」視窗（不是 sleep，也不依賴機器速度）。
  await extensionWorker.evaluate(async () => {
    for (const rootId of ['1', '2']) {
      for (const node of await chrome.bookmarks.getChildren(rootId))
        await chrome.bookmarks.removeTree(node.id)
    }
    const current = await chrome.storage.local.get('moorread:meta')
    const meta = typeof current['moorread:meta'] === 'string'
      ? JSON.parse(current['moorread:meta'])
      : {}
    for (const url of Object.keys(meta)) {
      if (meta[url]?.inboxAt !== undefined)
        delete meta[url].inboxAt
    }
    await chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E Pre-ready Inbox',
      url: 'https://example.com/pre-ready-inbox-e2e',
    })
    meta['https://example.com/pre-ready-inbox-e2e'] = { inboxAt: Date.now() }
    await chrome.storage.local.set({ 'moorread:meta': JSON.stringify(meta) })
    await chrome.storage.local.remove('moorread:metadata-sync:local-document')
    await chrome.storage.sync.clear()
  })

  await newTabPage.addInitScript(() => {
    const bookmarks = (globalThis as unknown as {
      chrome?: { bookmarks?: Record<string, unknown> }
    }).chrome?.bookmarks
    const getTree = bookmarks?.getTree
    if (!bookmarks || typeof getTree !== 'function')
      return
    const original = (getTree as (...args: unknown[]) => Promise<unknown>).bind(bookmarks)
    try {
      Object.defineProperty(bookmarks, 'getTree', {
        configurable: true,
        writable: true,
        value: (...args: unknown[]) => new Promise((resolve, reject) => {
          setTimeout(() => {
            original(...args).then(resolve, reject)
          }, 2_500)
        }),
      })
    }
    catch {
      // 無法延後載入時，下方的骨架屏斷言會明確失敗，不會讓回歸測試假通過。
    }
  })
  await newTabPage.reload()

  // 操作時機必須仍在載入中（骨架屏還在），才真的覆蓋到舊缺陷的觸發條件。
  await expect(
    newTabPage.getByTestId('bookmark-grid-loading'),
    '無法製造載入未完成視窗：骨架屏在選分類前就消失了',
  ).toBeVisible()
  const inboxTab = await selectInboxCategory(newTabPage)
  await expect(newTabPage.getByTestId('bookmark-grid-loading')).toBeVisible()

  // 載入序列跑完（applyDefaultCategory 已執行）後，使用者的選擇必須保留。
  await expect(newTabPage.locator('[data-newtab-ready="true"]')).toBeVisible()
  await expect(newTabPage.getByTestId('bookmark-grid-loading')).toHaveCount(0)
  await expect(inboxTab).toHaveAttribute('aria-pressed', 'true')
  await expect(newTabPage.getByRole('heading', { name: '收件匣', exact: true })).toBeVisible()
  await expect(newTabPage.getByText('E2E Pre-ready Inbox', { exact: true })).toBeVisible()
  await expect(newTabPage.getByRole('button', { name: '逐筆整理' })).toBeEnabled()

  // 分類切換後視圖必須一致：切回「全部」時逐筆整理消失，切回收件匣時恢復並保持選中。
  const allTab = newTabPage.locator('button[aria-pressed]').filter({ hasText: '全部' }).first()
  await allTab.click()
  await expect(allTab).toHaveAttribute('aria-pressed', 'true')
  await expect(inboxTab).toHaveAttribute('aria-pressed', 'false')
  await expect(newTabPage.getByRole('button', { name: '逐筆整理' })).toHaveCount(0)
  await inboxTab.click()
  await expect(inboxTab).toHaveAttribute('aria-pressed', 'true')
  await expect(newTabPage.getByRole('heading', { name: '收件匣', exact: true })).toBeVisible()
  await expect(newTabPage.getByRole('button', { name: '逐筆整理' })).toBeEnabled()
})

// 這兩個 helper 放在檔尾：`test('triages inbox bookmarks one by one')` 必須維持在
// `core-workflows.spec.ts:1204`（既有回歸指令以此行定位）；函式宣告會提升，呼叫端不受影響。

// `data-newtab-ready` 由 onLoaded 寫入，時機是「loadBookmarks → applyDefaultCategory」都跑完之後；
// 骨架屏消失是同一個狀態的 UI 證據。側欄在骨架屏期間就能點，但此時選分類會被
// applyDefaultCategory 覆蓋，所以任何分類互動都必須先等到這個訊號，不能靠固定 sleep。
async function waitForGridReady(page: Page) {
  await expect(page.locator('[data-newtab-ready="true"]')).toBeVisible()
  await expect(page.getByTestId('bookmark-grid-loading')).toHaveCount(0)
}

async function selectInboxCategory(page: Page): Promise<Locator> {
  const smartCategoriesToggle = page.getByRole('button', { name: /^智慧分類 \d+$/ })
  if (await smartCategoriesToggle.count() > 0) {
    if (await smartCategoriesToggle.getAttribute('aria-expanded') === 'false')
      await smartCategoriesToggle.click()
    await expect(smartCategoriesToggle).toHaveAttribute('aria-expanded', 'true')
  }
  const inboxTab = page.locator('button[aria-pressed]').filter({ hasText: '收件匣' })
  await expect(inboxTab).toBeVisible()
  await inboxTab.click()
  await expect(inboxTab).toHaveAttribute('aria-pressed', 'true')
  return inboxTab
}
