import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'docs/images')
const extensionPath = path.join(root, 'build/chrome-mv3-prod')
const profile = await mkdtemp(path.join(os.tmpdir(), 'yunji-docs-'))
const staging = path.join(profile, 'documentation-images')
const fixedTime = new Date('2026-10-15T02:08:00Z')
const folders = [
  { title: 'AI 工具', sites: [
    ['ChatGPT', 'https://chatgpt.com/', '討論想法、整理資料與輔助程式設計', ['AI', '對話']],
    ['Claude', 'https://claude.ai/', '長文閱讀、寫作與程式碼協作', ['AI', '寫作']],
    ['Perplexity', 'https://www.perplexity.ai/', '帶來源的搜尋與資料檢索', ['AI', '搜尋']],
    ['Hugging Face', 'https://huggingface.co/', '尋找開源模型、資料集和應用', ['AI', '開源']],
  ] },
  { title: '開發與文件', sites: [
    ['GitHub', 'https://github.com/', '程式碼託管、開源專案與團隊協作', ['開發', '開源']],
    ['MDN Web Docs', 'https://developer.mozilla.org/zh-TW/', '查閱 Web 標準和瀏覽器 API', ['開發', '文件']],
    ['React', 'https://react.dev/', '學習元件、狀態與介面開發', ['開發', '文件']],
    ['TypeScript', 'https://www.typescriptlang.org/', 'JavaScript 的型別系統與開發工具', ['開發', '文件']],
  ] },
  { title: '設計靈感', sites: [
    ['Figma', 'https://www.figma.com/', '協作設計介面與互動原型', ['設計', '工具']],
    ['Dribbble', 'https://dribbble.com/', '收集介面、插畫和品牌設計靈感', ['設計', '靈感']],
    ['Unsplash', 'https://unsplash.com/', '尋找照片與視覺素材', ['設計', '圖片']],
    ['Coolors', 'https://coolors.co/', '探索和儲存配色方案', ['設計', '配色']],
  ] },
  { title: '閱讀與生活', sites: [
    ['Wikipedia', 'https://www.wikipedia.org/', '從一個詞條開始探索新知識', ['閱讀', '百科']],
    ['少數派', 'https://sspai.com/', '數字工具與日常生活的使用經驗', ['閱讀', '效率']],
    ['家裡的 NAS', 'https://nas.example.com/', '照片、檔案和家庭備份的統一入口', ['生活', '自建服務']],
    ['OpenStreetMap', 'https://www.openstreetmap.org/', '開放地圖與出行參考', ['生活', '地圖']],
  ] },
]
let context
let page
const captured = []

