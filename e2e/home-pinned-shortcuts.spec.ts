import { encodeBookmarkGroup } from '../src/lib/bookmark-groups'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'
import { withStorageRetry } from './support/storage-ready'

let previous: { sync: Record<string, unknown>, local: Record<string, unknown> }
const memberUrl = 'https://example.com/hero-group-member'
const pinnedUrl = 'https://example.com/hero-ordinary-pinned'
const extraUrls = Array.from({ length: 9 }, (_, index) => `https://example.com/hero-limit-${index}`)

test.beforeEach(async ({ extensionWorker }) => {
  previous = await extensionWorker.evaluate(async () => ({
    sync: await chrome.storage.sync.get(null),
    local: await chrome.storage.local.get(null),
  }))
  const records = encodeBookmarkGroup({
    id: 'hero-shortcut-group',
    title: 'Hero group',
    description: '',
    pinnedAt: 3000,
    pinnedOrder: -2000,
    bookmarks: [{ id: 'hero-group-member', title: 'Hero member', url: memberUrl }],
  }, 'hero-fixture')
  await extensionWorker.evaluate(async ({ records, memberUrl, pinnedUrl }) => {
    await chrome.storage.sync.clear()
    await chrome.storage.local.clear()
    await chrome.storage.sync.set({
      ...records,
      'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true }),
    })
    await chrome.bookmarks.create({ parentId: '1', title: 'Hero member', url: memberUrl })
    await chrome.bookmarks.create({ parentId: '1', title: 'Hero ordinary', url: pinnedUrl })
    await chrome.bookmarks.create({ parentId: '1', title: 'Hero duplicate', url: pinnedUrl })
    await chrome.storage.local.set({ 'moorread:meta': JSON.stringify({ [pinnedUrl]: { pinnedAt: 1000, pinnedOrder: -1000 } }) })
  }, { records, memberUrl, pinnedUrl })
})

test.afterEach(async ({ extensionWorker }) => {
  // 清理本身是冪等（先以 url 搜尋再刪除、清除後還原），所以只對已知的 LevelDB
  // 暫時性 IO 重試；其他錯誤立即拋出，真正的清理失敗不會被掩蓋。
  await withStorageRetry(() => extensionWorker.evaluate(async ({ previous, urls }) => {
    for (const url of urls) {
      for (const bookmark of await chrome.bookmarks.search({ url }))
        await chrome.bookmarks.remove(bookmark.id)
    }
    await chrome.storage.sync.clear()
    await chrome.storage.local.clear()
    await chrome.storage.sync.set(previous.sync)
    await chrome.storage.local.set(previous.local)
  }, { previous, urls: [memberUrl, pinnedUrl, ...extraUrls] }))
})

test('includes pinned groups in the hero row, opens members and follows live unpinning', async ({ newTabPage, extensionWorker, extensionContext }) => {
  await newTabPage.reload()
  const row = newTabPage.locator('[data-home-hero]').getByRole('navigation', { name: '置頂書籤', exact: true })
  await expect(row.locator('li')).toHaveText(['Hero group', 'Hero ordinary'])
  await expect(row.getByRole('link')).toHaveCount(1)
  const other = await extensionContext.newPage()
  await other.goto(newTabPage.url())
  const otherRow = other.locator('[data-home-hero]').getByRole('navigation', { name: '置頂書籤', exact: true })
  await expect(otherRow.locator('li')).toHaveText(['Hero group', 'Hero ordinary'])
  await newTabPage.bringToFront()
  const group = row.getByRole('button', { name: 'Hero group', exact: true })
  await expect(group).toHaveAttribute('aria-haspopup', 'menu')
  await group.focus()
  await group.press('Enter')
  const member = newTabPage.getByRole('menuitem', { name: '開啟書籤 Hero member', exact: true })
  await expect(member).toBeFocused()
  const openedPromise = extensionContext.waitForEvent('page')
  await member.click()
  const opened = await openedPromise
  await expect(opened).toHaveURL(memberUrl)
  await opened.close()
  await newTabPage.bringToFront()
  await group.click()
  await expect(member).toBeVisible()
  await newTabPage.screenshot({ path: artifactPath('yunji-hero-pinned-group.png') })

  await extensionWorker.evaluate(async () => {
    const key = 'moorread:bookmark-group:hero-shortcut-group:hero-fixture:0'
    const stored = await chrome.storage.sync.get(key)
    const group = JSON.parse(String(stored[key]))
    delete group.pinnedAt
    await chrome.storage.sync.set({ [key]: JSON.stringify(group) })
  })
  await expect(group).toHaveCount(0)
  await expect(member).toHaveCount(0)
  await expect(row.locator('li')).toHaveText(['Hero ordinary'])
  await expect(otherRow.locator('li')).toHaveText(['Hero ordinary'])
  await other.close()
})

