import type { Page, Worker } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

// 升級後重新同意的中英文畫面證據。
// 只產生截圖與斷言，不改動任何產品程式。
// 預設寫入本輪測試的獨立輸出目錄；只有明確指定 MOORREAD_SCREENSHOT_DIR
// 時才輸出到審查包，避免一般測試覆寫既有歷史證據。
const shotDir = process.env.MOORREAD_SCREENSHOT_DIR
const consentKey = 'moorread:backup-consent'
const settingsKey = 'moorread:settings'
const configKey = 'moorread:webdav-config'
const statusKey = 'moorread:webdav-status'
const directory = 'https://www.google.com/moorread-consent-shots/'
const gistToken = 'ghp_consent_shots_token'
const password = 'shots-app-password'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

interface Labels {
  openSettings: string
  dataTab: string
  webdavHeading: string
  gistHeading: string
  gistToken: string
  gistUpload: string
  webdavUrl: string
  webdavUser: string
  webdavPassword: string
  save: string
  upload: string
  auto: string
  saved: string
  uploaded: string
  lastSuccess: string | RegExp
  noBackup: string
  cancel: string
  gistAgree: string
  webdavAgree: string
  autoAgree: string
  historyEmpty: string
  readPrompt: string
  readAction: string
  readAgree: string
  pausedTitle: string
  pausedAction: string
}

const zh: Labels = {
  openSettings: '開啟設定',
  dataTab: '資料與隱私',
  webdavHeading: 'WebDAV 備份',
  gistHeading: 'GitHub Gist 備份',
  gistToken: 'Personal Access Token',
  gistUpload: '上傳到 Gist',
  webdavUrl: 'WebDAV 目錄網址',
  webdavUser: '帳號',
  webdavPassword: '應用程式密碼',
  save: '儲存',
  upload: '立即備份',
  auto: '開啟新分頁時自動備份',
  saved: '連線設定已儲存',
  uploaded: '備份已上傳',
  lastSuccess: /^上次成功備份：/,
  noBackup: '尚無成功備份',
  cancel: '取消',
  gistAgree: '同意並上傳到 GitHub Gist',
  webdavAgree: '同意並立即備份',
  autoAgree: '同意並啟用自動備份',
  historyEmpty: '目錄中尚無備份檔案',
  readPrompt: '需要同意讀取後，才會列出遠端備份紀錄。',
  readAction: '同意並讀取紀錄',
  readAgree: '同意並讀取 WebDAV',
  pausedTitle: '自動備份暫停中',
  pausedAction: '重新同意並恢復自動備份',
}

const en: Labels = {
  openSettings: 'Open settings',
  dataTab: 'Data & Privacy',
  webdavHeading: 'WebDAV backup',
  gistHeading: 'GitHub Gist backup',
  gistToken: 'Personal access token',
  gistUpload: 'Upload to Gist',
  webdavUrl: 'WebDAV folder URL',
  webdavUser: 'Username',
  webdavPassword: 'App password',
  save: 'Save',
  upload: 'Back up now',
  auto: 'Back up automatically on new-tab opens',
  saved: 'Connection settings saved',
  uploaded: 'Backup uploaded',
  lastSuccess: /^Last successful backup:/,
  noBackup: 'No successful backup yet',
  cancel: 'Cancel',
  gistAgree: 'Agree and upload to GitHub Gist',
  webdavAgree: 'Agree and back up now',
  autoAgree: 'Agree and enable automatic backup',
  historyEmpty: 'No backup files in this folder',
  readPrompt: 'Agree to read access before remote backup records can be listed.',
  readAction: 'Agree and load records',
  readAgree: 'Agree and read from WebDAV',
  pausedTitle: 'Automatic backup is paused',
  pausedAction: 'Agree again and resume automatic backup',
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

async function setLanguage(worker: Worker, language: 'zh-TW' | 'en'): Promise<void> {
  await worker.evaluate(async ({ settingsKey, language }) => {
    const stored = (await chrome.storage.sync.get(settingsKey))[settingsKey]
    const settings = stored ? JSON.parse(String(stored)) : {}
    settings.language = language
    await chrome.storage.sync.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey, language })
}

// Gist 設定的寫入不是樂觀更新；等儲存值落地後再點擊，避免競態（FINDINGS F-06）。
async function fillGistToken(page: Page, worker: Worker, labels: Labels, token: string): Promise<void> {
  await page.getByLabel(labels.gistToken, { exact: true }).fill(token)
  await expect.poll(async () => worker.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    return raw ? JSON.parse(String(raw)).gistBackup?.token ?? '' : ''
  }, settingsKey)).toBe(token)
  await page.waitForTimeout(150)
}