try {
  await mkdir(output, { recursive: true })
  await mkdir(staging)
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  })
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 })
  const extensionId = new URL(worker.url()).host
  await worker.evaluate(async ({ folders, timestamp }) => {
    const metadata = {}
    const sites = {}
    for (const folder of folders) {
      const parent = await globalThis.chrome.bookmarks.create({ parentId: '1', title: folder.title })
      for (const [title, url, description, tags] of folder.sites) {
        const bookmark = await globalThis.chrome.bookmarks.create({ parentId: parent.id, title, url })
        sites[title] = { id: bookmark.id, url, title }
        metadata[url] = { description, tags }
      }
    }
    for (const [index, title] of ['GitHub', 'ChatGPT', 'Figma', 'MDN Web Docs', 'Wikipedia'].entries()) {
      Object.assign(metadata[sites[title].url], { pinnedAt: timestamp - index, pinnedOrder: index + 1 })
    }
    Object.assign(metadata[sites['家裡的 NAS'].url], { icon: '🏠', alternateUrls: ['http://nas.home.arpa/'] })
    for (const title of ['Hugging Face', 'Coolors', 'OpenStreetMap'])
      metadata[sites[title].url].inboxAt = timestamp
    const groups = [
      { id: 'docs-ai', title: 'AI 工作台', description: '提問、閱讀與檢索，一組開啟常用工具', pinnedAt: timestamp, pinnedOrder: 0, bookmarks: ['ChatGPT', 'Claude', 'Perplexity'].map(title => sites[title]) },
      { id: 'docs-dev', title: '前端開發', description: '從程式碼到文件，隨時查閱', bookmarks: ['GitHub', 'MDN Web Docs', 'React', 'TypeScript'].map(title => sites[title]) },
      { id: 'docs-design', title: '設計工具箱', description: '原型、靈感、照片與配色', bookmarks: ['Figma', 'Dribbble', 'Unsplash', 'Coolors'].map(title => sites[title]) },
    ]
    const sync = {
      'yunji-tab:settings': JSON.stringify({
        language: 'zh-TW',
        theme: 'light',
        onboardingDismissed: true,
        headerWidget: { location: { name: '台北', latitude: 25.03, longitude: 121.56 } },
      }),
    }
    for (const group of groups) {
      const key = `yunji-tab:bookmark-group:${group.id}`
      sync[key] = { version: 1, generation: 'docs', partCount: 1 }
      sync[`${key}:docs:0`] = JSON.stringify(group)
    }
    await globalThis.chrome.storage.local.set({ 'yunji-tab:meta': JSON.stringify(metadata) })
    await globalThis.chrome.storage.sync.set(sync)
  }, { folders, timestamp: fixedTime.getTime() })

  page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.clock.setFixedTime(fixedTime)
  // Only the isolated screenshot page receives fixture weather and permissions.
  await page.addInitScript(() => {
    globalThis.chrome.permissions.contains = async () => true
  })
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: 26, weather_code: 0, is_day: 1 } } }))

  async function waitForHome() {
    await expect(page.locator('.newtab-shell')).toHaveAttribute('data-newtab-ready', 'true')
    await expect(page.locator('article').filter({ hasText: 'GitHub' }).first()).toBeVisible()
    await expect(page.getByTestId('header-widget')).toContainText('26°C')
  }

  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await waitForHome()
  await expect(page.locator('[data-home-hero]')).toBeVisible()

  async function capture(name, target = page, keepPointer = false) {
    if (!keepPointer)
      await page.mouse.move(1430, 950)
    await expect(page.locator('[data-slot="bookmark-icon"] .animate-pulse:visible, [data-slot="group-member-icon"] .animate-pulse:visible')).toHaveCount(0, { timeout: 45_000 })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})))
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
    })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unexpected horizontal overflow')
    await target.screenshot({ path: path.join(staging, `${name}.png`), animations: 'disabled' })
    captured.push(name)
    console.log(`Captured ${name}`)
  }

  async function settings(tab) {
    await page.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '開啟設定', exact: true }).click()
    await page.getByRole('tab', { name: tab, exact: true }).click()
    return page.getByRole('dialog', { name: '設定', exact: true })
  }

  async function layout(homeLayout) {
    await worker.evaluate(async (homeLayout) => {
      const key = 'yunji-tab:settings'
      const value = JSON.parse((await globalThis.chrome.storage.sync.get(key))[key])
      await globalThis.chrome.storage.sync.set({ [key]: JSON.stringify({ ...value, appearance: { ...value.appearance, colorTheme: 'sky', homeLayout } }) })
    }, homeLayout)
    await page.reload()
    await waitForHome()
    await expect(page.locator('.newtab-shell')).toHaveAttribute('data-home-layout', homeLayout)
  }

  await capture('yunji-tab-overview')
  await page.getByTestId('header-widget').click()
  await expect(page.getByRole('switch', { name: '天氣背景', exact: true })).toBeVisible()
  await capture('time-and-weather', page.getByRole('dialog', { name: '時間與天氣', exact: true }))
  await page.keyboard.press('Escape')

  await layout('workspace')
  await capture('workspace-layout')
  await page.locator('#yunji-tab-search').fill('tag:AI')
  await expect(page.getByText('Hugging Face', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 620 })
  await capture('bookmark-search')
  await page.locator('#yunji-tab-search').fill('')

  await page.getByRole('button', { name: /^書籤組/ }).click()
  await page.getByRole('button', { name: '檢視書籤組 AI 工作台', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '開啟書籤 ChatGPT', exact: true })).toBeVisible()
  // Keep the pointer in the menu so it remains open during the screenshot.
  await page.getByRole('menuitem', { name: '開啟書籤 ChatGPT', exact: true }).hover()
  await capture('bookmark-groups', page, true)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 960 })

  await page.getByRole('button', { name: '開啟命令面板', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '命令面板', exact: true })).toBeVisible()
  await capture('command-palette', page.getByRole('dialog', { name: '命令面板', exact: true }))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^智慧分類/ }).click()
  await page.getByRole('button', { name: /^收件匣/ }).click()
  await page.getByRole('button', { name: '逐筆整理', exact: true }).click()
  await capture('inbox-triage', page.getByRole('dialog', { name: '整理收件匣', exact: true }))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^閱讀與生活/ }).first().click()
  await page.getByRole('button', { name: '家裡的 NAS 的更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: /編輯書籤/ }).click()
  await expect(page.getByRole('dialog', { name: '編輯書籤', exact: true })).toBeVisible()
  await expect(page.getByLabel('備用 URL（選填）')).toBeVisible()
  await capture('bookmark-editor', page.getByRole('dialog'))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^開發與文件/ }).first().click()
  await page.getByRole('button', { name: '整理', exact: true }).click()
  await page.getByRole('menuitem', { name: '批次管理', exact: true }).click()
  for (const title of ['GitHub', 'MDN Web Docs', 'React'])
    await page.getByRole('checkbox', { name: `選取 ${title}`, exact: true }).check()
  await page.setViewportSize({ width: 1440, height: 620 })
  await capture('bookmark-bulk-actions')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '離開批次管理', exact: true }).click()

  await capture('appearance-settings', await settings('外觀'))
  await page.getByRole('radio', { name: '藍墨版畫', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^置頂/ }).first().click()
  await capture('engraving-theme')

  await layout('workspace')
  const dataDialog = await settings('資料與隱私')
  await capture('backup-and-restore', dataDialog)
  await page.getByRole('heading', { name: 'WebDAV 備份', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  await capture('webdav-backup', dataDialog)
  for (const name of captured)
    await copyFile(path.join(staging, `${name}.png`), path.join(output, `${name}.png`))
  console.log(`Updated ${captured.length} screenshots in docs/images`)
}
catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(os.tmpdir(), 'yunji-docs-error.png') }).catch(() => {})
    console.error(await page.locator('body').textContent().catch(() => 'Page unavailable'))
  }
  throw error
}
finally {
  try {
    await context?.close()
  }
  finally {
    await rm(profile, { recursive: true, force: true })
  }
}
