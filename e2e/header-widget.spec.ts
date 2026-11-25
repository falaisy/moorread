import type { Route } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

test.beforeEach(async ({ extensionWorker }) => {
  await extensionWorker.evaluate(async () => {
    // The workspace layout keeps the widget in the header, whose geometry these tests check.
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true, appearance: { homeLayout: 'workspace' } }) })
    const cache = await chrome.storage.local.get(null)
    await chrome.storage.local.remove(Object.keys(cache).filter(key => key.startsWith('yunji-weather:')))
  })
})

test('configures time and weather, persists settings and fits small screens', async ({ newTabPage, extensionWorker }) => {
  await newTabPage.addInitScript(() => {
    chrome.permissions.request = async () => true
    chrome.permissions.contains = async () => true
  })
  await newTabPage.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [
    { name: '上海', admin1: '上海市', country: '中国', feature_code: 'PPLA', population: 24874500, latitude: 31.22, longitude: 121.46 },
    { name: '上海', admin1: '浙江', admin2: '绍兴市', country: '中国', feature_code: 'PPL', latitude: 29.33, longitude: 121.06 },
    { name: '上海', admin1: '云南', admin2: '丽江市', country: '中国', feature_code: 'PPL', latitude: 27.07, longitude: 100.11 },
  ] } }))
  await newTabPage.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: route.request().url().includes('fahrenheit') ? 79 : 26, weather_code: 0, is_day: 1 } } }))
  await newTabPage.reload()
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await expect(newTabPage.locator('.newtab-shell')).toHaveAttribute('data-home-layout', 'workspace')
  const widget = newTabPage.getByTestId('header-widget')
  await expect(widget.locator('time')).toContainText(/\d{1,2}:\d{2}/)
  await widget.click()
  await newTabPage.getByRole('textbox', { name: '城市', exact: true }).fill('上海')
  await newTabPage.getByRole('button', { name: '搜尋', exact: true }).click()
  await expect(newTabPage.locator('section[aria-label="時間與天氣"] ul > li')).toHaveCount(1)
  await newTabPage.getByRole('button', { name: '上海 · 上海市 · 中国', exact: true }).click()
  await expect(widget).toContainText('26°C')
  await newTabPage.keyboard.press('Escape')
  await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'default-desktop.png') })
  await widget.click()
  await newTabPage.getByRole('combobox', { name: '溫度單位' }).selectOption('fahrenheit')
  await expect(widget).toContainText('79°F')
  await newTabPage.getByRole('combobox', { name: '溫度單位' }).selectOption('celsius')
  await expect(widget).toContainText('26°C')
  await newTabPage.getByRole('combobox', { name: '時間格式' }).selectOption('12')
  await newTabPage.getByRole('switch', { name: '顯示日期' }).click()
  await expect(newTabPage.getByRole('switch', { name: '顯示日期' })).not.toBeChecked()
  await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'settings.png') })
  await newTabPage.keyboard.press('Escape')
  await newTabPage.reload()
  await expect(widget).toContainText('26°C')
  await expect.poll(async () => extensionWorker.evaluate(async () => JSON.parse(String((await chrome.storage.sync.get('moorread:settings'))['moorread:settings'])).headerWidget)).toMatchObject({ hour12: true, showDate: false, location: { name: '上海 · 上海市 · 中国' } })
  await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'desktop.png') })
  for (const width of [375, 768, 1024]) {
    await newTabPage.setViewportSize({ width, height: 900 })
    await expect(widget).toBeVisible()
    expect(await newTabPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const widgetBox = await widget.boundingBox()
    const logoBox = await newTabPage.getByRole('heading', { name: '書野 Moorread', exact: true }).boundingBox()
    expect(widgetBox!.x).toBeGreaterThan(logoBox!.x + logoBox!.width)
    expect(logoBox!.height).toBeLessThan(25)
    await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', `width-${width}.png`) })
  }
  await widget.click()
  await newTabPage.getByRole('switch', { name: '顯示時間' }).click()
  await newTabPage.getByRole('switch', { name: '顯示天氣' }).click()
  await expect(widget).toHaveCount(0)
  await newTabPage.reload()
  await expect(widget).toHaveCount(0)
  await newTabPage.getByRole('button', { name: '開啟設定', exact: true }).click()
  await newTabPage.getByRole('switch', { name: '顯示時間' }).click()
  await expect(widget).toBeVisible()
})

