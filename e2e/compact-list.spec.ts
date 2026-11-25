import type { Page, Worker } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

const SETTINGS_KEY = 'moorread:settings'
const FOLDER_TITLE = 'E2E P5 List Folder'
const SHORT = { title: 'P5 A', url: 'https://a.io/p5' }
const MEDIUM = { title: 'P5 C', url: 'https://medium.example.org/p5' }
const LONG = {
  title: 'P5 這是一個非常非常長的書籤標題用來驗證精簡列表的欄位不會被擠壓或換行而且內容還要再更長更長更長更長更長',
  url: 'https://very-long-subdomain.department.example.com/articles/2026/11/p5-compact-layout',
}
const DELETE_TARGET = { title: 'P5 Delete Me', url: 'https://example.com/p5-delete-me' }

async function patchSettings(
  worker: Worker,
  patch: Record<string, unknown>,
  appearancePatch?: Record<string, unknown>,
) {
  await worker.evaluate(async ({ key, patch, appearancePatch }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const settings = raw ? JSON.parse(String(raw)) : {}
    const appearance = appearancePatch
      ? { ...(settings.appearance ?? {}), ...appearancePatch }
      : settings.appearance
    await chrome.storage.sync.set({
      [key]: JSON.stringify({
        ...settings,
        ...patch,
        ...(appearance ? { appearance } : {}),
      }),
    })
  }, { key: SETTINGS_KEY, patch, appearancePatch })
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(
    document.getAnimations().map(animation => animation.finished.catch(() => undefined)),
  ))
}

async function measureRows(page: Page) {
  await settle(page)
  return page.locator('article[data-layout="compact"]').evaluateAll(nodes => nodes.map((node) => {
    const title = node.querySelector('[data-field="title"]') as HTMLElement
    const secondary = node.querySelector('[data-field="secondary"]') as HTMLElement
    const cardRect = node.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    const secondaryRect = secondary.getBoundingClientRect()
    return {
      cardHeight: Math.round(cardRect.height),
      titleLeft: Math.round(titleRect.left),
      titleRight: Math.round(titleRect.right),
      secondaryLeft: Math.round(secondaryRect.left),
      secondaryRight: Math.round(secondaryRect.right),
      truncated: title.scrollWidth > title.clientWidth,
      whiteSpace: getComputedStyle(title).whiteSpace,
    }
  }))
}