async function openSettings(page: Page, labels: Labels): Promise<void> {
  await page.getByRole('button', { name: labels.openSettings, exact: true }).click()
  await page.getByRole('tab', { name: labels.dataTab, exact: true }).click()
  await expect(page.getByRole('heading', { name: labels.webdavHeading, exact: true })).toBeVisible()
}

function webdavForm(page: Page, labels: Labels) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: labels.webdavHeading, exact: true }) }).last()
}

function gistSection(page: Page, labels: Labels) {
  return page.locator('div').filter({ has: page.getByRole('heading', { name: labels.gistHeading, exact: true }) }).last()
}

async function shot(page: Page, name: string, target?: ReturnType<Page['locator']>): Promise<void> {
  const dir = shotDir ?? artifactPath('mr148-screenshots')
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(350)
  await (target ?? page).screenshot({ path: join(dir, name) })
}

async function seedLegacyEnabled(worker: Worker): Promise<void> {
  await worker.evaluate(async ({ configKey, statusKey, consentKey, directory, password }) => {
    await chrome.storage.local.set({ [configKey]: JSON.stringify({ enabled: true, url: directory, username: 'shots-user', password: '', intervalHours: 24 }) })
    await chrome.storage.session.set({ 'moorread:webdav-password': password })
    await chrome.storage.local.remove([statusKey, consentKey])
  }, { configKey, statusKey, consentKey, directory, password })
}

