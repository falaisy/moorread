import type { BrowserContext, Page, Worker } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { deriveThemePalette } from '../src/lib/palette'
import { expect, test } from './extension.fixture'

const PALETTE_KEY = 'moorread:theme-palette'
const SETTINGS_KEY = 'moorread:settings'
const CACHE_KEY = 'moorread:theme-palette-cache'

interface FirstPaint {
  background: string
  borderStrong: string
  dark: boolean
}

function expectedBackground(baseColor: string, mode: 'light' | 'dark') {
  return deriveThemePalette(baseColor, mode)!['--background']
}

async function readPalette(worker: Worker) {
  return worker.evaluate(async (key) => {
    const raw = (await chrome.storage.local.get(key))[key]
    if (!raw)
      return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }, PALETTE_KEY)
}

async function patchSettings(worker: Worker, patch: Record<string, unknown>) {
  await worker.evaluate(async ({ key, patch }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const settings = raw ? JSON.parse(String(raw)) : {}
    const appearance = {
      ...(settings.appearance ?? {}),
      ...((patch.appearance as Record<string, unknown> | undefined) ?? {}),
    }
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, ...patch, appearance }),
    })
  }, { key: SETTINGS_KEY, patch })
}

async function writePalette(
  worker: Worker,
  palette: { baseColor: string, savedBaseColor: string, locked: boolean },
) {
  await worker.evaluate(async ({ key, palette }) => {
    await chrome.storage.local.set({ [key]: JSON.stringify(palette) })
  }, { key: PALETTE_KEY, palette })
}

function rootVar(page: Page, name: string) {
  return page.evaluate(
    token => document.documentElement.style.getPropertyValue(token).trim(),
    name,
  )
}

interface ThemeWrite {
  background: string
  dark: boolean
  at: number
}

async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as {
      __firstPaint?: unknown
      __themeWrites?: unknown[]
    }
    const writes: Array<{ background: string, dark: boolean, at: number }> = []
    target.__themeWrites = writes
    const snapshot = () => {
      const root = document.documentElement
      return {
        background: root.style.getPropertyValue('--background').trim(),
        borderStrong: root.style.getPropertyValue('--border-strong').trim(),
        dark: root.classList.contains('dark'),
      }
    }
    let observed = false
    const attach = () => {
      const root = document.documentElement
      if (!root || observed)
        return
      observed = true
      new MutationObserver(() => {
        const state = snapshot()
        writes.push({ background: state.background, dark: state.dark, at: performance.now() })
      }).observe(root, { attributes: true, attributeFilter: ['style'] })
    }
    // 'interactive' 在 defer／module 腳本執行前觸發，可捕捉 bootstrapTheme 的第一次寫入。
    document.addEventListener('readystatechange', attach)
    attach()
    document.addEventListener('DOMContentLoaded', () => {
      target.__firstPaint = snapshot()
    }, { once: true })
  })
}

function readThemeWrites(page: Page) {
  return page.evaluate(() => {
    const target = window as unknown as { __themeWrites?: ThemeWrite[] }
    return target.__themeWrites ?? []
  })
}

interface PaintTimings {
  firstPaint: number | null
  fcp: number | null
}

function readPaintTimings(page: Page): Promise<PaintTimings> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('paint')
    const first = entries.find(item => item.name === 'first-paint')
    const contentful = entries.find(item => item.name === 'first-contentful-paint')
    return {
      firstPaint: first?.startTime ?? null,
      fcp: contentful?.startTime ?? null,
    }
  })
}

// 瀏覽器的 paint 計時可能在 load 之後才回報，需等待而非單次讀取。
async function waitForPaintTimings(page: Page) {
  await expect.poll(async () => {
    const timings = await readPaintTimings(page)
    return timings.firstPaint !== null && timings.fcp !== null ? timings : null
  }, { timeout: 10_000, intervals: [100, 200, 500] }).not.toBeNull()
  return readPaintTimings(page)
}