function expectAlignedRows(rows: Awaited<ReturnType<typeof measureRows>>) {
  const first = rows[0]
  for (const row of rows) {
    // 單列高度固定，不因資料長度而長高
    expect(row.cardHeight).toBe(first.cardHeight)
    expect(row.cardHeight).toBeGreaterThanOrEqual(44)
    expect(row.cardHeight).toBeLessThanOrEqual(52)
    // 主要欄位左緣一致，次要欄位右緣一致
    expect(Math.abs(row.titleLeft - first.titleLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(row.secondaryRight - first.secondaryRight)).toBeLessThanOrEqual(1)
    // 標題不與次要欄重疊，且維持單行
    expect(row.titleRight).toBeLessThanOrEqual(row.secondaryLeft)
    expect(row.whiteSpace).toBe('nowrap')
  }
}

async function openFolderFromNav(page: Page) {
  await page
    .getByRole('navigation', { name: '書籤分類' })
    .getByRole('button', { name: FOLDER_TITLE, exact: true })
    .click()
  await expect(page.locator('article[data-card-key^="bookmark:"]').first()).toBeVisible()
}

test.beforeEach(async ({ extensionWorker }) => {
  await patchSettings(extensionWorker, {
    language: 'zh-TW',
    onboardingDismissed: true,
    theme: 'light',
    bookmarkViewMode: 'compact',
  }, {
    bookmarkGridCols: 0,
    folderGridCols: 0,
    radius: 12,
    cardStyle: 'soft',
    cardFields: { websiteIcon: true },
  })
  await extensionWorker.evaluate(async ({ folderTitle, bookmarks }) => {
    const existingFolder = (await chrome.bookmarks.search({ title: folderTitle }))
      .find(node => !node.url)
    const folder = existingFolder
      ?? await chrome.bookmarks.create({ parentId: '1', title: folderTitle })
    const children = await chrome.bookmarks.getChildren(folder.id)
    for (const bookmark of bookmarks) {
      if (!children.some(child => child.url === bookmark.url))
        await chrome.bookmarks.create({ parentId: folder.id, title: bookmark.title, url: bookmark.url })
    }
  }, { key: SETTINGS_KEY, folderTitle: FOLDER_TITLE, bookmarks: [SHORT, MEDIUM, LONG] })
})

test('renders compact bookmarks as aligned field rows with varying data lengths', async ({
  newTabPage,
  extensionWorker,
}) => {
  test.setTimeout(90_000)
  // 單欄列表才能在同一視覺欄位上比較所有列
  await patchSettings(extensionWorker, {}, { bookmarkGridCols: 1 })
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  await expect(newTabPage.locator('article[data-layout="compact"]')).toHaveCount(3)
  expectAlignedRows(await measureRows(newTabPage))
  await newTabPage.screenshot({ path: artifactPath('mr029-compact-field-rows.png') })

  // 窄寬度下長標題必須以省略號收斂，欄位仍保持對齊
  await newTabPage.setViewportSize({ width: 800, height: 800 })
  await settle(newTabPage)
  const narrowRows = await measureRows(newTabPage)
  expectAlignedRows(narrowRows)
  expect(narrowRows.some(row => row.truncated)).toBe(true)
  await newTabPage.screenshot({ path: artifactPath('mr029-compact-field-rows-narrow.png') })
})

test('keeps category rows on the same compact fields', async ({ newTabPage }) => {
  test.setTimeout(90_000)
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  const nav = newTabPage.getByRole('navigation', { name: '書籤分類' })
  await nav.getByRole('button', { name: /全部/ }).click()
  const folder = newTabPage.locator('[data-card-key^="folder:"][data-layout="compact"]').first()
  await expect(folder).toBeVisible()
  await settle(newTabPage)
  const bookmark = newTabPage.locator('article[data-card-key^="bookmark:"]')
    .filter({ hasText: SHORT.title })
    .first()
  await expect(bookmark).toBeVisible()

  const metrics = await Promise.all([folder, bookmark].map(async (card) => {
    return card.evaluate((node) => {
      const title = node.querySelector('[data-field="title"]') as HTMLElement
      const secondary = node.querySelector('[data-field="secondary"]') as HTMLElement
      return {
        height: Math.round(node.getBoundingClientRect().height),
        titleLeft: Math.round(title.getBoundingClientRect().left),
        hasSecondary: Boolean(secondary),
        whiteSpace: getComputedStyle(title).whiteSpace,
      }
    })
  }))

  expect(metrics[0].height).toBe(metrics[1].height)
  expect(Math.abs(metrics[0].titleLeft - metrics[1].titleLeft)).toBeLessThanOrEqual(1)
  expect(metrics[0].hasSecondary).toBe(true)
  expect(metrics[0].whiteSpace).toBe('nowrap')
  await newTabPage.screenshot({ path: artifactPath('mr029-compact-category-rows.png') })
})

test('coexists with column settings and switches back to card view', async ({ newTabPage, extensionWorker }) => {
  test.setTimeout(90_000)
  await patchSettings(extensionWorker, {}, { bookmarkGridCols: 6, folderGridCols: 3 })
  await newTabPage.setViewportSize({ width: 1600, height: 900 })
  await newTabPage.reload()
  await expect(newTabPage.locator('article[data-card-key^="bookmark:"]')).toHaveCount(3)
  const bookmarkGrid = newTabPage.locator('article[data-card-key^="bookmark:"]').first().locator('..')
  const compactColumns = await bookmarkGrid.evaluate(node =>
    getComputedStyle(node as HTMLElement).gridTemplateColumns.split(' ').length)
  expect(compactColumns).toBe(6)

  await newTabPage.getByRole('radio', { name: '卡片檢視', exact: true }).click()
  await expect(newTabPage.locator('article[data-layout="card"]').first()).toBeVisible()
  await expect(newTabPage.locator('article[data-layout="compact"]')).toHaveCount(0)
  const cardColumns = await bookmarkGrid.evaluate(node =>
    getComputedStyle(node as HTMLElement).gridTemplateColumns.split(' ').length)
  expect(cardColumns).toBe(6)

  await newTabPage.getByRole('radio', { name: '精簡檢視', exact: true }).click()
  await expect(newTabPage.locator('article[data-layout="compact"]')).toHaveCount(3)
})

test('keeps drag reordering working in compact rows', async ({ newTabPage, extensionWorker }) => {
  test.setTimeout(90_000)
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  await openFolderFromNav(newTabPage)
  const source = newTabPage.getByLabel(`拖曳書籤 ${SHORT.title}`)
  const target = newTabPage.locator('article[data-card-key^="bookmark:"]').filter({ hasText: MEDIUM.title })
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  expect(sourceBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  await newTabPage.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await newTabPage.mouse.down()
  await newTabPage.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + sourceBox!.height / 2)
  await newTabPage.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 10 })
  await newTabPage.mouse.up()

  await expect(newTabPage.getByText(`已將「${SHORT.title}」移到「${MEDIUM.title}」之後`)).toBeVisible()
  await expect.poll(() => extensionWorker.evaluate(async ({ folderTitle, urls }) => {
    const folder = (await chrome.bookmarks.search({ title: folderTitle })).find(node => !node.url)
    if (!folder)
      return []
    return (await chrome.bookmarks.getChildren(folder.id))
      .filter(node => node.url && urls.includes(node.url))
      .map(node => node.title)
  }, { folderTitle: FOLDER_TITLE, urls: [SHORT.url, MEDIUM.url, LONG.url] }))
    .toEqual([MEDIUM.title, SHORT.title, LONG.title])
})