test('hides groups when disabled and hides shortcuts during bookmark search', async ({ newTabPage, extensionWorker }) => {
  await newTabPage.reload()
  const row = newTabPage.locator('[data-home-hero]').getByRole('navigation', { name: '置頂書籤', exact: true })
  await expect(row.locator('li')).toHaveText(['Hero group', 'Hero ordinary'])
  await newTabPage.locator('#moorread-search').fill('Hero')
  await expect(row).toHaveCount(0)
  await newTabPage.locator('#moorread-search').fill('')
  await expect(row.locator('li')).toHaveCount(2)
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const settings = JSON.parse(String((await chrome.storage.sync.get(key))[key]))
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...settings, bookmarkGroupsEnabled: false }) })
  })
  await expect(row.locator('li')).toHaveText(['Hero ordinary'])
  await newTabPage.setViewportSize({ width: 375, height: 812 })
  expect(await newTabPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('counts groups toward the ten shortcut limit and keeps custom group icons', async ({ newTabPage, extensionWorker }) => {
  const records = encodeBookmarkGroup({
    id: 'hero-shortcut-group',
    title: 'Hero group',
    description: '',
    icon: '📚',
    pinnedAt: 3000,
    pinnedOrder: -2000,
    bookmarks: [{ id: 'hero-group-member', title: 'Hero member', url: memberUrl }],
  }, 'hero-fixture')
  await extensionWorker.evaluate(async ({ records, urls }) => {
    await chrome.storage.sync.set(records)
    const key = 'moorread:meta'
    const meta = JSON.parse(String((await chrome.storage.local.get(key))[key]))
    for (const [index, url] of urls.entries()) {
      await chrome.bookmarks.create({ parentId: '1', title: `Hero limit ${index}`, url })
      meta[url] = { pinnedAt: 1000, pinnedOrder: index }
    }
    await chrome.storage.local.set({ [key]: JSON.stringify(meta) })
  }, { records, urls: extraUrls })
  await newTabPage.reload()
  const row = newTabPage.locator('[data-home-hero]').getByRole('navigation', { name: '置頂書籤', exact: true })
  await expect(row.locator('li')).toHaveCount(10)
  await expect(row.getByRole('link')).toHaveCount(9)
  await expect(row.getByRole('button', { name: 'Hero group', exact: true }).locator('[data-slot="bookmark-icon"]')).toHaveText('📚')
  await expect(row.getByRole('link', { name: 'Hero limit 8', exact: true })).toHaveCount(0)
})

test('fans the hero group graphic on hover and keyboard focus', async ({ newTabPage }) => {
  await newTabPage.emulateMedia({ reducedMotion: 'no-preference' })
  await newTabPage.reload()
  const hero = newTabPage.locator('[data-home-hero]')
  const group = hero.getByRole('button', { name: 'Hero group', exact: true })
  const card = group.locator('.group-stack-card').last()
  await expect(group).toBeVisible()
  await expect(hero).not.toHaveClass(/home-hero-entrance/)
  await newTabPage.mouse.move(0, 0)
  const resting = await card.evaluate(element => getComputedStyle(element).transform)
  await group.hover()
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).not.toBe(resting)
  await card.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await hero.getByRole('navigation', { name: '置頂書籤', exact: true }).screenshot({ path: artifactPath('yunji-hero-group-hover.png') })
  await newTabPage.mouse.move(0, 0)
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).toBe(resting)
  await group.focus()
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).not.toBe(resting)
  await newTabPage.emulateMedia({ reducedMotion: 'reduce' })
  await group.hover()
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).toBe(resting)
})