function readFirstPaint(page: Page) {
  return page.evaluate(() => {
    const target = window as unknown as { __firstPaint?: FirstPaint }
    return target.__firstPaint ?? null
  })
}

async function readCache(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, CACHE_KEY)
}

test('first paint applies the saved custom palette in light mode', async ({
  extensionWorker,
  newTabPage,
}, testInfo) => {
  await writePalette(extensionWorker, {
    baseColor: '#ff0000',
    savedBaseColor: '#ff0000',
    locked: false,
  })
  await patchSettings(extensionWorker, { theme: 'light' })
  await newTabPage.reload()
  await expect.poll(() => rootVar(newTabPage, '--background'))
    .toBe(expectedBackground('#ff0000', 'light'))

  // 初始化時應把正式儲存的配色鏡像到首繪快取。
  await expect.poll(async () => (await readCache(newTabPage))?.baseColor).toBe('#ff0000')

  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(() => readFirstPaint(newTabPage)).not.toBeNull()
  const firstPaint = await readFirstPaint(newTabPage)
  expect(firstPaint?.background).toBe(expectedBackground('#ff0000', 'light'))
  expect(firstPaint?.dark).toBe(false)

  const writes = (await readThemeWrites(newTabPage)).filter(entry => entry.background)
  expect(writes[0]?.background).toBe(expectedBackground('#ff0000', 'light'))
  // 第一次 --background 寫入必須早於瀏覽器的第一次內容繪製（React 首次渲染），
  // 才代表使用者看到的第一個畫面已是自訂配色而非預設色。
  const paint = await waitForPaintTimings(newTabPage)
  expect(writes[0]!.at).toBeLessThan(paint.fcp!)

  fs.writeFileSync(
    testInfo.outputPath('first-paint-light.json'),
    JSON.stringify({
      firstPaint,
      cache: await readCache(newTabPage),
      writes,
      paint,
    }, null, 2),
  )
  await newTabPage.screenshot({ path: testInfo.outputPath('first-paint-light.png') })
})

test('a new tab in the same profile paints the palette before React', async ({
  extensionContext,
  extensionId,
  extensionWorker,
}, testInfo) => {
  await writePalette(extensionWorker, {
    baseColor: '#ff0000',
    savedBaseColor: '#ff0000',
    locked: false,
  })
  await patchSettings(extensionWorker, { theme: 'light' })

  const page = await extensionContext.newPage()
  await recordFirstPaint(page)
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await expect.poll(async () => (await readThemeWrites(page)).length).toBeGreaterThan(0)
  const writes = (await readThemeWrites(page)).filter(entry => entry.background)
  expect(writes[0]?.background).toBe(expectedBackground('#ff0000', 'light'))
  const paint = await waitForPaintTimings(page)
  expect(writes[0]!.at).toBeLessThan(paint.fcp!)
  fs.writeFileSync(
    testInfo.outputPath('first-paint-new-tab.json'),
    JSON.stringify({ writes, paint }, null, 2),
  )
  await page.close()
})

test('dark first paint keeps the dark class and the dark palette', async ({
  extensionWorker,
  newTabPage,
}, testInfo) => {
  await writePalette(extensionWorker, {
    baseColor: '#ff0000',
    savedBaseColor: '#ff0000',
    locked: false,
  })
  await patchSettings(extensionWorker, { theme: 'dark' })
  // 第一次載入寫入明暗與配色快取；第二次才等同已使用深色者重新開啟。
  await newTabPage.reload()
  await expect(newTabPage.locator('html')).toHaveClass(/dark/)
  await newTabPage.reload()
  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(() => readFirstPaint(newTabPage)).not.toBeNull()

  const writes = (await readThemeWrites(newTabPage)).filter(entry => entry.background)
  expect(writes[0]?.background).toBe(expectedBackground('#ff0000', 'dark'))
  expect(writes[0]?.dark).toBe(true)
  const paint = await waitForPaintTimings(newTabPage)
  expect(writes[0]!.at).toBeLessThan(paint.fcp!)
  fs.writeFileSync(
    testInfo.outputPath('first-paint-dark.json'),
    JSON.stringify({ writes, paint, cache: await readCache(newTabPage) }, null, 2),
  )
  await newTabPage.screenshot({ path: testInfo.outputPath('first-paint-dark.png') })
})