test('handles permission denial, failed searches and unavailable weather', async ({ newTabPage, extensionWorker }) => {
  await newTabPage.addInitScript(() => {
    chrome.permissions.request = async () => false
  })
  await newTabPage.reload()
  const widget = newTabPage.getByTestId('header-widget')
  await widget.click()
  const cityInput = newTabPage.getByRole('textbox', { name: '城市', exact: true })
  await cityInput.fill('上海')
  await newTabPage.getByRole('button', { name: '搜尋', exact: true }).click()
  await expect(newTabPage.getByRole('alert')).toContainText('需要允許存取天氣服務')
  await expect(cityInput).toHaveValue('上海')
  await newTabPage.evaluate(() => {
    chrome.storage.sync.set = async () => {
      throw new Error('Test storage quota exceeded')
    }
  })
  const readStoredShowDate = () => extensionWorker.evaluate(async () => {
    const raw = (await chrome.storage.sync.get('moorread:settings'))['moorread:settings']
    const settings = typeof raw === 'string' ? JSON.parse(raw) : raw
    return settings.headerWidget?.showDate
  })
  const storedBefore = await readStoredShowDate()
  const showDate = newTabPage.getByRole('switch', { name: '顯示日期' })
  // showDate 預設為 true（weather.ts normalizeHeaderWidget），點擊後為 false。
  const beforeShowDate = await showDate.isChecked()
  await showDate.click()
  await expect(newTabPage.getByRole('alert')).toContainText('儲存失敗')
  // 樂觀更新保留使用者剛選的值（不回退），且失敗的寫入不得污染已持久化的值。
  await expect(showDate).toBeChecked({ checked: !beforeShowDate })
  expect(await readStoredShowDate()).toBe(storedBefore)
  await newTabPage.evaluate(() => {
    chrome.permissions.request = async () => true
  })
  await newTabPage.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ status: 503 }))
  await newTabPage.getByRole('button', { name: '搜尋', exact: true }).click()
  await expect(newTabPage.getByRole('alert')).toContainText('城市搜尋失敗')
  await expect(cityInput).toHaveValue('上海')
  await extensionWorker.evaluate(async () => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true, headerWidget: { location: { name: '上海', latitude: 31.22, longitude: 121.46 } } }) })
  })
  await newTabPage.reload()
  await expect(widget.locator('[aria-label^="暫時無法取得天氣"]')).toBeVisible()
  await expect(widget.locator('time')).toBeVisible()
})

test('refreshes weather when the cached reading expires after a slow first request', async ({ newTabPage, extensionWorker }) => {
  await newTabPage.addInitScript(() => {
    chrome.permissions.contains = async () => true
  })
  await extensionWorker.evaluate(async () => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true, headerWidget: { clockEnabled: false, location: { name: '上海', latitude: 31.22, longitude: 121.46 } } }) })
  })
  await newTabPage.clock.install({ time: new Date('2026-10-13T03:00:00Z') })
  let requestCount = 0
  let firstRequest: Route | undefined
  await newTabPage.route('https://api.open-meteo.com/**', async (route) => {
    requestCount += 1
    if (requestCount === 1) {
      firstRequest = route
      return
    }
    await route.fulfill({ json: { current: { temperature_2m: 21, weather_code: 0, is_day: 1 } } })
  })
  await newTabPage.reload()
  await expect.poll(() => requestCount).toBe(1)
  await newTabPage.clock.fastForward(5000)
  await firstRequest!.fulfill({ json: { current: { temperature_2m: 20, weather_code: 0, is_day: 1 } } })
  const widget = newTabPage.getByTestId('header-widget')
  await expect(widget).toContainText('20°C')
  await newTabPage.clock.runFor(15 * 60_000 + 1000)
  await expect.poll(() => requestCount).toBe(2)
  await expect(widget).toContainText('21°C')
})

test('disables weather in all open home pages without reloading', async ({ newTabPage, extensionContext, extensionWorker }) => {
  await extensionWorker.evaluate(async () => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true, headerWidget: { clockEnabled: false, location: { name: '上海', latitude: 31.22, longitude: 121.46 } } }) })
  })
  await newTabPage.reload()
  const other = await extensionContext.newPage()
  try {
    await other.goto(newTabPage.url())
    await expect(other.getByTestId('header-widget')).toBeVisible()
    await newTabPage.getByTestId('header-widget').click()
    await newTabPage.getByRole('switch', { name: '顯示天氣' }).click()
    await expect(newTabPage.getByTestId('header-widget')).toHaveCount(0)
    await expect(other.getByTestId('header-widget')).toHaveCount(0)
  }
  finally {
    await other.close()
  }
})

