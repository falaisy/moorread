import type { BrowserContext, Locator, Page, Worker } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'
import { createProfile, removeProfile } from './support/e2e-profile'

const META_KEY = 'moorread:local-background'
const CACHE_NAME = 'moorread:background:v1'
const CACHE_KEY = 'https://moorread.local/local-background'
const SETTINGS_KEY = 'moorread:settings'

async function setTheme(worker: Worker, mode: string) {
  await worker.evaluate(async ({ key, mode }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const settings = raw ? JSON.parse(String(raw)) : {}
    const appearance = { ...(settings.appearance ?? {}), colorTheme: 'default' }
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, theme: mode, appearance }),
    })
  }, { key: SETTINGS_KEY, mode })
}

async function clearLocalBackground(page: Page) {
  await page.evaluate(async ({ cacheName, cacheKey, metaKey }) => {
    const cache = await caches.open(cacheName)
    await cache.delete(cacheKey)
    await chrome.storage.local.remove(metaKey)
  }, { cacheName: CACHE_NAME, cacheKey: CACHE_KEY, metaKey: META_KEY })
}

async function shellBackground(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.querySelector('.newtab-shell') as HTMLElement).backgroundImage)
}

async function cacheHasImage(page: Page) {
  return page.evaluate(async ({ cacheName, cacheKey }) => {
    const cache = await caches.open(cacheName)
    return Boolean(await cache.match(cacheKey))
  }, { cacheName: CACHE_NAME, cacheKey: CACHE_KEY })
}

async function readMeta(page: Page) {
  return page.evaluate(async metaKey =>
    (await chrome.storage.local.get(metaKey))[metaKey] ?? null, META_KEY)
}

async function makePng(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 36
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('no 2d context')
    context.fillStyle = '#38bdf8'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  return Buffer.from(base64, 'base64')
}

async function openVisualTab(page: Page) {
  await page.getByRole('button', { name: '開啟設定' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: '視覺' }).click()
  return dialog
}

async function uploadBackground(page: Page, dialog: Locator) {
  const buffer = await makePng(page)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'background.png',
    mimeType: 'image/png',
    buffer,
  })
  await expect.poll(() => readMeta(page), { timeout: 10_000 })
    .toMatchObject({ enabled: true, fileName: 'background.png' })
  await expect.poll(() => shellBackground(page), { timeout: 10_000 }).toContain('blob:')
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

const EXTENSION_PATH = path.resolve(process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod')
const RESTART_LAUNCH_ARGS = [
  `--disable-extensions-except=${EXTENSION_PATH}`,
  `--load-extension=${EXTENSION_PATH}`,
  '--no-first-run',
  '--no-default-browser-check',
]

function launchIsolatedBrowser(userDataDir: string) {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-TW',
    args: RESTART_LAUNCH_ARGS,
  })
}

async function firstWorker(context: BrowserContext) {
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 })
  return worker
}

// 以 profile 路徑比對實際 Chromium 行程，確認整個瀏覽器程序已結束（不是只關分頁）。
function browserProcessCount(userDataDir: string): number {
  const script = '(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:M025_PROFILE_DIR.ToLower()) }).Count'
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, M025_PROFILE_DIR: userDataDir },
  })
  return Number.parseInt(output.trim(), 10) || 0
}

test.beforeEach(async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async (key) => {
    const stored = (await chrome.storage.sync.get(key))[key]
    const settings = stored ? JSON.parse(String(stored)) : {}
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...settings, language: 'zh-TW' }) })
  }, SETTINGS_KEY)
  await setTheme(extensionWorker, 'light')
  await newTabPage.reload()
  await clearLocalBackground(newTabPage)
  await newTabPage.reload()
})

test('local background is off by default', async ({ newTabPage }) => {
  expect(await shellBackground(newTabPage)).toBe('none')
  expect(await readMeta(newTabPage)).toBeNull()
  expect(await cacheHasImage(newTabPage)).toBe(false)

  const dialog = await openVisualTab(newTabPage)
  await expect(dialog.getByRole('switch', { name: '啟用本機背景' }))
    .toHaveAttribute('aria-checked', 'false')
  await expect(dialog.getByText('尚未選擇圖片')).toBeVisible()
  await closeDialog(newTabPage)
})