test('saving a new palette updates the first-paint cache', async ({
  extensionWorker,
  newTabPage,
}, testInfo) => {
  await patchSettings(extensionWorker, { theme: 'light' })
  await newTabPage.reload()
  await newTabPage.getByRole('button', { name: '開啟設定', exact: true }).click()
  await newTabPage.getByRole('tab', { name: '視覺', exact: true }).click()
  await newTabPage.getByRole('textbox', { name: 'Base Color', exact: true }).fill('#00ff00')
  await newTabPage.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(newTabPage.getByText('已儲存主題')).toBeVisible()
  await expect.poll(async () => (await readCache(newTabPage))?.baseColor).toBe('#00ff00')

  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(async () => (await readThemeWrites(newTabPage)).length).toBeGreaterThan(0)
  const writes = (await readThemeWrites(newTabPage)).filter(entry => entry.background)
  expect(writes[0]?.background).toBe(expectedBackground('#00ff00', 'light'))

  fs.writeFileSync(
    testInfo.outputPath('first-paint-after-save.json'),
    JSON.stringify({ cache: await readCache(newTabPage), writes }, null, 2),
  )
})

test('corrupt or version-mismatched cache falls back to the default theme safely', async ({
  extensionWorker,
  newTabPage,
}) => {
  await writePalette(extensionWorker, {
    baseColor: '#00ff00',
    savedBaseColor: '#00ff00',
    locked: false,
  })
  await patchSettings(extensionWorker, { theme: 'light' })
  await newTabPage.reload()
  await expect.poll(() => rootVar(newTabPage, '--background'))
    .toBe(expectedBackground('#00ff00', 'light'))

  const staleBackground = expectedBackground('#ff00ff', 'light')
  await newTabPage.evaluate(key => localStorage.setItem(key, '{not-json'), CACHE_KEY)
  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(() => readFirstPaint(newTabPage)).not.toBeNull()
  expect((await readFirstPaint(newTabPage))?.background).not.toBe(staleBackground)
  // 快取失效只影響首繪；正式儲存仍會補上正確配色。
  await expect.poll(() => rootVar(newTabPage, '--background'))
    .toBe(expectedBackground('#00ff00', 'light'))

  await newTabPage.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ v: 99, baseColor: '#ff00ff' }))
  }, CACHE_KEY)
  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(() => readFirstPaint(newTabPage)).not.toBeNull()
  expect((await readFirstPaint(newTabPage))?.background).not.toBe(staleBackground)
  // 版本不符的快取不得被套用。
  const writes = await readThemeWrites(newTabPage)
  expect(writes.some(entry => entry.background === staleBackground)).toBe(false)
})

