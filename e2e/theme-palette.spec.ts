import type { Page, Worker } from '@playwright/test'
import { colorThemeVars } from '../src/lib/appearance'
import { expect, test } from './extension.fixture'

const PALETTE_KEY = 'moorread:theme-palette'
const SETTINGS_KEY = 'moorread:settings'

async function openVisualSettings(page: Page) {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
  await page.getByRole('tab', { name: '視覺', exact: true }).click()
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

async function readPalette(worker: Worker) {
  return worker.evaluate(async (key) => {
    const raw = (await chrome.storage.local.get(key))[key]
    if (!raw)
      return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }, PALETTE_KEY)
}

function rootVar(page: Page, name: string) {
  return page.evaluate(
    token => document.documentElement.style.getPropertyValue(token).trim(),
    name,
  )
}

test('derives WCAG-safe tokens from a base color and rejects invalid input', async ({ newTabPage }) => {
  await openVisualSettings(newTabPage)
  const input = newTabPage.getByRole('textbox', { name: 'Base Color', exact: true })

  await input.fill('#ff0000')
  await expect.poll(() => rootVar(newTabPage, '--background')).toMatch(/^0 \d{1,3}% \d{1,3}%$/)
  await expect(newTabPage.getByText('預覽中，尚未儲存')).toBeVisible()

  // 以瀏覽器實際 computed color 驗證，而不是只比對數字。
  const ratios = await newTabPage.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const read = (name: string) => root.getPropertyValue(name).trim()
    const toRgb = (value: string) => {
      const probe = document.createElement('div')
      probe.style.color = `hsl(${value})`
      document.body.append(probe)
      const computed = getComputedStyle(probe).color
      probe.remove()
      return (computed.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
    }
    const luminance = ([r, g, b]: number[]) => {
      const channel = (value: number) => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const contrast = (a: number[], b: number[]) => {
      const first = luminance(a)
      const second = luminance(b)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }
    const background = read('--background')
    return {
      text: contrast(toRgb(read('--foreground')), toRgb(background)),
      muted: contrast(toRgb(read('--muted-foreground')), toRgb(background)),
      primary: contrast(toRgb(read('--primary-foreground')), toRgb(read('--primary'))),
      ring: contrast(toRgb(read('--ring')), toRgb(background)),
    }
  })
  expect(ratios.text).toBeGreaterThanOrEqual(4.5)
  expect(ratios.muted).toBeGreaterThanOrEqual(4.5)
  expect(ratios.primary).toBeGreaterThanOrEqual(4.5)
  expect(ratios.ring).toBeGreaterThanOrEqual(3)

  const before = await rootVar(newTabPage, '--primary')
  await input.fill('#12')
  await input.blur()
  await expect(newTabPage.getByRole('alert')).toHaveText('請輸入有效的 Hex 顏色，例如 #2F6FED')
  expect(await rootVar(newTabPage, '--primary')).toBe(before)

  await input.fill('#2f6fed')
  await expect(newTabPage.getByRole('alert')).toHaveCount(0)
})

test('locks the color against random, then randomizes after unlocking', async ({ newTabPage }) => {
  await openVisualSettings(newTabPage)
  const input = newTabPage.getByRole('textbox', { name: 'Base Color', exact: true })
  await input.fill('#2f6fed')

  await newTabPage.getByRole('switch', { name: '鎖定顏色' }).click()
  await expect(newTabPage.getByText('已鎖定：隨機不會改變目前顏色')).toBeVisible()
  const lockedPrimary = await rootVar(newTabPage, '--primary')
  await newTabPage.getByRole('button', { name: '隨機', exact: true }).click()
  await expect(input).toHaveValue('#2f6fed')
  expect(await rootVar(newTabPage, '--primary')).toBe(lockedPrimary)

  await newTabPage.getByRole('switch', { name: '鎖定顏色' }).click()
  const before = await input.inputValue()
  await newTabPage.getByRole('button', { name: '隨機', exact: true }).click()
  await expect(input).not.toHaveValue(before)
})

test('saves to storage, survives reload, and restores the last saved color', async ({
  extensionWorker,
  newTabPage,
}) => {
  await openVisualSettings(newTabPage)
  const input = newTabPage.getByRole('textbox', { name: 'Base Color', exact: true })
  await input.fill('#ff0000')
  await newTabPage.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(newTabPage.getByText('已儲存主題')).toBeVisible()

  await expect.poll(async () => (await readPalette(extensionWorker))?.baseColor).toBe('#ff0000')
  const savedPrimary = await rootVar(newTabPage, '--primary')

  await newTabPage.reload()
  await expect.poll(() => rootVar(newTabPage, '--primary')).toBe(savedPrimary)

  await openVisualSettings(newTabPage)
  const reopened = newTabPage.getByRole('textbox', { name: 'Base Color', exact: true })
  await expect(reopened).toHaveValue('#ff0000')

  await reopened.fill('#00ff00')
  await expect(reopened).toHaveValue('#00ff00')
  await newTabPage.getByRole('button', { name: '還原', exact: true }).click()
  await expect(reopened).toHaveValue('#ff0000')
  expect(await rootVar(newTabPage, '--primary')).toBe(savedPrimary)
})

test('keeps dark startup, search and layout behavior while the palette is active', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async () => {
    const created = await chrome.bookmarks.search({ title: 'Theme Search Target' })
    if (created.length === 0)
      await chrome.bookmarks.create({ parentId: '1', title: 'Theme Search Target', url: 'https://example.com/theme-search' })
  })
  await writePalette(extensionWorker, {
    baseColor: '#2f6fed',
    savedBaseColor: '#2f6fed',
    locked: false,
  })
  await patchSettings(extensionWorker, {
    theme: 'dark',
    bookmarkViewMode: 'compact',
    appearance: { bookmarkGridCols: 6, folderGridCols: 3 },
  })

  // 第一次載入讓主題快取寫入；第二次載入才等同「已使用深色的使用者重開」。
  await newTabPage.reload()
  await expect(newTabPage.locator('html')).toHaveClass(/dark/)
  await newTabPage.reload()
  expect(await newTabPage.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
  await expect.poll(() => rootVar(newTabPage, '--background')).not.toBe('')

  const background = await newTabPage.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).not.toBe('rgb(255, 255, 255)')

  // 版面與精簡模式由既有資料流決定；主題引擎不得改動這些 class。
  const layoutClass = await newTabPage.evaluate(
    () => document.querySelector('main div.grid')?.className ?? '',
  )
  expect(layoutClass).toContain('gap-2')

  const input = newTabPage.locator('#moorread-search')
  await input.fill('Theme Search')
  await expect(newTabPage.locator('#moorread-search-results')).toBeVisible()
})

test('keeps the six existing color themes when no custom palette exists', async ({
  extensionWorker,
  newTabPage,
}) => {
  await extensionWorker.evaluate(async key => chrome.storage.local.remove(key), PALETTE_KEY)
  await patchSettings(extensionWorker, {
    theme: 'light',
    appearance: { colorTheme: 'berry', accentColor: 'neutral' },
  })
  await newTabPage.reload()
  await expect.poll(() => rootVar(newTabPage, '--background'))
    .toBe(colorThemeVars.berry.light['--background'])
  await expect.poll(() => rootVar(newTabPage, '--foreground'))
    .toBe(colorThemeVars.berry.light['--foreground'])
})