test('choosing an image shows it on the new tab page', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'background.png',
    mimeType: 'image/png',
    buffer: await makePng(newTabPage),
  })

  await expect(dialog.getByRole('switch', { name: '啟用本機背景' }))
    .toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByText('background.png')).toBeVisible()
  await expect(dialog.locator('img[src^="blob:"]')).toBeVisible()
  await expect.poll(() => shellBackground(newTabPage)).toContain('blob:')
  await newTabPage.screenshot({ path: artifactPath('p4-background-enabled.png') })

  await closeDialog(newTabPage)
})

test('background survives a page reload', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)
  await closeDialog(newTabPage)

  await newTabPage.reload()
  await expect.poll(() => shellBackground(newTabPage)).toContain('blob:')
  expect(await readMeta(newTabPage)).toMatchObject({ enabled: true })
})

test('disabling restores the theme background', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)

  await dialog.getByRole('switch', { name: '啟用本機背景' }).click()
  await expect(dialog.getByRole('switch', { name: '啟用本機背景' }))
    .toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => shellBackground(newTabPage)).toBe('none')

  const background = await newTabPage.evaluate(() =>
    getComputedStyle(document.querySelector('.newtab-shell') as HTMLElement).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  await closeDialog(newTabPage)
})

test('disabling keeps the stored image', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)
  await dialog.getByRole('switch', { name: '啟用本機背景' }).click()
  await expect(dialog.getByRole('switch', { name: '啟用本機背景' }))
    .toHaveAttribute('aria-checked', 'false')

  expect(await cacheHasImage(newTabPage)).toBe(true)
  expect(await readMeta(newTabPage)).toMatchObject({ enabled: false })
  await closeDialog(newTabPage)
})

test('removing the image clears the cache and the flag', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)

  await dialog.getByRole('button', { name: '移除圖片' }).click()
  await expect.poll(() => cacheHasImage(newTabPage)).toBe(false)
  expect(await readMeta(newTabPage)).toBeNull()
  await expect.poll(() => shellBackground(newTabPage)).toBe('none')
  await closeDialog(newTabPage)
})

test('light and dark switching keeps the image', async ({ extensionWorker, newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)
  await closeDialog(newTabPage)

  await setTheme(extensionWorker, 'dark')
  await newTabPage.reload()

  await expect(newTabPage.locator('html')).toHaveClass(/dark/)
  await expect.poll(() => shellBackground(newTabPage)).toContain('blob:')
})

test('a missing image falls back to the theme background without a white screen', async ({ newTabPage }) => {
  await newTabPage.evaluate(async (metaKey) => {
    await chrome.storage.local.set({
      [metaKey]: { v: 1, enabled: true, fileName: 'missing.png', updatedAt: Date.now() },
    })
  }, META_KEY)
  await newTabPage.reload()

  await expect.poll(() => shellBackground(newTabPage)).toBe('none')
  expect(await readMeta(newTabPage)).toBeNull()
  const background = await newTabPage.evaluate(() =>
    getComputedStyle(document.querySelector('.newtab-shell') as HTMLElement).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  await expect(newTabPage.locator('.newtab-shell').getByRole('main')).toBeVisible()
  await newTabPage.screenshot({ path: artifactPath('p4-background-fallback.png') })
})

test('resetting appearance keeps the local background', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await uploadBackground(newTabPage, dialog)
  await closeDialog(newTabPage)

  await newTabPage.getByRole('button', { name: '開啟設定' }).click()
  const settings = newTabPage.getByRole('dialog')
  await settings.getByRole('tab', { name: '版面' }).click()
  await settings.getByRole('button', { name: '恢復預設' }).click()
  await expect(settings.getByText('已恢復預設設定')).toBeVisible()
  await closeDialog(newTabPage)

  expect(await readMeta(newTabPage)).toMatchObject({ enabled: true })
  expect(await cacheHasImage(newTabPage)).toBe(true)
  await expect.poll(() => shellBackground(newTabPage)).toContain('blob:')
})

