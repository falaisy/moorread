import type { Page, Worker } from '@playwright/test'
import fs from 'node:fs'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

const SETTINGS_KEY = 'moorread:settings'
const TRASH_KEY = 'moorread:trash'

// 六組既有主題 × 明暗；實際量測對話框的繪製表面與強邊界按鈕顏色，計算 WCAG 對比。
const THEMES = ['default', 'sky', 'graphite', 'meadow', 'dawn', 'berry'] as const
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

async function seedTrash(worker: Worker) {
  await worker.evaluate(async (trashKey) => {
    const now = Date.now()
    await chrome.storage.local.set({
      [trashKey]: JSON.stringify([{
        id: 'e2e-contrast-trash',
        label: 'E2E Contrast Trash',
        deletedAt: now,
        expiresAt: now + 86_400_000,
        roots: [{
          id: 'e2e-contrast-root',
          title: 'E2E Contrast Trash',
          url: 'https://example.com/contrast',
          children: [],
        }],
        categoryMeta: {},
      }]),
    })
  }, TRASH_KEY)
}

async function setTheme(worker: Worker, theme: string, mode: string) {
  await worker.evaluate(async ({ key, theme, mode }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const settings = raw ? JSON.parse(String(raw)) : {}
    const appearance = { ...(settings.appearance ?? {}), colorTheme: theme }
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...settings, theme: mode, appearance }),
    })
  }, { key: SETTINGS_KEY, theme, mode })
}

async function openMenuItem(page: Page, name: RegExp) {
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}

async function measureDialogControl(page: Page, buttonName: RegExp) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const button = dialog.getByRole('button', { name: buttonName }).first()
  await expect(button).toBeVisible()
  const colors = await button.evaluate((element) => {
    const border = getComputedStyle(element).borderTopColor
    // 向上找出第一個實際繪製的不透明背景（DialogContent 為 bg-card）。
    let node: Element | null = element.parentElement
    let surface = 'rgba(0, 0, 0, 0)'
    while (node) {
      const background = getComputedStyle(node).backgroundColor
      if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
        surface = background
        break
      }
      node = node.parentElement
    }
    return { border, surface }
  })
  return { ...colors, ratio: contrastRatio(colors.border, colors.surface) }
}

for (const theme of THEMES) {
  test(`${theme} theme keeps dialog icon button borders at 3:1`, async ({
    extensionWorker,
    newTabPage,
  }) => {
    test.setTimeout(120_000)
    const results: Record<string, { border: string, surface: string, ratio: number }> = {}

    // 分頁工作階段只能從目前視窗擷取，先開一個可儲存的分頁；以攔截回應避免依賴網路。
    const source = await newTabPage.context().newPage()
    await source.route('https://example.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Example</title><p>contrast fixture</p>',
    }))
    await source.goto('https://example.com')

    for (const mode of MODES) {
      await seedTrash(extensionWorker)
      await setTheme(extensionWorker, theme, mode)
      await newTabPage.reload()
      await expect(newTabPage.getByRole('button', { name: '更多操作', exact: true })).toBeVisible()

      await openMenuItem(newTabPage, /^開啟垃圾桶與歷史記錄/)
      const activity = await measureDialogControl(newTabPage, /^還原 /)
      results[`${mode}-activity`] = activity
      expect(activity.ratio, `${theme} ${mode} ActivityDialog`).toBeGreaterThanOrEqual(3)
      await newTabPage.keyboard.press('Escape')
      await expect(newTabPage.getByRole('dialog')).toHaveCount(0)

      await newTabPage.bringToFront()
      await openMenuItem(newTabPage, /管理分頁工作階段/)
      await expect(newTabPage.getByRole('dialog')).toBeVisible()
      await newTabPage.getByRole('button', { name: '儲存視窗', exact: true }).click()
      const restoreButton = newTabPage
        .getByRole('dialog')
        .getByRole('button', { name: /^還原工作階段/ })
        .first()
      await expect(restoreButton).toBeVisible()
      const sessions = await measureDialogControl(newTabPage, /^還原工作階段/)
      results[`${mode}-sessions`] = sessions
      expect(sessions.ratio, `${theme} ${mode} TabSessionsDialog`).toBeGreaterThanOrEqual(3)
      await newTabPage.keyboard.press('Escape')
      await expect(newTabPage.getByRole('dialog')).toHaveCount(0)
    }

    await source.close()

    fs.writeFileSync(
      artifactPath(`theme-dialog-contrast-${theme}.json`),
      JSON.stringify(results, null, 2),
    )
  })
}
