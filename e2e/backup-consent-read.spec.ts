import type { BrowserContext, Page, Worker } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from './extension.fixture'

// 讀取／測試／還原入口的明示同意。拒絕時以請求攔截證明
// 「沒有任何憑證或資料出站」，而不是只看 UI 狀態。
const consentKey = 'moorread:backup-consent'
const settingsKey = 'moorread:settings'
const configKey = 'moorread:webdav-config'
const statusKey = 'moorread:webdav-status'
const directory = 'https://www.google.com/moorread-read-consent/'
const gistToken = 'ghp_read_consent_token'
const password = 'read-consent-app-password'
const gistId = 'gist-read-consent-e2e'
const latest = 'moorread-backup-20261115T090000000Z-00000000-0000-4000-8000-000000000001.json'
const snapshot = JSON.stringify({ kind: 'moorread-full-bookmark-snapshot', schemaVersion: 1, exportedAt: '2026-11-15T09:00:00Z', moorread: { schemaVersion: 1, settings: {}, bookmarkMeta: {}, categoryMeta: [], usage: {} }, roots: [] })
const listing = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${directory}${latest}</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>Sun, 15 Nov 2026 09:00:00 GMT</d:getlastmodified><d:getcontentlength>${Buffer.byteLength(snapshot)}</d:getcontentlength><d:getetag>"${Buffer.byteLength(snapshot)}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
const collection = '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'

interface Captured {
  method: string
  url: string
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

async function seedGistId(worker: Worker): Promise<void> {
  await worker.evaluate(async ({ settingsKey, gistId }) => {
    const stored = (await chrome.storage.sync.get(settingsKey))[settingsKey]
    const settings = stored ? JSON.parse(String(stored)) : {}
    settings.gistBackup = { token: '', gistId, encrypt: false, passphrase: '' }
    await chrome.storage.sync.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey, gistId })
}

async function seedWebdav(worker: Worker, enabled: boolean): Promise<void> {
  await worker.evaluate(async ({ configKey, directory, password, enabled }) => {
    await chrome.storage.local.set({ [configKey]: JSON.stringify({ enabled, url: directory, username: 'read-user', password: '', intervalHours: 24 }) })
    await chrome.storage.session.set({ 'moorread:webdav-password': password })
  }, { configKey, directory, password, enabled })
}

async function seedConsent(worker: Worker, record: Record<string, number>): Promise<void> {
  await worker.evaluate(async ({ consentKey, record }) => {
    await chrome.storage.local.set({ [consentKey]: JSON.stringify(record) })
  }, { consentKey, record })
}

async function readConsent(worker: Worker): Promise<Record<string, number> | undefined> {
  return worker.evaluate(async (key) => {
    const raw = (await chrome.storage.local.get(key))[key]
    return raw === undefined ? undefined : JSON.parse(String(raw))
  }, consentKey)
}

async function openPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

async function openDataSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
  await page.getByRole('tab', { name: '資料與隱私', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'WebDAV 備份', exact: true })).toBeVisible()
}

function gistSection(page: Page) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: 'GitHub Gist 備份', exact: true }) }).last()
}

function webdavForm(page: Page) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: 'WebDAV 備份', exact: true }) }).last()
}

