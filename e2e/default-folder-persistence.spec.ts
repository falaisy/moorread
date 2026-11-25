import type { BrowserContext, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { createProfile, removeProfile } from './support/e2e-profile'

/**
 * 預設資料夾持久化。
 *
 * 這裡刻意「真的關閉整個瀏覽器 context 再重新啟動」同一個 userDataDir，
 * 而不是只 reload 頁面 —— 只有這樣才能抓到「畫面看似保存、重啟後丟失」。
 * 使用獨立的暫時 profile 與獨立建置產物，不會接觸使用者日常使用的 Profile。
 */

// 預設直接載入正式建置產物（build/chrome-mv3-prod），不得靠臨時環境變數繞過。
// 修正：原本預設 build/chrome-mv3-e2e，該目錄在此 clone 不存在，
// 導致測試實際載入的不是本次指定版本（先前的通過紀錄因此不被採信）。
const extensionPath = path.resolve(process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod')

const SETTINGS_KEY = 'moorread:settings'

/** 確認實際載入的建置版本與 package.json 一致，避免測到舊產物。 */
function assertBuiltVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8')) as { version: string }
  const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string }
  expect(manifest.version).toBe(pkg.version)
  return manifest.version
}

// 失敗時快速回報，不要讓單一 selector 卡住整個測試。
test.use({ actionTimeout: 15_000 })

interface Session {
  context: BrowserContext
  page: Page
  extensionId: string
}

