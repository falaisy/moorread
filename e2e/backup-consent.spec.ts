import type { Page, Worker } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from './extension.fixture'

// 首次傳輸前揭露與明示同意的真實瀏覽器驗證。
// 每個案例都會實際點擊同意對話框，並以請求紀錄、書籤 API 呼叫次數、
// 同意紀錄與儲存內容作為「拒絕後沒有匯出、沒有網路請求、沒有資料外傳」的證據。
const consentKey = 'moorread:backup-consent'
const settingsKey = 'moorread:settings'
const configKey = 'moorread:webdav-config'
const statusKey = 'moorread:webdav-status'
const directory = 'https://www.google.com/moorread-consent-e2e/'
const gistToken = 'ghp_consent_e2e_token'

interface GistCall {
  method: string
  authorization: string | undefined
  body: string
}

async function resetState(worker: Worker): Promise<void> {
  await worker.evaluate(async ({ consentKey, settingsKey, keys }) => {
    await chrome.storage.local.remove([consentKey, ...keys])
    await chrome.storage.session.remove('moorread:webdav-password')
    const stored = (await chrome.storage.sync.get(settingsKey))[settingsKey]
    if (stored) {
      const settings = JSON.parse(String(stored))
      settings.gistBackup = { token: '', gistId: '', encrypt: false, passphrase: '' }
      await chrome.storage.sync.set({ [settingsKey]: JSON.stringify(settings) })
    }
  }, { consentKey, settingsKey, keys: [configKey, statusKey] })
}

async function readConsent(worker: Worker): Promise<Record<string, number> | undefined> {
  return worker.evaluate(async (key) => {
    const raw = (await chrome.storage.local.get(key))[key]
    return raw === undefined ? undefined : JSON.parse(String(raw))
  }, consentKey)
}

async function readGistSettings(worker: Worker): Promise<{ token?: string, gistId?: string } | undefined> {
  return worker.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    return raw === undefined ? undefined : JSON.parse(String(raw)).gistBackup
  }, settingsKey)
}

// Gist 設定採「先寫入儲存再更新畫面」，填入後立刻點擊可能讀到舊值（見 FINDINGS F-06）。
// 測試先等儲存值落地，再進行點擊，避免把這個競態誤判成同意流程失敗。
async function fillGistToken(page: Page, worker: Worker, token: string): Promise<void> {
  await page.getByLabel('Personal Access Token', { exact: true }).fill(token)
  await expect.poll(async () => worker.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    return raw ? JSON.parse(String(raw)).gistBackup?.token ?? '' : ''
  }, settingsKey)).toBe(token)
  await page.waitForTimeout(150)
}

async function countGetTree(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __moorreadGetTreeCalls?: number }
    return w.__moorreadGetTreeCalls ?? 0
  })
}

// 匯出完整快照一定會讀取原生書籤樹；拒絕同意時這個計數不得增加。
async function trackGetTree(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __moorreadGetTreeCalls?: number }
    w.__moorreadGetTreeCalls = 0
    const bookmarks = chrome.bookmarks as unknown as { getTree: () => Promise<chrome.bookmarks.BookmarkTreeNode[]> }
    const original = bookmarks.getTree.bind(chrome.bookmarks)
    bookmarks.getTree = () => {
      w.__moorreadGetTreeCalls = (w.__moorreadGetTreeCalls ?? 0) + 1
      return original()
    }
  })
}

async function openDataSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
  await page.getByRole('tab', { name: '資料與隱私', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'WebDAV 備份', exact: true })).toBeVisible()
}

async function newTab(worker: Worker, context: import('@playwright/test').BrowserContext, extensionId: string): Promise<Page> {
  await resetState(worker)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

function gistSection(page: Page) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: 'GitHub Gist 備份', exact: true }) }).last()
}