test('animates custom group shortcut icons and respects reduced motion', async ({ newTabPage, extensionWorker }) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:bookmark-group:hero-shortcut-group:hero-fixture:0'
    const group = JSON.parse(String((await chrome.storage.sync.get(key))[key]))
    group.icon = '📚'
    await chrome.storage.sync.set({ [key]: JSON.stringify(group) })
  })
  await newTabPage.emulateMedia({ reducedMotion: 'no-preference' })
  await newTabPage.reload()
  const hero = newTabPage.locator('[data-home-hero]')
  const group = hero.getByRole('button', { name: 'Hero group', exact: true })
  const icon = group.locator('[data-slot="bookmark-icon"]')
  await expect(icon).toHaveText('📚')
  await expect(hero).not.toHaveClass(/home-hero-entrance/)
  await newTabPage.mouse.move(0, 0)
  const restingY = (await icon.boundingBox())!.y
  await group.hover()
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeLessThan(restingY - 1)
  await newTabPage.mouse.move(0, 0)
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeCloseTo(restingY, 1)
  await group.focus()
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeLessThan(restingY - 1)
  await newTabPage.emulateMedia({ reducedMotion: 'reduce' })
  await group.hover()
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeCloseTo(restingY, 1)
  const ordinary = hero.getByRole('link', { name: 'Hero ordinary', exact: true })
  const ordinaryIcon = ordinary.locator('[data-slot="bookmark-icon"]')
  await newTabPage.mouse.move(0, 0)
  const ordinaryY = (await ordinaryIcon.boundingBox())!.y
  await ordinary.hover()
  await expect.poll(async () => (await ordinaryIcon.boundingBox())!.y).toBeCloseTo(ordinaryY, 1)
})

test('opens the hero group menu after hover dwell, bridges to it and promotes it without remounting', async ({ newTabPage }) => {
  await newTabPage.reload()
  const hero = newTabPage.locator('[data-home-hero]')
  const group = hero.getByRole('button', { name: 'Hero group', exact: true })
  const menu = newTabPage.getByRole('menu', { name: '檢視書籤組 Hero group', exact: true })
  await expect(group).toBeVisible()
  await expect(hero).not.toHaveClass(/home-hero-entrance/)
  const bounds = (await group.boundingBox())!
  const search = newTabPage.locator('#moorread-search')
  await search.focus()
  // `clock.install()` 會把頁面時鐘設成 server 當下的時間並繼續前進；若緊接著拿 Node 的
  // `new Date()` 當 pauseAt 目標，CDP 往返稍慢時頁面時鐘已越過該時間，Playwright 會拋
  // 「Cannot fast-forward to the past」。改用同一個固定時間，pauseAt 明確往前留安全邊界。
  const frozenAt = Date.now()
  await newTabPage.clock.install({ time: frozenAt })
  await newTabPage.clock.pauseAt(frozenAt + 1_000)
  try {
    await newTabPage.mouse.move(bounds.x + 20, bounds.y + 20)
    for (let step = 1; step <= 3; step++) {
      await newTabPage.clock.runFor(25)
      await newTabPage.mouse.move(bounds.x + 20 + step * 2, bounds.y + 20)
    }
    await newTabPage.clock.runFor(24)
    await expect(menu).toHaveCount(0)
    await newTabPage.clock.runFor(1)
    await expect(menu).toBeVisible({ timeout: 1500 })
    await expect(search).toBeFocused()
    const menuBounds = (await menu.boundingBox())!
    await newTabPage.mouse.move(menuBounds.x + 20, menuBounds.y + 20)
    await newTabPage.clock.runFor(250)
    await expect(menu).toBeVisible()
    await newTabPage.mouse.move(0, 0)
    await newTabPage.clock.runFor(199)
    await expect(menu).toBeVisible()
    await newTabPage.clock.runFor(1)
    await expect(menu).toHaveCount(0)

    await newTabPage.mouse.move(bounds.x + 20, bounds.y + 20)
    await newTabPage.clock.runFor(100)
    await expect(menu).toBeVisible()
    await menu.evaluate((element) => {
      element.dataset.originalMenu = 'true'
    })
    await group.click()
    await expect(menu).toHaveAttribute('data-original-menu', 'true')
    await newTabPage.mouse.move(0, 0)
    await newTabPage.clock.runFor(250)
    await expect(menu).toBeVisible()
    await newTabPage.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
  finally {
    await newTabPage.clock.resume()
  }
})
