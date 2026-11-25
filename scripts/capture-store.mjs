import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'store-listing', 'screenshots-1280x800')
const extensionPath = path.join(root, 'build/chrome-mv3-prod')
const profile = await mkdtemp(path.join(os.tmpdir(), 'moorread-store-'))
const staging = path.join(profile, 'shots')
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
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--no-default-browser-check'],
  })
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 })
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
    for (const [index, title] of ['GitHub', 'ChatGPT', 'Figma', 'MDN Web Docs', 'Wikipedia'].entries())
      Object.assign(metadata[sites[title].url], { pinnedAt: timestamp - index, pinnedOrder: index + 1 })
    Object.assign(metadata[sites['家裡的 NAS'].url], { icon: '🏠', alternateUrls: ['http://nas.home.arpa/'] })
    const groups = [
      { id: 'store-ai', title: 'AI 工作台', description: '提問、閱讀與檢索，一組開啟常用工具', pinnedAt: timestamp, pinnedOrder: 0, bookmarks: ['ChatGPT', 'Claude', 'Perplexity'].map(title => sites[title]) },
      { id: 'store-dev', title: '前端開發', description: '從程式碼到文件，隨時查閱', bookmarks: ['GitHub', 'MDN Web Docs', 'React', 'TypeScript'].map(title => sites[title]) },
      { id: 'store-design', title: '設計工具箱', description: '原型、靈感、照片與配色', bookmarks: ['Figma', 'Dribbble', 'Unsplash', 'Coolors'].map(title => sites[title]) },
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
      sync[key] = { version: 1, generation: 'store', partCount: 1 }
      sync[`${key}:store:0`] = JSON.stringify(group)
    }
    await globalThis.chrome.storage.local.set({ 'yunji-tab:meta': JSON.stringify(metadata) })
    await globalThis.chrome.storage.sync.set(sync)
  }, { folders, timestamp: fixedTime.getTime() })

  page = await context.newPage()
  page.setDefaultTimeout(15000)
  await page.clock.setFixedTime(fixedTime)
  await page.addInitScript(() => {
    globalThis.chrome.permissions.contains = async () => true
  })
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: 26, weather_code: 0, is_day: 1 } } }))

  async function waitForHome() {
    await expect(page.locator('.newtab-shell')).toHaveAttribute('data-newtab-ready', 'true')
    await expect(page.locator('article').filter({ hasText: 'GitHub' }).first()).toBeVisible()
  }

  async function capture(name, target = page, keepPointer = false) {
    if (!keepPointer) await page.mouse.move(1270, 790)
    await page.waitForTimeout(2500)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})))
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
    })
    await target.screenshot({ path: path.join(staging, `${name}.png`), animations: 'disabled' })
    captured.push(name)
    console.log(`Captured ${name}`)
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

  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.evaluate(async (icons) => {
    const cache = await caches.open('yunji-tab:favicons:v4')
    for (const [domain, label, color] of icons) {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(0, 0, 128, 128, 28)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 64px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 64, 68)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
      await cache.put(url, new Response(blob, {
        headers: { 'Content-Type': 'image/png', 'x-yunji-tab-cached-at': String(Date.now()) },
      }))
    }
  }, [
    ['chatgpt.com', 'C', '#10a37f'],
    ['claude.ai', 'C', '#d97757'],
    ['perplexity.ai', 'P', '#20808d'],
    ['huggingface.co', 'H', '#ffbd45'],
    ['github.com', 'G', '#24292f'],
    ['developer.mozilla.org', 'M', '#1b1b1b'],
    ['react.dev', 'R', '#087ea4'],
    ['typescriptlang.org', 'T', '#3178c6'],
    ['figma.com', 'F', '#a259ff'],
    ['dribbble.com', 'D', '#ea4c89'],
    ['unsplash.com', 'U', '#111111'],
    ['coolors.co', 'C', '#0066ff'],
    ['wikipedia.org', 'W', '#54595d'],
    ['sspai.com', '少', '#d71a1b'],
    ['nas.example.com', '家', '#2f6f4f'],
    ['openstreetmap.org', 'O', '#7ebc6f'],
  ])
  await page.reload()
  await waitForHome()
  await page.waitForTimeout(4000)
  await capture('1-overview')

  await layout('workspace')
  await capture('5-workspace')

  await page.locator('#yunji-tab-search').fill('tag:AI')
  await expect(page.getByText('Hugging Face', { exact: true })).toBeVisible()
  await capture('2-search')
  await page.locator('#yunji-tab-search').fill('')

  await page.getByRole('button', { name: /^書籤組/ }).click()
  await page.getByRole('button', { name: '檢視書籤組 AI 工作台', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '開啟書籤 ChatGPT', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: '開啟書籤 ChatGPT', exact: true }).hover()
  await capture('3-groups', page, true)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^開發與文件/ }).first().click()
  await page.getByRole('button', { name: '整理', exact: true }).click()
  await page.getByRole('menuitem', { name: '批次管理', exact: true }).click()
  for (const title of ['GitHub', 'MDN Web Docs', 'React'])
    await page.getByRole('checkbox', { name: `選取 ${title}`, exact: true }).check()
  await capture('4-bulk-actions')

  for (const name of captured)
    await copyFile(path.join(staging, `${name}.png`), path.join(output, `${name}.png`))
  console.log(`Updated ${captured.length} screenshots`)
}
catch (error) {
  if (page) console.error(await page.locator('body').textContent().catch(() => 'Page unavailable'))
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