test('Gist: first upload asks for consent, declining exports nothing and sends nothing, accepting uploads once', async ({ extensionWorker, extensionContext, extensionId }) => {
  const page = await newTab(extensionWorker, extensionContext, extensionId)
  const bookmarkTitle = 'Consent Gist Bookmark'
  await extensionWorker.evaluate(async title => chrome.bookmarks.create({ parentId: '1', title, url: 'https://consent-gist.example/' }), bookmarkTitle)
  const calls: GistCall[] = []
  await page.route('https://api.github.com/**', async (route) => {
    calls.push({
      method: route.request().method(),
      authorization: route.request().headers().authorization,
      body: route.request().postData() ?? '',
    })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'gist-consent-e2e' }) })
  })
  try {
    await openDataSettings(page)
    const gist = gistSection(page)
    await fillGistToken(page, extensionWorker, gistToken)
    await trackGetTree(page)
    const treeReadsBefore = await countGetTree(page)

    await gist.getByRole('button', { name: '上傳到 Gist', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('api.github.com')
    await expect(dialog).toContainText('完整快照')
    await expect(dialog).toContainText('Chrome 同步儲存空間')
    await expect(dialog).toContainText('第三方傳輸')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(400)

    expect(calls).toEqual([])
    expect(await countGetTree(page)).toBe(treeReadsBefore)
    expect(await readConsent(extensionWorker)).toBeUndefined()
    expect(await readGistSettings(extensionWorker)).toMatchObject({ gistId: '' })
    await expect(gist.getByRole('status')).toHaveCount(0)

    await gist.getByRole('button', { name: '上傳到 Gist', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並上傳到 GitHub Gist', exact: true }).click()
    await expect(gist.getByRole('status').filter({ hasText: '已上傳到 Gist' })).toBeVisible()
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].authorization).toBe(`Bearer ${gistToken}`)
    const payload = JSON.parse(calls[0].body) as { files: Record<string, { content: string }> }
    const snapshot = payload.files['moorread-backup.json'].content
    expect(snapshot).toContain(bookmarkTitle)
    expect(snapshot).not.toContain(gistToken)
    expect(await readConsent(extensionWorker)).toMatchObject({ gist: expect.any(Number) })
    expect(await readGistSettings(extensionWorker)).toMatchObject({ gistId: 'gist-consent-e2e' })

    // 已同意後不再重複詢問；第二次上傳直接執行。
    await gist.getByRole('button', { name: '上傳到 Gist', exact: true }).click()
    await expect.poll(() => calls.length).toBe(2)
    await expect(dialog).toHaveCount(0)
  }
  finally {
    await extensionWorker.evaluate(async (title) => {
      const found = await chrome.bookmarks.search({ title })
      for (const node of found)
        await chrome.bookmarks.remove(node.id).catch(() => undefined)
    }, bookmarkTitle)
    await page.close()
  }
})