test('gist read and connection test require separate consent; declining sends no request at all', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedGistId(extensionWorker)
  const requests: Captured[] = []
  await extensionContext.route('https://api.github.com/**', async (route) => {
    requests.push({
      method: route.request().method(),
      url: route.request().url(),
      authorization: route.request().headers().authorization,
      body: route.request().postData() ?? '',
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: gistId }) })
  })
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    const gist = gistSection(page)
    await page.getByLabel('Personal Access Token', { exact: true }).fill(gistToken)
    // 先讓 Token 落地，避免把 F-06 的競態混進本案例（F-06 由另一個測試單獨驗證）。
    await expect.poll(async () => extensionWorker.evaluate(async (key) => {
      const raw = (await chrome.storage.sync.get(key))[key]
      return raw ? JSON.parse(String(raw)).gistBackup?.token ?? '' : ''
    }, settingsKey)).toBe(gistToken)

    const dialog = page.getByRole('alertdialog')
    await gist.getByRole('button', { name: '測試 Gist 連線', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('讀取 GitHub Gist 前確認')
    await expect(dialog).toContainText('api.github.com')
    await expect(dialog).toContainText('不會上傳完整快照')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(requests).toEqual([])

    await gist.getByRole('button', { name: '從 Gist 讀取', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
    expect(await readConsent(extensionWorker)).toBeUndefined()

    await gist.getByRole('button', { name: '測試 Gist 連線', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並讀取 Gist', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].authorization).toBe(`Bearer ${gistToken}`)
    const record = await readConsent(extensionWorker)
    expect(record).toMatchObject({ 'gist-read': expect.any(Number) })
    // 讀取同意不得同時授予上傳同意。
    expect(record).not.toHaveProperty('gist')
  }
  finally {
    await extensionContext.unrouteAll({ behavior: 'wait' })
    await page.close()
  }
})

test('webdav connection test, remote list and restore each require read consent; declining sends nothing', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedWebdav(extensionWorker, false)
  const requests: Captured[] = []
  await extensionContext.route(`${directory}**`, async (route) => {
    const request = route.request()
    requests.push({
      method: request.method(),
      url: request.url(),
      authorization: request.headers().authorization,
      body: request.postData() ?? '',
    })
    if (request.method() === 'PROPFIND') {
      await route.fulfill({ status: 207, contentType: 'application/xml', body: request.headers().depth === '0' ? collection : listing })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot })
  })
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    await expect(page.getByLabel('WebDAV 目錄網址')).toBeEnabled()
    // 尚未同意讀取時，掛載與儲存設定都不得讀取遠端目錄。
    expect(requests).toEqual([])
    const dialog = page.getByRole('alertdialog')

    await page.getByRole('button', { name: '測試連線', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('讀取 WebDAV 前確認')
    await expect(dialog).toContainText(directory)
    await expect(dialog).toContainText('Basic')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(requests).toEqual([])

    await page.getByRole('button', { name: '同意並讀取紀錄', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(requests).toEqual([])

    await page.getByRole('button', { name: '還原最新備份', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(requests).toEqual([])
    expect(await readConsent(extensionWorker)).toBeUndefined()

    await page.getByRole('button', { name: '同意並讀取紀錄', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '同意並讀取 WebDAV', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const history = page.getByRole('region', { name: '同步紀錄', exact: true })
    await expect(history.getByText(latest, { exact: true })).toBeVisible()
    const afterListing = requests.length
    expect(requests.filter(item => item.method === 'PROPFIND').length).toBeGreaterThan(0)

    // 已同意後，測試連線與還原直接執行，不再重複詢問。
    await page.getByRole('button', { name: '測試連線', exact: true }).click()
    await expect(webdavForm(page).getByRole('status').filter({ hasText: '連線成功' })).toBeVisible()
    await expect.poll(() => requests.length).toBe(afterListing + 1)
    await history.getByRole('button', { name: `還原 ${latest}`, exact: true }).click()
    await expect(page.getByText('匯入預覽', { exact: true })).toBeVisible()
    await expect.poll(() => requests.length).toBe(afterListing + 2)
    const download = requests.at(-1)!
    expect(download.method).toBe('GET')
    expect(download.authorization).toBe(`Basic ${Buffer.from(`read-user:${password}`).toString('base64')}`)
    await page.getByRole('button', { name: '取消', exact: true }).last().click()
    const record = await readConsent(extensionWorker)
    expect(record).toMatchObject({ 'webdav-read': expect.any(Number) })
    expect(record).not.toHaveProperty('webdav')
  }
  finally {
    await extensionContext.unrouteAll({ behavior: 'wait' })
    await page.close()
  }
})

test('revoking consent stops spontaneous uploads and asks again before a manual transfer', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedWebdav(extensionWorker, true)
  await seedConsent(extensionWorker, { 'webdav': Date.now(), 'webdav-read': Date.now(), 'webdav-auto': Date.now() })
  const uploads: string[] = []
  // 先掛好路由再開頁面，確保自動備份的第一個請求一定被攔截。
  await extensionContext.route(`${directory}**`, async (route) => {
    const request = route.request()
    if (request.method() === 'PUT') {
      uploads.push(request.postData() ?? '')
      await route.fulfill({ status: 201, body: '' })
      return
    }
    await route.fulfill({ status: 207, contentType: 'application/xml', body: '<d:multistatus xmlns:d="DAV:"/>' })
  })
  const page = await openPage(extensionContext, extensionId)
  try {
    await expect.poll(() => uploads.length).toBe(1)
    await openDataSettings(page)
    const form = webdavForm(page)
    const revoke = page.getByRole('button', { name: '撤回所有備份同意', exact: true })
    await revoke.scrollIntoViewIfNeeded()
    await revoke.click()
    await page.getByRole('button', { name: '確定撤回', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已撤回所有備份同意' })).toBeVisible()
    expect(await readConsent(extensionWorker)).toBeUndefined()

    // 撤回後：自動備份立即進入暫停狀態，重新開啟新分頁也不會自發上傳。
    await expect(form.getByRole('alert').filter({ hasText: '自動備份暫停中' })).toBeVisible()
    const uploadsBefore = uploads.length
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_200)
    expect(uploads.length).toBe(uploadsBefore)

    await openDataSettings(page)
    await page.getByRole('button', { name: '立即備份', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(uploads.length).toBe(uploadsBefore)
  }
  finally {
    await extensionContext.unrouteAll({ behavior: 'wait' })
    await page.close()
  }
})

test('a token typed and used immediately is read from the latest state', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  const requests: Captured[] = []
  await extensionContext.route('https://api.github.com/**', async (route) => {
    requests.push({ method: route.request().method(), url: route.request().url(), authorization: route.request().headers().authorization, body: route.request().postData() ?? '' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    const gist = gistSection(page)
    // 不等待儲存落地：貼上後立刻點擊，處理器必須讀到最新值而不是舊的 render 狀態。
    await page.getByLabel('Personal Access Token', { exact: true }).fill(gistToken)
    await gist.getByRole('button', { name: '測試 Gist 連線', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('讀取 GitHub Gist 前確認')
    await expect(gist.getByRole('alert').filter({ hasText: '請先填寫有效的 GitHub token' })).toHaveCount(0)
    await dialog.getByRole('button', { name: '同意並讀取 Gist', exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].authorization).toBe(`Bearer ${gistToken}`)
  }
  finally {
    await extensionContext.unrouteAll({ behavior: 'wait' })
    await page.close()
  }
})