test('keeps batch, edit and delete interactions working in compact rows', async ({
  newTabPage,
  extensionWorker,
}) => {
  test.setTimeout(90_000)
  await patchSettings(extensionWorker, {}, { cardFields: { websiteIcon: false } })
  await extensionWorker.evaluate(async ({ folderTitle, target }) => {
    const folder = (await chrome.bookmarks.search({ title: folderTitle })).find(node => !node.url)
    if (!folder)
      return
    const existing = await chrome.bookmarks.search({ url: target.url })
    if (existing.length === 0)
      await chrome.bookmarks.create({ parentId: folder.id, title: target.title, url: target.url })
  }, { folderTitle: FOLDER_TITLE, target: DELETE_TARGET })
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  await openFolderFromNav(newTabPage)

  // 批次管理：勾選框不覆蓋主要欄位
  await newTabPage.getByRole('button', { name: '整理', exact: true }).click()
  await newTabPage.getByRole('menuitem', { name: '批次管理', exact: true }).click()
  const card = newTabPage.locator('article[data-card-key^="bookmark:"]').filter({ hasText: SHORT.title })
  const checkbox = card.getByRole('checkbox', { name: `選取 ${SHORT.title}`, exact: true })
  await expect(checkbox).toBeVisible()
  const checkboxBox = await checkbox.boundingBox()
  const titleBox = await card.locator('[data-field="title"]').boundingBox()
  expect(checkboxBox!.x + checkboxBox!.width).toBeLessThan(titleBox!.x)
  await checkbox.click()
  // 勾選後 aria-label 會變成「取消選取」，改用卡片內的 checkbox 定位
  await expect(card.getByRole('checkbox')).toBeChecked()
  await newTabPage.getByRole('button', { name: '離開批次管理' }).click()

  // 編輯
  await card.getByRole('button', { name: `${SHORT.title} 的更多操作`, exact: true }).click()
  await newTabPage.getByRole('menuitem', { name: '編輯書籤', exact: true }).click()
  const dialog = newTabPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('#bookmark-name')).toHaveValue(SHORT.title)
  await newTabPage.keyboard.press('Escape')
  await expect(newTabPage.getByRole('dialog')).toHaveCount(0)

  // 刪除
  const deleteCard = newTabPage.locator('article[data-card-key^="bookmark:"]').filter({ hasText: DELETE_TARGET.title })
  await deleteCard.getByRole('button', { name: `${DELETE_TARGET.title} 的更多操作`, exact: true }).click()
  await newTabPage.getByRole('menuitem', { name: '刪除書籤', exact: true }).click()
  await expect(deleteCard).toHaveCount(0)
  await expect.poll(() => extensionWorker.evaluate(async url =>
    (await chrome.bookmarks.search({ url })).length, DELETE_TARGET.url)).toBe(0)
})