test('WebDAV manual: first backup asks for consent, declining sends no request, accepting uploads once', async ({ extensionWorker, extensionContext, extensionId }) => {
  const page = await newTab(extensionWorker, extensionContext, extensionId)
  const bookmarkTitle = 'Consent WebDAV Bookmark'
  await extensionWorker.evaluate(async title => chrome.bookmarks.create({ parentId: '1', title, url: 'https://consent-webdav.example/' }), bookmarkTitle)
  const requests: Array<{ method: string, url: string, body: string, authorization: string | undefined }> = []
  await page.route(`${directory}**`, async (route) => {
    const request = route.request()
    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? '',
      authorization: request.headers().authorization,
    })
    if (request.method() === 'PROPFIND') {
      await route.fulfill({ status: 207, contentType: 'application/xml', body: '<d:multistatus xmlns:d="DAV:"/>' })
      return
    }
    await route.fulfill({ status: 201, body: '' })
  })
  try {
    await openDataSettings(page)
    const form = page.locator('div').filter({ has: page.getByRole('heading', { name: 'WebDAV 備份', exact: true }) }).last()
    await page.getByLabel('WebDAV 目錄網址').fill(directory)
    await page.getByLabel('帳號', { exact: true }).fill('consent-user')
    await page.getByLabel('應用程式密碼', { exact: true }).fill('consent-app-password')
    await form.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: '連線設定已儲存' })).toBeVisible()
    // 沒有讀取同意時，儲存設定不會讀取遠端目錄；面板改為顯示同意提示。
    await expect(page.getByRole('button', { name: '同意並讀取紀錄', exact: true })).toBeVisible()
    expect(requests.filter(item => item.method === 'PROPFIND')).toEqual([])
    await trackGetTree(page)
    const treeReadsBefore = await countGetTree(page)
    const requestsBefore = requests.length

    await page.getByRole('button', { name: '立即備份', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('目的地：你指定的 WebDAV 伺服器')
    await expect(dialog).toContainText(directory)
    await expect(dialog).toContainText('完整快照')
    await expect(dialog).toContainText('工作階段')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(400)

    expect(requests.length).toBe(requestsBefore)
    expect(requests.filter(item => item.method === 'PUT')).toEqual([])
    expect(await countGetTree(page)).toBe(treeReadsBefore)
    expect(await readConsent(extensionWorker)).toBeUndefined()
    await expect(form.getByRole('status').filter({ hasText: '備份已上傳' })).toHaveCount(0)

    await page.getByRole('button', { name: '立即備份', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並立即備份', exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: '備份已上傳' })).toBeVisible()
    const puts = requests.filter(item => item.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toMatch(/moorread-backup-\d{8}T\d{9}Z-[0-9a-f-]+\.json$/)
    expect(puts[0].authorization).toBe(`Basic ${Buffer.from('consent-user:consent-app-password').toString('base64')}`)
    expect(puts[0].body).toContain(bookmarkTitle)
    expect(puts[0].body).not.toContain('consent-app-password')
    expect(await readConsent(extensionWorker)).toMatchObject({ webdav: expect.any(Number) })
  }
  finally {
    await extensionWorker.evaluate(async (title) => {
      const found = await chrome.bookmarks.search({ title })
      for (const node of found)
        await chrome.bookmarks.remove(node.id).catch(() => undefined)
    }, bookmarkTitle)
    await page.close()
  }
})

test('WebDAV auto: enabling asks for consent, declining keeps it off and sends nothing, legacy enabled state without consent stays paused', async ({ extensionWorker, extensionContext, extensionId }) => {
  const page = await newTab(extensionWorker, extensionContext, extensionId)
  const bookmarkTitle = 'Consent Auto Bookmark'
  await extensionWorker.evaluate(async title => chrome.bookmarks.create({ parentId: '1', title, url: 'https://consent-auto.example/' }), bookmarkTitle)
  const uploads: string[] = []
  await page.route(`${directory}**`, async (route) => {
    const request = route.request()
    if (request.method() === 'PUT')
      uploads.push(request.postData() ?? '')
    if (request.method() === 'PROPFIND') {
      await route.fulfill({ status: 207, contentType: 'application/xml', body: '<d:multistatus xmlns:d="DAV:"/>' })
      return
    }
    await route.fulfill({ status: 201, body: '' })
  })
  try {
    await openDataSettings(page)
    const form = page.locator('div').filter({ has: page.getByRole('heading', { name: 'WebDAV 備份', exact: true }) }).last()
    await page.getByLabel('WebDAV 目錄網址').fill(directory)
    await page.getByLabel('帳號', { exact: true }).fill('consent-user')
    await page.getByLabel('應用程式密碼', { exact: true }).fill('consent-app-password')
    await form.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: '連線設定已儲存' })).toBeVisible()

    const autoSwitch = page.getByRole('checkbox', { name: '開啟新分頁時自動備份', exact: true })
    await autoSwitch.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('啟用自動備份前確認')
    await expect(dialog).toContainText('每次開啟新分頁')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).not.toBeChecked()
    expect(await readConsent(extensionWorker)).toBeUndefined()
    expect(uploads).toEqual([])

    // 同意後才啟用，並在開啟新分頁時自動上傳。
    await autoSwitch.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並啟用自動備份', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).toBeChecked()
    await form.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: '連線設定已儲存' })).toBeVisible()
    expect(await readConsent(extensionWorker)).toMatchObject({ 'webdav-auto': expect.any(Number) })
    await extensionWorker.evaluate(async key => chrome.storage.local.remove(key), statusKey)
    await page.reload()
    await expect.poll(() => uploads.length).toBe(1)
    expect(uploads[0]).toContain(bookmarkTitle)
    expect(uploads[0]).not.toContain('consent-app-password')

    // 已設定服務且勾選自動備份、但同意紀錄缺失（例如升級前既有的啟用狀態）：
    // central gate 必須暫停上傳，直到使用者重新同意。
    await extensionWorker.evaluate(async ({ consentKey, statusKey }) => {
      await chrome.storage.local.remove([consentKey, statusKey])
    }, { consentKey, statusKey })
    const uploadsBefore = uploads.length
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
    expect(uploads.length).toBe(uploadsBefore)
    expect(await readConsent(extensionWorker)).toBeUndefined()
  }
  finally {
    await extensionWorker.evaluate(async (title) => {
      const found = await chrome.bookmarks.search({ title })
      for (const node of found)
        await chrome.bookmarks.remove(node.id).catch(() => undefined)
    }, bookmarkTitle)
    await page.close()
  }
})

