import type { Page, Worker } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from './extension.fixture'

const settingsKey = 'moorread:settings'

// 只提供 0.1.5／0.1.6 真的有的 settings 欄位；nativeBookmarkSort／gistBackup 不應被備份覆蓋。
const legacyRaw = JSON.stringify({
  kind: 'yunji-tab-full-bookmark-snapshot',
  schemaVersion: 1,
  exportedAt: '2020-06-01T00:00:00.000Z',
  yunjiTab: {
    schemaVersion: 1,
    exportedAt: '2020-06-01T00:00:00.000Z',
    settings: { language: 'zh-TW', theme: 'dark', bookmarkSortMode: 'manual' },
    bookmarkMeta: {},
    categoryMeta: [],
    usage: {},
  },
  roots: [{ title: '書籤列', children: [{ title: 'Legacy Imported', url: 'https://legacy-import.example/' }] }],
})

const currentRaw = JSON.stringify({
  kind: 'moorread-full-bookmark-snapshot',
  schemaVersion: 1,
  exportedAt: '2026-10-11T10:00:00.000Z',
  moorread: {
    schemaVersion: 1,
    exportedAt: '2026-10-11T10:00:00.000Z',
    settings: {},
    bookmarkMeta: {},
    categoryMeta: [],
    usage: {},
  },
  roots: [{ title: '書籤列', children: [{ title: 'Current Imported', url: 'https://current-import.example/' }] }],
})

const seededSettings = {
  language: 'zh-TW',
  theme: 'light',
  defaultCategoryId: 'all',
  singleHomeTab: false,
  globalCommandPaletteEnabled: true,
  descriptionIgnoredDomains: [],
  customSearchEngines: [],
  bookmarkSortMode: 'manual',
  bookmarkViewMode: 'grid',
  savedSearches: [],
  autoOrganizeRules: [],
  autoOrganizeOnSave: true,
  metadataSyncEncryptionEnabled: false,
  nativeBookmarkSort: {
    enabled: true,
    autoSort: true,
    sortCriteria: [{ field: 'title', direction: 'asc' }],
    includeSubfolders: false,
    sortSelf: true,
    targetMode: 'all',
    targetFolderIds: [],
    ignoreFolderIds: [],
  },
  gistBackup: { token: '', gistId: 'seeded-gist', encrypt: false, passphrase: '' },
}

async function openDataSettings(page: Page) {
  await page.getByRole('button', { name: '開啟設定', exact: true }).click()
  await page.getByRole('tab', { name: '資料與隱私', exact: true }).click()
  await expect(page.getByRole('heading', { name: '資料備份', exact: true })).toBeVisible()
}

function countBookmarks(worker: Worker, url: string) {
  return worker.evaluate(async value => (await chrome.bookmarks.search(value)).length, url)
}

function countRestoreFolders(worker: Worker) {
  return worker.evaluate(async () => (await chrome.bookmarks.search('Moorread Restore')).length)
}

function readSettings(worker: Worker) {
  return worker.evaluate(async key => JSON.parse(String((await chrome.storage.sync.get(key))[key])) as {
    theme?: string
    nativeBookmarkSort?: { enabled?: boolean }
    gistBackup?: { gistId?: string }
  }, settingsKey)
}

async function restoreSettings(worker: Worker, previous: unknown) {
  await worker.evaluate(async ({ key, value }) => {
    if (value === undefined)
      await chrome.storage.sync.remove(key)
    else
      await chrome.storage.sync.set({ [key]: value })
  }, { key: settingsKey, value: previous })
}

async function removeRestoreFolders(worker: Worker) {
  await worker.evaluate(async () => {
    for (const node of await chrome.bookmarks.search('Moorread Restore')) {
      try {
        await chrome.bookmarks.removeTree(node.id)
      }
      catch {
        // 已不存在。
      }
    }
  })
}

test('restores a legacy 0.1.5/0.1.6 snapshot locally and keeps settings the backup lacks', async ({ extensionWorker, newTabPage }) => {
  const previousSettings = await extensionWorker.evaluate(async key => (await chrome.storage.sync.get(key))[key], settingsKey)
  await extensionWorker.evaluate(async ({ key, settings }) => chrome.storage.sync.set({ [key]: JSON.stringify(settings) }), { key: settingsKey, settings: seededSettings })
  try {
    await newTabPage.reload()
    await newTabPage.waitForLoadState('domcontentloaded')
    await openDataSettings(newTabPage)
    const input = newTabPage.getByLabel('選擇要還原的完整快照 JSON 檔案')

    await input.setInputFiles({ name: 'legacy-0.1.6.json', mimeType: 'application/json', buffer: Buffer.from(legacyRaw) })
    await expect(newTabPage.getByText('匯入預覽', { exact: true })).toBeVisible()
    await expect(newTabPage.getByText('舊版備份', { exact: true })).toBeVisible()

    // 第二次確認取消時不得寫入任何資料。
    await newTabPage.getByRole('button', { name: '確認匯入', exact: true }).click()
    await expect(newTabPage.getByRole('button', { name: '仍要還原', exact: true })).toBeVisible()
    await newTabPage.getByRole('button', { name: '取消', exact: true }).last().click()
    await expect(newTabPage.getByText('匯入預覽', { exact: true })).toHaveCount(0)
    expect(await countBookmarks(extensionWorker, 'https://legacy-import.example/')).toBe(0)
    expect(await countRestoreFolders(extensionWorker)).toBe(0)
    expect((await readSettings(extensionWorker)).theme).toBe('light')

    await input.setInputFiles({ name: 'legacy-0.1.6.json', mimeType: 'application/json', buffer: Buffer.from(legacyRaw) })
    await newTabPage.getByRole('button', { name: '確認匯入', exact: true }).click()
    await newTabPage.getByRole('button', { name: '仍要還原', exact: true }).click()
    await expect(newTabPage.getByText(/已還原到/)).toBeVisible()
    await expect.poll(() => countBookmarks(extensionWorker, 'https://legacy-import.example/')).toBe(1)

    const settings = await readSettings(extensionWorker)
    expect(settings.theme).toBe('dark')
    expect(settings.nativeBookmarkSort?.enabled).toBe(true)
    expect(settings.gistBackup?.gistId).toBe('seeded-gist')
  }
  finally {
    await removeRestoreFolders(extensionWorker)
    await restoreSettings(extensionWorker, previousSettings)
  }
})

test('restores current-format snapshots locally without an extra confirmation step', async ({ extensionWorker, newTabPage }) => {
  const previousSettings = await extensionWorker.evaluate(async key => (await chrome.storage.sync.get(key))[key], settingsKey)
  try {
    await openDataSettings(newTabPage)
    const input = newTabPage.getByLabel('選擇要還原的完整快照 JSON 檔案')

    await input.setInputFiles({ name: 'moorread-0.1.8.json', mimeType: 'application/json', buffer: Buffer.from(currentRaw) })
    await expect(newTabPage.getByText('匯入預覽', { exact: true })).toBeVisible()
    await expect(newTabPage.getByText('舊版備份', { exact: true })).toHaveCount(0)

    await newTabPage.getByRole('button', { name: '確認匯入', exact: true }).click()
    await expect(newTabPage.getByRole('button', { name: '仍要還原', exact: true })).toHaveCount(0)
    await expect(newTabPage.getByText(/已還原到/)).toBeVisible()
    await expect.poll(() => countBookmarks(extensionWorker, 'https://current-import.example/')).toBe(1)
  }
  finally {
    await removeRestoreFolders(extensionWorker)
    await restoreSettings(extensionWorker, previousSettings)
  }
})