test('centers time, search and pinned bookmarks on fresh installs and collapses the clock when off', async ({ newTabPage, extensionWorker }) => {
  const pinnedUrl = 'https://example.com/hero-pinned'
  const bookmarkId = await extensionWorker.evaluate(async (url) => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true }) })
    await chrome.storage.local.set({ 'moorread:meta': JSON.stringify({ [url]: { pinnedAt: 1000 } }) })
    return (await chrome.bookmarks.create({ parentId: '1', title: 'Hero pinned', url })).id
  }, pinnedUrl)
  try {
    await newTabPage.reload()
    await newTabPage.setViewportSize({ width: 1440, height: 900 })
    const hero = newTabPage.locator('[data-home-hero]')
    await expect(newTabPage.locator('.newtab-shell')).toHaveAttribute('data-home-layout', 'centered')
    await expect(hero.getByTestId('header-widget').locator('time')).toContainText(/\d{1,2}:\d{2}/)
    await expect(newTabPage.locator('header').getByTestId('header-widget')).toHaveCount(0)
    await expect(newTabPage.locator('#moorread-search')).toHaveCount(1)
    await expect(hero.locator('#moorread-search')).toBeVisible()
    const pinned = hero.getByRole('navigation', { name: '置頂書籤', exact: true }).getByRole('link', { name: 'Hero pinned', exact: true })
    await expect(pinned).toHaveAttribute('href', pinnedUrl)
    await newTabPage.locator('#moorread-search').fill('Hero')
    await expect(hero.getByRole('navigation', { name: '置頂書籤', exact: true })).toHaveCount(0)
    await newTabPage.locator('#moorread-search').fill('')
    const searchTop = (await hero.locator('#moorread-search').boundingBox())!.y
    await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'centered.png') })

    await extensionWorker.evaluate(async () => {
      const settings = JSON.parse(String((await chrome.storage.sync.get('moorread:settings'))['moorread:settings']))
      await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ ...settings, headerWidget: { ...settings.headerWidget, clockEnabled: false, weatherEnabled: false } }) })
    })
    await newTabPage.reload()
    await expect(hero.locator('#moorread-search')).toBeVisible()
    await expect(newTabPage.getByTestId('header-widget')).toHaveCount(0)
    expect((await hero.locator('#moorread-search').boundingBox())!.y).toBeLessThan(searchTop - 80)
    await expect(hero.getByRole('link', { name: 'Hero pinned', exact: true })).toBeVisible()
    for (const width of [375, 1024]) {
      await newTabPage.setViewportSize({ width, height: 900 })
      expect(await newTabPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'centered-off.png') })

    // Without the search row, a narrow centered header is one row tall, so the top category bar sits right under it.
    await extensionWorker.evaluate(async () => {
      const settings = JSON.parse(String((await chrome.storage.sync.get('moorread:settings'))['moorread:settings']))
      await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ ...settings, appearance: { ...settings.appearance, homeLayout: 'centered', navLayout: 'top' } }) })
    })
    await newTabPage.setViewportSize({ width: 375, height: 900 })
    await newTabPage.reload()
    const categoryBar = newTabPage.locator('.workspace-layout > aside')
    await expect(categoryBar).toBeVisible()
    for (const scrollY of [0, 400]) {
      await newTabPage.evaluate(y => window.scrollTo(0, y), scrollY)
      await expect.poll(async () => {
        const header = (await newTabPage.locator('header').boundingBox())!
        const bar = (await categoryBar.boundingBox())!
        return Math.abs(bar.y - (header.y + header.height))
      }).toBeLessThanOrEqual(2)
    }
  }
  finally {
    await extensionWorker.evaluate(async (id) => {
      await chrome.bookmarks.remove(id)
      await chrome.storage.local.remove('moorread:meta')
    }, bookmarkId)
  }
})