test('restoring appearance defaults clears the cache and the palette', async ({
  extensionWorker,
  newTabPage,
}) => {
  await writePalette(extensionWorker, {
    baseColor: '#00ff00',
    savedBaseColor: '#00ff00',
    locked: false,
  })
  await patchSettings(extensionWorker, { theme: 'light' })
  await newTabPage.reload()
  await expect.poll(async () => (await readCache(newTabPage))?.baseColor).toBe('#00ff00')

  await newTabPage.getByRole('button', { name: '開啟設定', exact: true }).click()
  await newTabPage.getByRole('tab', { name: '版面', exact: true }).click()
  await newTabPage.getByRole('button', { name: '恢復預設', exact: true }).click()
  await expect(newTabPage.getByText('已恢復預設設定')).toBeVisible()
  await expect.poll(async () => readCache(newTabPage)).toBeNull()
  await expect.poll(() => readPalette(extensionWorker)).toBeNull()

  await recordFirstPaint(newTabPage)
  await newTabPage.reload()
  await expect.poll(() => readFirstPaint(newTabPage)).not.toBeNull()
  // 首繪不得再套用已清除的自訂配色。
  const clearedBackground = expectedBackground('#00ff00', 'light')
  expect((await readFirstPaint(newTabPage))?.background).not.toBe(clearedBackground)
  const writes = await readThemeWrites(newTabPage)
  expect(writes.some(entry => entry.background === clearedBackground)).toBe(false)
  await expect.poll(() => rootVar(newTabPage, '--background')).toBe('216 30% 94%')
  // 裝飾邊框維持既有主題預設，不受 border-strong 影響。
  expect(await rootVar(newTabPage, '--border')).toBe('216 22% 83%')
  expect(await rootVar(newTabPage, '--border-strong')).toBe('216 22% 56%')
})

test('icon buttons use the stronger interaction border', async ({
  extensionWorker,
  newTabPage,
}) => {
  // 側欄收合時才會渲染這兩個純圖示按鈕。
  await patchSettings(extensionWorker, { appearance: { sidebarCollapsed: true } })
  await newTabPage.reload()
  const iconButton = newTabPage.locator('button.border-border-strong').first()
  await expect(iconButton).toBeVisible()
  const borderColors = await newTabPage.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.borderColor = 'hsl(var(--border-strong))'
    const inputProbe = document.createElement('div')
    inputProbe.style.borderColor = 'hsl(var(--input))'
    document.body.append(probe, inputProbe)
    const strong = getComputedStyle(probe).borderColor
    const input = getComputedStyle(inputProbe).borderColor
    probe.remove()
    inputProbe.remove()
    return { strong, input }
  })
  await expect(iconButton).toHaveCSS('border-top-color', borderColors.strong)
})

test('browser restart restores the palette on the first paint', async ({}, testInfo) => {
  const extensionPath = path.resolve(process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod')
  const profileDir = testInfo.outputPath('restart-profile')
  fs.mkdirSync(profileDir, { recursive: true })
  const launch = () => chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-TW',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })

  let first: BrowserContext | undefined
  let second: BrowserContext | undefined
  try {
    first = await launch()
    let [worker] = first.serviceWorkers()
    worker ??= await first.waitForEvent('serviceworker', { timeout: 30_000 })
    const extensionId = new URL(worker.url()).host
    const page = await first.newPage()
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({
        [key]: JSON.stringify({ baseColor: '#ff0000', savedBaseColor: '#ff0000', locked: false }),
      })
    }, PALETTE_KEY)
    await worker.evaluate(async (key) => {
      await chrome.storage.sync.set({
        [key]: JSON.stringify({ theme: 'light', language: 'zh-TW' }),
      })
    }, SETTINGS_KEY)
    await page.reload()
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CACHE_KEY)).not.toBeNull()
    await first.close()
    first = undefined

    second = await launch()
    const restarted = await second.newPage()
    await recordFirstPaint(restarted)
    await restarted.goto(`chrome-extension://${extensionId}/newtab.html`)
    await expect.poll(async () => (await readThemeWrites(restarted)).length).toBeGreaterThan(0)
    const writes = (await readThemeWrites(restarted)).filter(entry => entry.background)
    expect(writes[0]?.background).toBe(expectedBackground('#ff0000', 'light'))
    const paint = await waitForPaintTimings(restarted)
    expect(writes[0]!.at).toBeLessThan(paint.fcp!)
    fs.writeFileSync(
      testInfo.outputPath('first-paint-after-restart.json'),
      JSON.stringify({ writes, paint }, null, 2),
    )
  }
  finally {
    await second?.close()
    await first?.close()
  }
})
