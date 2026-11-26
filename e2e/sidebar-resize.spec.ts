import type { Page, Worker } from '@playwright/test'
import { expect, test } from './extension.fixture'

// Sidebar resize coverage (MR-261126-002-D3):
// dragging only previews the width in the UI; the store/storage is written once
// on release, Escape/pointercancel restores the previous width, and cancelling a
// drag that started from the collapsed state keeps the sidebar collapsed.

const SETTINGS_KEY = 'moorread:settings'
const RESIZE_HANDLE = 'button[aria-label="調整側欄寬度"]'
const SIDEBAR_WIDTH_DEFAULT = 232
const SIDEBAR_WIDTH_COLLAPSED = 56

async function ready(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1800)
}

async function setAppearance(worker: Worker, appearance: Record<string, unknown>) {
  await worker.evaluate(async ({ key, appearance }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    await chrome.storage.sync.set({
      [key]: JSON.stringify({ ...s, appearance: { ...(s.appearance ?? {}), ...appearance } }),
    })
  }, { key: SETTINGS_KEY, appearance })
}

async function readAppearance(worker: Worker): Promise<Record<string, unknown>> {
  return await worker.evaluate(async ({ key }) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    return (s?.appearance ?? {}) as Record<string, unknown>
  }, { key: SETTINGS_KEY })
}

async function gridWidth(page: Page): Promise<number> {
  const cols = await page.evaluate(() => {
    const el = document.querySelector('.workspace-layout')
    return el instanceof HTMLElement ? el.style.gridTemplateColumns : ''
  })
  const match = /^([0-9.]+)px/.exec(cols ?? '')
  return match ? Math.round(Number(match[1])) : -1
}

// Presses the resize handle and moves the pointer by `deltaX` without releasing it.
async function startDrag(page: Page, deltaX: number) {
  const handle = page.locator(RESIZE_HANDLE)
  await expect(handle).toBeVisible({ timeout: 3000 })
  const box = await handle.boundingBox()
  if (!box)
    throw new Error('resize handle has no bounding box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps: 10 })
  await page.waitForTimeout(150)
}

async function resetExpanded(worker: Worker, page: Page) {
  await setAppearance(worker, { sidebarCollapsed: false, sidebarWidth: SIDEBAR_WIDTH_DEFAULT })
  await page.reload()
  await ready(page)
}

test('drag previews the width live but persists only on release', async ({ extensionWorker, newTabPage }) => {
  await ready(newTabPage)
  await resetExpanded(extensionWorker, newTabPage)

  const before = await gridWidth(newTabPage)
  expect(before, 'sidebar should start at the default width').toBe(SIDEBAR_WIDTH_DEFAULT)

  await startDrag(newTabPage, 80)

  // The UI already shows the new width while the pointer is still down...
  const during = await gridWidth(newTabPage)
  expect(during, 'drag should preview a wider sidebar').toBeGreaterThan(before + 40)
  // ...but nothing has been persisted to storage yet.
  const storedDuring = await readAppearance(extensionWorker)
  expect(storedDuring.sidebarWidth, 'storage must not change during the drag').toBe(before)

  await newTabPage.mouse.up()

  // On release the previewed width is committed exactly once and survives.
  await expect
    .poll(async () => (await readAppearance(extensionWorker)).sidebarWidth, { timeout: 3000 })
    .toBe(during)
  expect(await gridWidth(newTabPage), 'committed width should stay after release').toBe(during)
})

test('Escape cancels an in-progress resize and restores the previous width', async ({ extensionWorker, newTabPage }) => {
  await ready(newTabPage)
  await resetExpanded(extensionWorker, newTabPage)

  const before = await gridWidth(newTabPage)
  expect(before).toBe(SIDEBAR_WIDTH_DEFAULT)

  await startDrag(newTabPage, 90)
  expect(await gridWidth(newTabPage), 'drag should preview a wider sidebar').toBeGreaterThan(before + 40)

  await newTabPage.keyboard.press('Escape')
  await expect.poll(async () => gridWidth(newTabPage), { timeout: 3000 }).toBe(before)

  await newTabPage.mouse.up()
  const stored = await readAppearance(extensionWorker)
  expect(stored.sidebarWidth, 'cancelled resize must not persist a new width').toBe(before)
})

test('cancelling a drag that started collapsed keeps the sidebar collapsed', async ({ extensionWorker, newTabPage }) => {
  await ready(newTabPage)
  await setAppearance(extensionWorker, { sidebarCollapsed: true, sidebarWidth: SIDEBAR_WIDTH_DEFAULT })
  await newTabPage.reload()
  await ready(newTabPage)

  expect(await gridWidth(newTabPage), 'sidebar should start collapsed').toBe(SIDEBAR_WIDTH_COLLAPSED)

  await startDrag(newTabPage, 70)
  expect(await gridWidth(newTabPage), 'drag from collapsed should preview expanded').toBeGreaterThan(SIDEBAR_WIDTH_COLLAPSED)

  await newTabPage.keyboard.press('Escape')
  await expect.poll(async () => gridWidth(newTabPage), { timeout: 3000 }).toBe(SIDEBAR_WIDTH_COLLAPSED)

  await newTabPage.mouse.up()
  const stored = await readAppearance(extensionWorker)
  expect(stored.sidebarCollapsed, 'cancelled expand must restore the collapsed state').toBe(true)
  expect(stored.sidebarWidth, 'collapsed width is preserved').toBe(SIDEBAR_WIDTH_DEFAULT)
})