test('follows the weather with a Clear Sky backdrop and respects the switch, theme and layout', async ({ newTabPage, extensionWorker }) => {
  const location = { name: '上海 · 上海市 · 中国', latitude: 31.22, longitude: 121.46 }
  const writeSettings = (extra: Record<string, unknown>) => extensionWorker.evaluate(async ({ location, extra }) => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true, headerWidget: { location }, ...extra }) })
  }, { location, extra })
  // A fresh cached reading is served before any permission check or request. Seed it from the page so
  // fetchedAt uses the same clock the widget compares against (earlier tests move the page clock).
  const seedReading = (code: number, isDay: boolean) => newTabPage.evaluate(async reading => chrome.storage.local.set({ 'yunji-weather:31.22:121.46:celsius': { ...reading, temperature: 15, fetchedAt: Date.now() } }), { code, isDay })
  const backdrop = newTabPage.locator('.weather-backdrop')

  await seedReading(61, true)
  await writeSettings({})
  await newTabPage.setViewportSize({ width: 1440, height: 900 })
  await newTabPage.reload()
  await expect(backdrop).toHaveAttribute('data-weather-scene', 'rain')
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true')
  await newTabPage.screenshot({ path: artifactPath('yunji-header-widget', 'weather-rain.png') })

  await seedReading(0, false)
  await newTabPage.reload()
  await expect(backdrop).toHaveAttribute('data-weather-scene', 'clear-night')

  await newTabPage.locator('[data-home-hero]').getByTestId('header-widget').click()
  await newTabPage.getByRole('switch', { name: /天氣背景/ }).click()
  await expect(backdrop).toHaveCount(0)
  await newTabPage.keyboard.press('Escape')
  await newTabPage.reload()
  await expect(newTabPage.locator('[data-home-hero]').getByTestId('header-widget')).toBeVisible()
  await expect(backdrop).toHaveCount(0)

  for (const appearance of [{ colorTheme: 'berry', homeLayout: 'centered' }, { colorTheme: 'sky', homeLayout: 'workspace' }]) {
    await writeSettings({ appearance })
    await newTabPage.reload()
    await expect(newTabPage.getByTestId('header-widget')).toBeVisible()
    await expect(backdrop).toHaveCount(0)
  }
  await newTabPage.evaluate(async () => chrome.storage.local.remove('yunji-weather:31.22:121.46:celsius'))
})

test('switches home layouts from the header and docks search into the header while scrolled', async ({ newTabPage, extensionWorker }) => {
  const folderId = await extensionWorker.evaluate(async () => {
    await chrome.storage.sync.set({ 'moorread:settings': JSON.stringify({ language: 'zh-TW', onboardingDismissed: true }) })
    const folder = await chrome.bookmarks.create({ parentId: '1', title: 'Dock fixture' })
    for (let i = 0; i < 30; i++)
      await chrome.bookmarks.create({ parentId: folder.id, title: `Dock ${i}`, url: `https://example.com/dock/${i}` })
    return folder.id
  })
  try {
    await newTabPage.setViewportSize({ width: 1440, height: 900 })
    await newTabPage.reload()
    const shell = newTabPage.locator('.newtab-shell')
    const more = newTabPage.getByRole('button', { name: '更多操作', exact: true })
    await expect(shell).toHaveAttribute('data-home-layout', 'centered')
    await expect(newTabPage.locator('header').getByRole('button', { name: /切換到.*佈局/ })).toHaveCount(0)
    await more.click()
    await newTabPage.getByRole('menuitem', { name: '切換到工作台佈局', exact: true }).click()
    await expect(shell).toHaveAttribute('data-home-layout', 'workspace')
    await expect(newTabPage.locator('header #moorread-search')).toBeVisible()
    await expect.poll(async () => extensionWorker.evaluate(async () => JSON.parse(String((await chrome.storage.sync.get('moorread:settings'))['moorread:settings'])).appearance.homeLayout)).toBe('workspace')
    await more.click()
    await newTabPage.getByRole('menuitem', { name: '切換到置中佈局', exact: true }).click()
    await expect(shell).toHaveAttribute('data-home-layout', 'centered')
    await expect(newTabPage.locator('[data-home-hero] #moorread-search')).toBeVisible()

    const docked = newTabPage.locator('header #moorread-search-docked')
    await expect(docked).toHaveCount(0)
    await newTabPage.locator('[data-home-hero] #moorread-search').focus()
    await newTabPage.evaluate(() => window.scrollTo({ top: 600 }))
    await expect(docked).toBeVisible()
    await expect(newTabPage.locator('header').getByTestId('header-widget')).toBeVisible()
    // Focus follows the box into the header, and the shortcut targets the visible copy.
    await expect(docked).toBeFocused()
    await docked.evaluate(element => (element as HTMLInputElement).blur())
    await newTabPage.keyboard.press('/')
    await expect(docked).toBeFocused()
    await newTabPage.evaluate(() => window.scrollTo({ top: 0 }))
    await expect(docked).toHaveCount(0)
    await expect(newTabPage.locator('[data-home-hero] #moorread-search')).toBeFocused()
    await expect(newTabPage.locator('header').getByTestId('header-widget')).toHaveCount(0)
  }
  finally {
    await extensionWorker.evaluate(async id => chrome.bookmarks.removeTree(id), folderId)
  }
})