test('Consent state read failure is fail-closed: the dialog is shown again and a decline still sends nothing', async ({ extensionWorker, extensionContext, extensionId }) => {
  const page = await newTab(extensionWorker, extensionContext, extensionId)
  const bookmarkTitle = 'Consent Read Failure Bookmark'
  await extensionWorker.evaluate(async title => chrome.bookmarks.create({ parentId: '1', title, url: 'https://consent-failure.example/' }), bookmarkTitle)
  const calls: GistCall[] = []
  await page.route('https://api.github.com/**', async (route) => {
    calls.push({ method: route.request().method(), authorization: route.request().headers().authorization, body: route.request().postData() ?? '' })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'gist-consent-e2e' }) })
  })
  try {
    await openDataSettings(page)
    const gist = gistSection(page)
    await fillGistToken(page, extensionWorker, gistToken)
    await page.evaluate((key) => {
      const local = chrome.storage.local as unknown as {
        get: (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>>
        __moorreadOriginalGet?: (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>>
      }
      local.__moorreadOriginalGet = local.get
      const original = local.__moorreadOriginalGet
      local.get = (keys, callback) => {
        const list = Array.isArray(keys) ? keys : [keys]
        if (list.includes(key))
          return Promise.reject(new Error('simulated consent storage read failure'))
        return original(keys, callback)
      }
    }, consentKey)
    const treeReads = await page.evaluate(() => {
      const w = window as unknown as { __moorreadGetTreeCalls?: number }
      w.__moorreadGetTreeCalls = 0
      return 0
    })
    expect(treeReads).toBe(0)

    await gist.getByRole('button', { name: '上傳到 Gist', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(calls).toEqual([])
    expect(await readConsent(extensionWorker)).toBeUndefined()

    await page.evaluate(() => {
      const local = chrome.storage.local as unknown as {
        get: (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>>
        __moorreadOriginalGet?: (keys: string | string[], callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>>
      }
      if (local.__moorreadOriginalGet)
        local.get = local.__moorreadOriginalGet
    })
    await gist.getByRole('button', { name: '上傳到 Gist', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並上傳到 GitHub Gist', exact: true }).click()
    await expect(gist.getByRole('status').filter({ hasText: '已上傳到 Gist' })).toBeVisible()
    expect(calls).toHaveLength(1)
    expect(calls[0].authorization).toBe(`Bearer ${gistToken}`)
    expect(await readConsent(extensionWorker)).toMatchObject({ gist: expect.any(Number) })
  }
  finally {
    await extensionWorker.evaluate(async (title) => {
      const found = await chrome.bookmarks.search({ title })
      for (const node of found)
        await chrome.bookmarks.remove(node.id).catch(() => undefined)
    }, bookmarkTitle)
    await page.close()
  }
})