test('keeps dark theme, rounded corners and search category path in compact rows', async ({
  newTabPage,
  extensionWorker,
}) => {
  test.setTimeout(90_000)
  await patchSettings(extensionWorker, { theme: 'dark' }, { radius: 12, cardStyle: 'soft' })
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  await expect(newTabPage.locator('html')).toHaveClass(/dark/)

  const input = newTabPage.locator('#moorread-search')
  await input.fill(SHORT.title)
  await input.press('Escape')
  const result = newTabPage.locator('article[data-layout="compact"]').filter({ hasText: SHORT.title }).first()
  await expect(result).toBeVisible()
  await settle(newTabPage)
  const radius = await result.evaluate(node => getComputedStyle(node).borderRadius)
  expect(radius).toBe('12px')
  const secondary = result.locator('[data-field="secondary"]')
  await expect(secondary).toContainText(FOLDER_TITLE)
  await secondary.click()
  await expect(input).toHaveValue('')
  await expect(newTabPage.locator('article[data-card-key^="bookmark:"]').filter({ hasText: SHORT.title }).first()).toBeVisible()
  await settle(newTabPage)
  await newTabPage.screenshot({ path: artifactPath('mr029-compact-dark.png') })
})

// 7／8 欄：卡片自身寬度不足時必須隱藏次欄，且不得覆蓋操作區、標題不得被壓成 0 寬。
async function measureDenseColumns(page: Page) {
  await settle(page)
  return page.locator('article[data-card-key^="bookmark:"]').evaluateAll(nodes => nodes.map((node) => {
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, right: rect.right, bottom: rect.bottom }
    }
    const title = node.querySelector('[data-field="title"]') as HTMLElement
    const secondary = node.querySelector('[data-field="secondary"]') as HTMLElement | null
    const body = (node.querySelector('a[data-nav-item]') ?? node.querySelector('button[data-nav-item]')) as HTMLElement | null
    const icon = body?.firstElementChild as HTMLElement | null
    const actions = Array.from(node.children).find(el =>
      el.tagName === 'DIV' && getComputedStyle(el).position === 'absolute' && el.querySelector('button')) as HTMLElement | undefined
    const secondaryRect = secondary && getComputedStyle(secondary).display !== 'none' ? box(secondary) : null
    const actionsRect = actions ? box(actions) : null
    const overlap = secondaryRect && actionsRect
      ? Math.max(0, Math.min(secondaryRect.right, actionsRect.right) - Math.max(secondaryRect.x, actionsRect.x))
      * Math.max(0, Math.min(secondaryRect.bottom, actionsRect.bottom) - Math.max(secondaryRect.y, actionsRect.y))
      : 0
    return {
      titleClientWidth: title.clientWidth,
      iconWidth: icon ? icon.getBoundingClientRect().width : 0,
      cardHeight: node.getBoundingClientRect().height,
      secondaryHidden: !secondary || getComputedStyle(secondary).display === 'none',
      secondaryOverlap: overlap,
      buttons: actions
        ? Array.from(actions.querySelectorAll('button')).map((button) => {
            const rect = button.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return Boolean(hit) && (hit === button || button.contains(hit))
          })
        : [],
    }
  }))
}

test('keeps 7 and 8 column compact rows clear of the action area', async ({ newTabPage, extensionWorker }) => {
  test.setTimeout(120_000)
  await newTabPage.setViewportSize({ width: 1600, height: 900 })
  for (const cols of [7, 8]) {
    await patchSettings(extensionWorker, {}, { bookmarkGridCols: cols, folderGridCols: cols })
    await newTabPage.reload()
    await expect(newTabPage.locator('article[data-layout="compact"]')).toHaveCount(3)
    const grid = newTabPage.locator('article[data-card-key^="bookmark:"]').first().locator('..')
    expect(await grid.evaluate(node => getComputedStyle(node as HTMLElement).gridTemplateColumns.split(' ').length)).toBe(cols)
    const rows = await measureDenseColumns(newTabPage)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const heights = new Set(rows.map(row => Math.round(row.cardHeight)))
    expect(heights.size).toBe(1)
    for (const row of rows) {
      expect(row.titleClientWidth).toBeGreaterThan(0)
      expect(row.iconWidth).toBeGreaterThanOrEqual(14)
      expect(row.secondaryOverlap).toBe(0)
      for (const hit of row.buttons)
        expect(hit).toBe(true)
    }
    expect(await newTabPage.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(await newTabPage.evaluate(() => window.innerWidth))
    await newTabPage.screenshot({ path: artifactPath(`mr032-compact-${cols}col.png`) })

    // 操作仍可用：置頂切換
    const card = newTabPage.locator('article[data-card-key^="bookmark:"]').first()
    await card.hover()
    const pin = card.locator('div.absolute button').first()
    const before = await pin.getAttribute('aria-label')
    await pin.click()
    await expect.poll(() => pin.getAttribute('aria-label')).not.toBe(before)
    await pin.click()
    await expect.poll(() => pin.getAttribute('aria-label')).toBe(before)
  }
})