async function launch(userDataDir: string, knownExtensionId?: string): Promise<Session> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-TW',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  // 重啟同一個 profile 時 service worker 不會自動啟動，等 'serviceworker' 會永久卡住；
  // extension id 對同一個 profile 固定不變，首次取得後沿用即可。
  let extensionId = knownExtensionId
  if (!extensionId) {
    let [worker] = context.serviceWorkers()
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 })
    extensionId = new URL(worker.url()).host
  }
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/newtab.html`)
  await page.waitForLoadState('domcontentloaded')
  const session: Session = { context, page, extensionId }
  await ensureEnglish(session)
  return session
}

/** 固定介面語言為 en 並略過首次啟動引導，讓選單標籤穩定可預期。 */
async function ensureEnglish(session: Session) {
  await session.page.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    const parsed = raw ? JSON.parse(String(raw)) : {}
    if (parsed.language === 'en' && parsed.onboardingDismissed === true)
      return
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...parsed, language: 'en', onboardingDismissed: true }) })
  }, SETTINGS_KEY)
  await session.page.reload()
  await session.page.waitForLoadState('domcontentloaded')
}

async function storedDefaultCategoryId(session: Session) {
  return session.page.evaluate(async (key) => {
    const raw = (await chrome.storage.sync.get(key))[key]
    if (!raw)
      return null
    return (JSON.parse(String(raw)) as { defaultCategoryId?: string }).defaultCategoryId ?? null
  }, SETTINGS_KEY)
}

async function createFolder(session: Session, title: string) {
  return session.page.evaluate(async (name) => {
    const node = await chrome.bookmarks.create({ parentId: '1', title: name })
    return node.id
  }, title)
}

async function openSettings(session: Session) {
  const { page } = session
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
}

async function pickFolder(session: Session, label: string) {
  const { page } = session
  await page.locator('button[aria-labelledby="default-category-label"]').click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

async function triggerText(session: Session) {
  return (await session.page.locator('button[aria-labelledby="default-category-label"]').textContent()) ?? ''
}

async function restart(userDataDir: string, session: Session) {
  await session.context.close()
  return launch(userDataDir, session.extensionId)
}

test('預設資料夾在真正重啟瀏覽器後仍保留（A / B / inbox / cat-X / 無效值 / 遷移）', async ({}, testInfo) => {
  test.setTimeout(300_000)
  testInfo.annotations.push({ type: 'extensionPath', description: extensionPath })
  testInfo.annotations.push({ type: 'buildVersion', description: assertBuiltVersion() })
  const userDataDir = await createProfile('moorread-e2e-default-category-', 'e2e/default-folder-persistence.spec.ts')
  let session = await launch(userDataDir)
  try {
    const folderA = await createFolder(session, 'FolderA')
    const folderB = await createFolder(session, 'FolderB')
    await session.page.reload()
    await session.page.waitForLoadState('domcontentloaded')

    await test.step('1. 選 FolderA → 重開設定頁仍是 A', async () => {
      await openSettings(session)
      await pickFolder(session, 'FolderA')
      await expect.poll(() => storedDefaultCategoryId(session)).toBe(`cat-${folderA}`)
      await session.page.reload()
      await session.page.waitForLoadState('domcontentloaded')
      await openSettings(session)
      expect(await triggerText(session)).toContain('FolderA')
    })

    await test.step('2. 完全關閉瀏覽器再開 → 仍是 A', async () => {
      session = await restart(userDataDir, session)
      expect(await storedDefaultCategoryId(session)).toBe(`cat-${folderA}`)
      await openSettings(session)
      expect(await triggerText(session)).toContain('FolderA')
    })

    await test.step('3. 改成 FolderB → 重啟後是 B，不退回 A', async () => {
      await pickFolder(session, 'FolderB')
      await expect.poll(() => storedDefaultCategoryId(session)).toBe(`cat-${folderB}`)
      session = await restart(userDataDir, session)
      expect(await storedDefaultCategoryId(session)).toBe(`cat-${folderB}`)
      await openSettings(session)
      expect(await triggerText(session)).toContain('FolderB')
    })

    await test.step('4. 設為 inbox → 重啟後仍是 inbox', async () => {
      await pickFolder(session, 'Inbox')
      await expect.poll(() => storedDefaultCategoryId(session)).toBe('inbox')
      session = await restart(userDataDir, session)
      expect(await storedDefaultCategoryId(session)).toBe('inbox')
      await openSettings(session)
      expect(await triggerText(session)).toContain('Inbox')
    })

    await test.step('5. 設為一般資料夾 cat-X → 重啟後仍是該資料夾', async () => {
      await pickFolder(session, 'FolderA')
      await expect.poll(() => storedDefaultCategoryId(session)).toBe(`cat-${folderA}`)
      session = await restart(userDataDir, session)
      expect(await storedDefaultCategoryId(session)).toBe(`cat-${folderA}`)
      await openSettings(session)
      expect(await triggerText(session)).toContain('FolderA')
    })

    await test.step('6. 無效設定才安全回退，且不得覆寫既有設定', async () => {
      await session.page.evaluate(async ({ key, id }) => {
        const current = await chrome.storage.sync.get(key)
        const parsed = current[key] ? JSON.parse(String(current[key])) : {}
        await chrome.storage.sync.set({ [key]: JSON.stringify({ ...parsed, defaultCategoryId: id }) })
      }, { key: SETTINGS_KEY, id: 'cat-999999' })
      session = await restart(userDataDir, session)
      // 無效值原樣保留在儲存，不被無故覆蓋成 all（否則等於「無故重設」）
      expect(await storedDefaultCategoryId(session)).toBe('cat-999999')
      await openSettings(session)
      // 畫面安全回退到「All」而不崩潰
      expect(await triggerText(session)).toContain('All')
    })

    await test.step('7. 舊版資料遷移不得把有效設定意外重設', async () => {
      await session.page.evaluate(async ({ key, id }) => {
        const current = await chrome.storage.sync.get(key)
        const parsed = current[key] ? JSON.parse(String(current[key])) : {}
        await chrome.storage.sync.set({
          [key]: JSON.stringify({ ...parsed, defaultCategoryId: id }),
          'yunji-tab:settings': JSON.stringify({ defaultCategoryId: 'cat-1', language: 'en' }),
        })
        await chrome.storage.local.remove('moorread:storage-migration:v1')
      }, { key: SETTINGS_KEY, id: `cat-${folderB}` })
      session = await restart(userDataDir, session)
      expect(await storedDefaultCategoryId(session)).toBe(`cat-${folderB}`)
    })

    await test.step('8. 舊版 raw id 預設值在重啟後仍顯示為該資料夾（不得誤判為 All）', async () => {
      // 這是使用者回報的實際形態：舊版把預設資料夾存成原生 id（例如 "4"），
      // 未帶 cat- 前綴，新版選單只認 cat-4，於是重啟後被顯示成原始預設 All。
      await session.page.evaluate(async ({ key, id }) => {
        const current = await chrome.storage.sync.get(key)
        const parsed = current[key] ? JSON.parse(String(current[key])) : {}
        await chrome.storage.sync.set({ [key]: JSON.stringify({ ...parsed, defaultCategoryId: id }) })
      }, { key: SETTINGS_KEY, id: folderA })
      session = await restart(userDataDir, session)
      await openSettings(session)
      expect(await triggerText(session)).toContain('FolderA')
    })
  }
  finally {
    await session.context.close()
    await removeProfile(userDataDir)
  }
})
