import type { Page, Worker } from '@playwright/test'
import fs from 'node:fs'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

const SETTINGS_KEY = 'moorread:settings'
const META_KEY = 'moorread:meta'

const TAG_BOOKMARK_TITLE = 'E2E P3 Tag Chip'
const TAG_BOOKMARK_URL = 'https://example.com/e2e-p3-tag-chip'
const TAG_NAME = 'p3-tag-chip-label'

const MODES = ['light', 'dark'] as const

function parseRgb(value: string): number[] {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value)
  if (!match)
    throw new Error(`unexpected color: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function luminance([r, g, b]: number[]): number {
  const channel = (value: number) => {
    const ratio = value / 255
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(first: string, second: string): number {
  const a = luminance(parseRgb(first))
  const b = luminance(parseRgb(second))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

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

async function seedTaggedBookmark(worker: Worker) {
  const alreadyExists = await worker.evaluate(async ({ title, url }) => {
    const existing = await chrome.bookmarks.search({ url })
    if (existing.length > 0)
      return true
    await chrome.bookmarks.create({ parentId: '1', title, url })
    return false
  }, { title: TAG_BOOKMARK_TITLE, url: TAG_BOOKMARK_URL })

  await worker.evaluate(async ({ key, url, tag }) => {
    const raw = (await chrome.storage.local.get(key))[key]
    const meta = raw ? JSON.parse(String(raw)) : {}
    meta[url] = { ...(meta[url] ?? {}), tags: [tag] }
    await chrome.storage.local.set({ [key]: JSON.stringify(meta) })
  }, { key: META_KEY, url: TAG_BOOKMARK_URL, tag: TAG_NAME })

  return alreadyExists
}

async function resolveToken(page: Page, expression: string) {
  return page.evaluate((value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, expression)
}

// 讓書籤健康檢查停在「等待網站權限」，任務保持 running，header 才會顯示計數 badge。
// 這是測試替身：不修改產品程式碼，也不真的授予權限。
async function startPendingHealthScan(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value: async () => false,
    })
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: () => new Promise<boolean>(() => {}),
    })
  })

  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '開啟書籤健康檢查' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /^檢查 \d+ 個書籤$/ }).click()
  await expect(dialog.getByRole('button', { name: /^正在檢查/ })).toBeDisabled()
  // 關閉對話框後 header 才回到可用性樹；掃描仍停在等待權限，任務維持 running。
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.beforeEach(async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async (key) => {
    const stored = (await chrome.storage.sync.get(key))[key]
    const settings = stored ? JSON.parse(String(stored)) : {}
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...settings, language: 'zh-TW' }) })
  }, SETTINGS_KEY)

  await seedTaggedBookmark(extensionWorker)
  await newTabPage.reload()
})

for (const mode of MODES) {
  test(`${mode} badge uses semantic foreground at 4.5:1`, async ({
    extensionWorker,
    newTabPage,
  }) => {
    test.setTimeout(90_000)
    await setTheme(extensionWorker, mode)
    await newTabPage.reload()

    const trigger = newTabPage.getByRole('button', { name: '更多操作', exact: true })
    await expect(trigger).toBeVisible()

    await startPendingHealthScan(newTabPage)

    const badge = trigger.locator('span').filter({ hasText: '1' }).first()
    await expect(badge).toBeVisible({ timeout: 10_000 })

    const colors = await badge.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.color, background: style.backgroundColor }
    })
    const ratio = contrastRatio(colors.color, colors.background)

    fs.writeFileSync(
      artifactPath(`p3-badge-contrast-${mode}.json`),
      JSON.stringify({ mode, ...colors, ratio: Number(ratio.toFixed(2)) }, null, 2),
    )
    await badge.screenshot({ path: artifactPath(`p3-badge-${mode}.png`) })

    expect(ratio, `${mode} badge contrast`).toBeGreaterThanOrEqual(4.5)
  })
}

for (const mode of MODES) {
  test(`${mode} header icon buttons draw focus ring on theme background`, async ({
    extensionWorker,
    newTabPage,
  }) => {
    await setTheme(extensionWorker, mode)
    await newTabPage.reload()
    await expect(newTabPage.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()

    await newTabPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    let reached = false
    for (let i = 0; i < 30; i += 1) {
      await newTabPage.keyboard.press('Tab')
      reached = await newTabPage.evaluate(() =>
        document.activeElement?.getAttribute('aria-label') === '開啟設定')
      if (reached)
        break
    }
    expect(reached, 'keyboard focus reaches the settings icon button').toBe(true)

    // 按鈕的 box-shadow 有 200ms 過渡，等它穩定後再讀實際繪製值。
    await newTabPage.waitForTimeout(400)

    const background = await resolveToken(newTabPage, 'hsl(var(--background))')
    const ring = await newTabPage.evaluate(() => {
      const element = document.activeElement as HTMLElement
      return {
        label: element.getAttribute('aria-label'),
        focusVisible: element.matches(':focus-visible'),
        shadow: getComputedStyle(element).boxShadow,
      }
    })

    fs.writeFileSync(
      artifactPath(`p3-focus-ring-${mode}.json`),
      JSON.stringify({ mode, background, ...ring }, null, 2),
    )
    await newTabPage.screenshot({ path: artifactPath(`p3-focus-ring-${mode}.png`) })

    expect(ring.label).toBe('開啟設定')
    expect(ring.focusVisible).toBe(true)
    expect(ring.shadow).toContain('0px 0px 0px 2px')
    expect(ring.shadow).toContain('0px 0px 0px 4px')
    // ring-offset 的顏色必須是主題背景色，而不是瀏覽器預設白框。
    expect(ring.shadow).toContain(background)
    if (mode === 'dark')
      expect(background).not.toBe('rgb(255, 255, 255)')
  })
}

test('settings tabs show keyboard focus ring and no ring after mouse click', async ({
  extensionWorker,
  newTabPage,
}) => {
  await setTheme(extensionWorker, 'dark')
  await newTabPage.reload()

  await newTabPage.getByRole('button', { name: '開啟設定' }).click()
  const dialog = newTabPage.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const visualTab = dialog.getByRole('tab', { name: '視覺' })
  await visualTab.click()
  await expect(visualTab).toHaveAttribute('aria-selected', 'true')

  // 滑鼠點擊只產生 :focus，不得留下鍵盤焦點圈。
  const mouseState = await visualTab.evaluate(element => ({
    focusVisible: element.matches(':focus-visible'),
    shadow: getComputedStyle(element).boxShadow,
  }))
  expect(mouseState.focusVisible).toBe(false)
  expect(mouseState.shadow, 'no focus ring after mouse click')
    .not
    .toContain('0px 0px 0px 2px')

  // 鍵盤回到 tab 時必須顯示焦點圈，且 offset 使用主題背景色。
  await newTabPage.keyboard.press('Tab')
  await newTabPage.keyboard.press('Shift+Tab')
  await expect(visualTab).toBeFocused()

  const background = await resolveToken(newTabPage, 'hsl(var(--background))')
  const keyboardState = await visualTab.evaluate(element => ({
    focusVisible: element.matches(':focus-visible'),
    shadow: getComputedStyle(element).boxShadow,
  }))
  fs.writeFileSync(
    artifactPath('p3-focus-ring-settings-tab-dark.json'),
    JSON.stringify({ background, mouseState, keyboardState }, null, 2),
  )
  await newTabPage.screenshot({ path: artifactPath('p3-focus-ring-settings-tab-dark.png') })

  expect(keyboardState.focusVisible).toBe(true)
  expect(keyboardState.shadow).toContain('0px 0px 0px 2px')
  expect(keyboardState.shadow).toContain('0px 0px 0px 4px')
  expect(keyboardState.shadow).toContain(background)
})

test('small text tokens are applied without clipping', async ({
  extensionWorker,
  newTabPage,
}) => {
  await setTheme(extensionWorker, 'light')
  await newTabPage.reload()

  const rootFontSize = await newTabPage.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize))

  // 書籤卡片可點標籤 chip 用 text-2xs (0.6875rem)。
  const chip = newTabPage.locator(`[title="${TAG_NAME}"]`).first()
  await expect(chip).toBeVisible()
  const chipMetrics = await chip.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      height: rect.height,
      width: rect.width,
    }
  })
  expect(chipMetrics.fontSize / rootFontSize).toBeCloseTo(0.6875, 2)
  expect(chipMetrics.height, 'tag chip stays compact').toBeLessThan(26)

  // 搜尋快捷鍵提示用 text-2xs。
  const hint = newTabPage.locator('button[aria-label="開啟命令面板"]').first()
  await expect(hint).toBeVisible()
  const hintFontSize = await hint.evaluate(element =>
    Number.parseFloat(getComputedStyle(element).fontSize))
  expect(hintFontSize / rootFontSize).toBeCloseTo(0.6875, 2)

  // 設定頁「書籤外觀」的卡片風格標籤用 text-2xs，且不得被容器裁切。
  await newTabPage.getByRole('button', { name: '開啟設定' }).click()
  const dialog = newTabPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: '書籤外觀' }).click()

  const section = dialog.locator('section').filter({ hasText: '卡片細節' })
  await expect(section).toBeVisible()
  const labels = section.locator('span.text-2xs')
  const labelCount = await labels.count()
  expect(labelCount).toBeGreaterThanOrEqual(3)

  const labelMetrics = await labels.evaluateAll(nodes => nodes.map((node) => {
    const element = node as HTMLElement
    const parent = element.parentElement as HTMLElement
    return {
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      scrollWidth: element.scrollWidth,
      parentWidth: parent.clientWidth,
    }
  }))

  fs.writeFileSync(
    artifactPath('p3-small-text-metrics.json'),
    JSON.stringify({ rootFontSize, chipMetrics, hintFontSize, labelMetrics }, null, 2),
  )

  for (const metric of labelMetrics) {
    expect(metric.fontSize / rootFontSize).toBeCloseTo(0.6875, 2)
    expect(metric.scrollWidth, 'card style label is not clipped')
      .toBeLessThanOrEqual(metric.parentWidth + 1)
  }

  expect(await newTabPage.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('search interaction still works with the resized shortcut hint', async ({ newTabPage }) => {
  const input = newTabPage.locator('#moorread-search')
  await input.fill('E2E P3 Tag')

  const panel = newTabPage.locator('#moorread-search-results')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('option').filter({ hasText: TAG_BOOKMARK_TITLE }).first())
    .toBeVisible()

  const hint = newTabPage.locator('button[aria-label="開啟命令面板"]').first()
  await expect(hint).toBeVisible()
  const layout = await hint.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const container = element.closest('[data-morph="search"]')!.getBoundingClientRect()
    return { right: rect.right, containerRight: container.right, height: rect.height }
  })
  expect(layout.right).toBeLessThanOrEqual(layout.containerRight + 1)
  expect(layout.height).toBeGreaterThan(0)

  await input.press('Escape')
  await expect(panel).toHaveCount(0)
})
