import type { BrowserContext, Page, Worker } from '@playwright/test'
import { expect, test } from './extension.fixture'

// 撤回與設定儲存的失敗路徑。
// 以注入方式讓 chrome.storage 的寫入操作失敗，驗證 UI 不會把失敗顯示成成功，
// 且失敗後仍可重試。不改動任何斷言寬度。
const consentKey = 'moorread:backup-consent'
const settingsKey = 'moorread:settings'

interface FailureFlags {
  consentRemove: boolean
  settingsSet: boolean
}

declare global {
  interface Window {
    __moorreadTestFailures?: FailureFlags
  }
}

async function resetState(worker: Worker): Promise<void> {
  await worker.evaluate(async ({ consentKey, settingsKey }) => {
    await chrome.storage.local.remove(consentKey)
    const stored = (await chrome.storage.sync.get(settingsKey))[settingsKey]
    if (stored) {
      const settings = JSON.parse(String(stored))
      settings.gistBackup = { token: '', gistId: '', encrypt: false, passphrase: '' }
      await chrome.storage.sync.set({ [settingsKey]: JSON.stringify(settings) })
    }
  }, { consentKey, settingsKey })
}

async function seedConsent(worker: Worker): Promise<void> {
  await worker.evaluate(async ({ consentKey }) => {
    await chrome.storage.local.set({ [consentKey]: JSON.stringify({ webdav: Date.now() }) })
  }, { consentKey })
}

/** 注入可切換的失敗開關；掛在 chrome.storage 的方法上，旗標存在 window。 */
async function installFailureSwitches(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const flags = { consentRemove: false, settingsSet: false }
    ;(window as unknown as { __moorreadTestFailures: typeof flags }).__moorreadTestFailures = flags
    const local = chrome.storage.local
    const originalRemove = local.remove.bind(local)
    local.remove = ((keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      if (flags.consentRemove && list.includes('moorread:backup-consent'))
        return Promise.reject(new Error('injected consent remove failure'))
      return originalRemove(keys)
    }) as typeof local.remove
    const sync = chrome.storage.sync
    const originalSet = sync.set.bind(sync)
    sync.set = ((items: Record<string, unknown>) => {
      if (flags.settingsSet && Object.hasOwn(items, 'moorread:settings'))
        return Promise.reject(new Error('injected settings write failure'))
      return originalSet(items)
    }) as typeof sync.set
  })
}

async function setFailure(page: Page, patch: Partial<FailureFlags>): Promise<void> {
  await page.evaluate((next) => {
    Object.assign(window.__moorreadTestFailures!, next)
  }, patch)
}

async function openDataSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
  await page.getByRole('tab', { name: '資料與隱私', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'WebDAV 備份', exact: true })).toBeVisible()
}

async function openPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage()
  await installFailureSwitches(page)
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.waitForLoadState('domcontentloaded')
  return page
}

test('revoking consent shows success only after the record is actually removed', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedConsent(extensionWorker)
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    const revoke = page.getByRole('button', { name: '撤回所有備份同意', exact: true })
    await revoke.scrollIntoViewIfNeeded()
    await revoke.click()
    await page.getByRole('button', { name: '確定撤回', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已撤回所有備份同意' })).toBeVisible()
    const raw = await extensionWorker.evaluate(async key => (await chrome.storage.local.get(key))[key], consentKey)
    expect(raw).toBeUndefined()
  }
  finally {
    await page.close()
  }
})

test('a failed revoke shows an error, keeps the consent record and does not claim success', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedConsent(extensionWorker)
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    await setFailure(page, { consentRemove: true })
    const revoke = page.getByRole('button', { name: '撤回所有備份同意', exact: true })
    await revoke.scrollIntoViewIfNeeded()
    await revoke.click()
    await page.getByRole('button', { name: '確定撤回', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '撤回失敗' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '已撤回所有備份同意' })).toHaveCount(0)
    const raw = await extensionWorker.evaluate(async key => (await chrome.storage.local.get(key))[key], consentKey)
    expect(raw).toBeTruthy()
    expect(JSON.parse(String(raw))).toHaveProperty('webdav')
  }
  finally {
    await page.close()
  }
})

test('retrying a revoke after a failure succeeds and clears the record', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  await seedConsent(extensionWorker)
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    await setFailure(page, { consentRemove: true })
    const revoke = page.getByRole('button', { name: '撤回所有備份同意', exact: true })
    await revoke.scrollIntoViewIfNeeded()
    await revoke.click()
    await page.getByRole('button', { name: '確定撤回', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '撤回失敗' })).toBeVisible()

    await setFailure(page, { consentRemove: false })
    await page.getByRole('button', { name: '確定撤回', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已撤回所有備份同意' })).toBeVisible()
    const raw = await extensionWorker.evaluate(async key => (await chrome.storage.local.get(key))[key], consentKey)
    expect(raw).toBeUndefined()
  }
  finally {
    await page.close()
  }
})

test('a failed token save tells the user and leaves the stored value unchanged', async ({ extensionWorker, extensionContext, extensionId }) => {
  await resetState(extensionWorker)
  const page = await openPage(extensionContext, extensionId)
  try {
    await openDataSettings(page)
    await setFailure(page, { settingsSet: true })
    const field = page.getByLabel('Personal Access Token', { exact: true })
    await field.fill('ghp_unsaved_token')
    await expect(page.getByRole('alert').filter({ hasText: '無法儲存設定' })).toBeVisible()
    // 輸入內容保留，使用者不會白打一次。
    await expect(field).toHaveValue('ghp_unsaved_token')
    const stored = await extensionWorker.evaluate(async (key) => {
      const raw = (await chrome.storage.sync.get(key))[key]
      return raw ? JSON.parse(String(raw)).gistBackup?.token ?? '' : ''
    }, settingsKey)
    expect(stored).toBe('')

    // 恢復後再修改一次即可正常儲存，錯誤提示消失。
    await setFailure(page, { settingsSet: false })
    await field.fill('ghp_saved_token')
    await expect.poll(() => extensionWorker.evaluate(async (key) => {
      const raw = (await chrome.storage.sync.get(key))[key]
      return raw ? JSON.parse(String(raw)).gistBackup?.token ?? '' : ''
    }, settingsKey)).toBe('ghp_saved_token')
    await expect(page.getByRole('alert').filter({ hasText: '無法儲存設定' })).toHaveCount(0)
  }
  finally {
    await page.close()
  }
})