test('P1 search still works', async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async () => {
    const existing = await chrome.bookmarks.search({ url: 'https://example.com/p4-search' })
    if (existing.length === 0) {
      await chrome.bookmarks.create({
        parentId: '1',
        title: 'P4 Search Regression',
        url: 'https://example.com/p4-search',
      })
    }
  })
  await newTabPage.reload()

  await newTabPage.locator('#moorread-search').fill('P4 Search')
  const panel = newTabPage.locator('#moorread-search-results')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('option').filter({ hasText: 'P4 Search Regression' }).first())
    .toBeVisible()
  await newTabPage.locator('#moorread-search').press('Escape')
  await expect(panel).toHaveCount(0)
})

test('P2 theme tokens still apply', async ({ newTabPage }) => {
  const dialog = await openVisualTab(newTabPage)
  await dialog.getByRole('radio', { name: '深色' }).click()
  await expect(newTabPage.locator('html')).toHaveClass(/dark/)

  const state = await newTabPage.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'hsl(var(--background))'
    document.body.appendChild(probe)
    const token = getComputedStyle(probe).color
    probe.remove()
    return {
      dark: document.documentElement.classList.contains('dark'),
      token,
      body: getComputedStyle(document.body).backgroundColor,
    }
  })
  expect(state.dark).toBe(true)
  expect(state.body).toBe(state.token)
  expect(state.body).not.toBe('rgb(249, 248, 246)')
  await closeDialog(newTabPage)
})

test('background survives a full browser restart with the same user data', async () => {
  test.setTimeout(180_000)
  const userDataDir = await createProfile('moorread-e2e-restart-', 'local-background-restart')
  let context = await launchIsolatedBrowser(userDataDir)
  try {
    const worker = await firstWorker(context)
    const extensionId = new URL(worker.url()).host
    let page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')

    const dialog = await openVisualTab(page)
    await uploadBackground(page, dialog)
    await closeDialog(page)
    expect(await cacheHasImage(page)).toBe(true)
    expect(await readMeta(page)).toMatchObject({ enabled: true, fileName: 'background.png' })
    await page.screenshot({ path: artifactPath('p4-restart-before.png') })

    // 關閉前確認 Chromium 行程確實佔用這個 profile。
    expect(browserProcessCount(userDataDir)).toBeGreaterThan(0)
    await context.close()
    // 等整個瀏覽器程序結束，而非只關閉分頁或 context。
    await expect.poll(() => browserProcessCount(userDataDir), { timeout: 30_000, intervals: [250] }).toBe(0)

    // 以同一個 User Data 重新啟動，不是換新 profile。
    context = await launchIsolatedBrowser(userDataDir)
    const restartedWorker = await firstWorker(context)
    expect(new URL(restartedWorker.url()).host).toBe(extensionId)
    page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')

    await expect.poll(() => shellBackground(page), { timeout: 15_000 }).toContain('blob:')
    expect(await cacheHasImage(page)).toBe(true)
    expect(await readMeta(page)).toMatchObject({ enabled: true, fileName: 'background.png' })

    const restartedDialog = await openVisualTab(page)
    await expect(restartedDialog.getByRole('switch', { name: '啟用本機背景' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect(restartedDialog.locator('img[src^="blob:"]')).toBeVisible()
    await page.screenshot({ path: artifactPath('p4-restart-after.png') })
    await closeDialog(page)
  }
  finally {
    await context.close().catch(() => undefined)
    await removeProfile(userDataDir)
  }
})

test('P3 keyboard focus ring still works', async ({ newTabPage }) => {
  await newTabPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  let reached = false
  for (let i = 0; i < 30; i += 1) {
    await newTabPage.keyboard.press('Tab')
    reached = await newTabPage.evaluate(() =>
      document.activeElement?.getAttribute('aria-label') === '開啟設定')
    if (reached)
      break
  }
  expect(reached).toBe(true)
  await newTabPage.waitForTimeout(400)

  const shadow = await newTabPage.evaluate(() => {
    const element = document.activeElement as HTMLElement
    return { focusVisible: element.matches(':focus-visible'), shadow: getComputedStyle(element).boxShadow }
  })
  expect(shadow.focusVisible).toBe(true)
  expect(shadow.shadow).toContain('0px 0px 0px 2px')
  expect(shadow.shadow).toContain('0px 0px 0px 4px')
})