test('captures zh-TW consent, paused and recovered states', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await setLanguage(extensionWorker, 'zh-TW')
  const page = await extensionContext.newPage()
  const uploads: string[] = []
  await page.route(`${directory}**`, async (route) => {
    if (route.request().method() === 'PUT')
      uploads.push(route.request().postData() ?? '')
    if (route.request().method() === 'PROPFIND') {
      await route.fulfill({ status: 207, contentType: 'application/xml', body: '<d:multistatus xmlns:d="DAV:"/>' })
      return
    }
    await route.fulfill({ status: 201, body: '' })
  })
  try {
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')
    await openSettings(page, zh)

    await fillGistToken(page, extensionWorker, zh, gistToken)
    await gistSection(page, zh).getByRole('button', { name: zh.gistUpload, exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('api.github.com')
    await shot(page, 'consent-gist-zh.png', dialog)
    await dialog.getByRole('button', { name: zh.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const form = webdavForm(page, zh)
    await page.getByLabel(zh.webdavUrl).fill(directory)
    await page.getByLabel(zh.webdavUser, { exact: true }).fill('shots-user')
    await page.getByLabel(zh.webdavPassword, { exact: true }).fill(password)
    await form.getByRole('button', { name: zh.save, exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: zh.saved })).toBeVisible()
    // 遠端列表需要獨立的讀取同意；未同意時不發出 PROPFIND。
    const readPrompt = page.getByRole('button', { name: zh.readAction, exact: true })
    await expect(readPrompt).toBeVisible()
    await expect(page.getByText(zh.readPrompt, { exact: true })).toBeVisible()
    await readPrompt.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('不會上傳完整快照')
    await shot(page, 'consent-webdav-read-zh.png', dialog)
    await dialog.getByRole('button', { name: zh.readAgree, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('region', { name: '同步紀錄', exact: true })).toContainText(zh.historyEmpty)

    await page.getByRole('button', { name: zh.upload, exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('目的地：你指定的 WebDAV 伺服器')
    await shot(page, 'consent-webdav-zh.png', dialog)
    await dialog.getByRole('button', { name: zh.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const autoSwitch = page.getByRole('checkbox', { name: zh.auto, exact: true })
    await autoSwitch.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('啟用自動備份前確認')
    await shot(page, 'consent-auto-zh.png', dialog)
    await dialog.getByRole('button', { name: zh.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).not.toBeChecked()

    // 升級情境：已勾選自動備份、但沒有同意紀錄 → 暫停且沒有成功狀態。
    await seedLegacyEnabled(extensionWorker)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_000)
    expect(uploads).toEqual([])
    await openSettings(page, zh)
    await expect(autoSwitch).toBeChecked()
    await expect(page.getByText(zh.lastSuccess)).toHaveCount(0)
    await expect(page.getByText(zh.noBackup)).toBeVisible()
    const paused = form.getByRole('alert').filter({ hasText: zh.pausedTitle })
    await expect(paused).toBeVisible()
    await paused.scrollIntoViewIfNeeded()
    await shot(page, 'auto-paused-zh.png', page.getByRole('dialog').last())

    // 一鍵重新同意即可恢復，不需要取消再勾選，也不會立刻上傳。
    await paused.getByRole('button', { name: zh.pausedAction, exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('啟用自動備份前確認')
    await dialog.getByRole('button', { name: zh.autoAgree, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).toBeChecked()
    await expect(paused).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(uploads).toEqual([])
    await extensionWorker.evaluate(async key => chrome.storage.local.remove(key), statusKey)
    await page.reload()
    await expect.poll(() => uploads.length).toBe(1)
    await openSettings(page, zh)
    await expect(page.getByText(zh.lastSuccess)).toBeVisible()
    await page.getByText(zh.lastSuccess).scrollIntoViewIfNeeded()
    await shot(page, 'auto-recovered-zh.png', page.getByRole('dialog').last())
  }
  finally {
    await page.close()
  }
})

test('captures English consent, paused and recovered states', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await setLanguage(extensionWorker, 'en')
  const page = await extensionContext.newPage()
  const uploads: string[] = []
  await page.route(`${directory}**`, async (route) => {
    if (route.request().method() === 'PUT')
      uploads.push(route.request().postData() ?? '')
    if (route.request().method() === 'PROPFIND') {
      await route.fulfill({ status: 207, contentType: 'application/xml', body: '<d:multistatus xmlns:d="DAV:"/>' })
      return
    }
    await route.fulfill({ status: 201, body: '' })
  })
  try {
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')
    await openSettings(page, en)

    await fillGistToken(page, extensionWorker, en, gistToken)
    await gistSection(page, en).getByRole('button', { name: en.gistUpload, exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('api.github.com')
    await expect(dialog).toContainText('third-party transfers')
    await shot(page, 'consent-gist-en.png', dialog)
    await dialog.getByRole('button', { name: en.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const form = webdavForm(page, en)
    await page.getByLabel(en.webdavUrl).fill(directory)
    await page.getByLabel(en.webdavUser, { exact: true }).fill('shots-user')
    await page.getByLabel(en.webdavPassword, { exact: true }).fill(password)
    await form.getByRole('button', { name: en.save, exact: true }).click()
    await expect(form.getByRole('status').filter({ hasText: en.saved })).toBeVisible()
    const readPrompt = page.getByRole('button', { name: en.readAction, exact: true })
    await expect(readPrompt).toBeVisible()
    await expect(page.getByText(en.readPrompt, { exact: true })).toBeVisible()
    await readPrompt.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('does not upload a full snapshot')
    await shot(page, 'consent-webdav-read-en.png', dialog)
    await dialog.getByRole('button', { name: en.readAgree, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Sync history', exact: true })).toContainText(en.historyEmpty)

    await page.getByRole('button', { name: en.upload, exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Destination: the WebDAV server you specify')
    await shot(page, 'consent-webdav-en.png', dialog)
    await dialog.getByRole('button', { name: en.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)

    const autoSwitch = page.getByRole('checkbox', { name: en.auto, exact: true })
    await autoSwitch.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Confirm before enabling automatic backup')
    await shot(page, 'consent-auto-en.png', dialog)
    await dialog.getByRole('button', { name: en.cancel, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).not.toBeChecked()

    await seedLegacyEnabled(extensionWorker)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_000)
    expect(uploads).toEqual([])
    await openSettings(page, en)
    await expect(autoSwitch).toBeChecked()
    await expect(page.getByText(en.lastSuccess)).toHaveCount(0)
    await expect(page.getByText(en.noBackup)).toBeVisible()
    const paused = form.getByRole('alert').filter({ hasText: en.pausedTitle })
    await expect(paused).toBeVisible()
    await paused.scrollIntoViewIfNeeded()
    await shot(page, 'auto-paused-en.png', page.getByRole('dialog').last())

    await paused.getByRole('button', { name: en.pausedAction, exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Confirm before enabling automatic backup')
    await dialog.getByRole('button', { name: en.autoAgree, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(autoSwitch).toBeChecked()
    await expect(paused).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(uploads).toEqual([])
    await extensionWorker.evaluate(async key => chrome.storage.local.remove(key), statusKey)
    await page.reload()
    await expect.poll(() => uploads.length).toBe(1)
    await openSettings(page, en)
    await expect(page.getByText(en.lastSuccess)).toBeVisible()
    await page.getByText(en.lastSuccess).scrollIntoViewIfNeeded()
    await shot(page, 'auto-recovered-en.png', page.getByRole('dialog').last())
  }
  finally {
    await setLanguage(extensionWorker, 'zh-TW')
    await page.close()
  }
})
