import type { BrowserContext, Page } from '@playwright/test'
import path from 'node:path'
import process from 'node:process'
import { chromium, expect, test } from '@playwright/test'
import { createProfile, removeProfile } from './support/e2e-profile'

const manifestKey = 'moorread:metadata-sync:manifest'

interface StartupProbe {
  rejections: string[]
  stubCalls: number
}

declare global {
  interface Window {
    __startupProbe?: StartupProbe
    __failMetaReads?: boolean
  }
}

interface StartupSession {
  close: () => Promise<void>
  page: Page
}

// 每個測試都自建一個全新的 persistent context（獨立 profile、獨立 service worker、
// 獨立 chrome.storage），並在「首次導覽之前」安裝 stub。先前版本沿用共用 context 的
// 頁面，先導覽才裝 stub，metadata sync 已在同一份 storage 上完成，reload 後不再讀
// manifest，stub 便不會被呼叫。測試結束一律關閉 context，讓 hang 模式的未完成
// Promise 隨頁面一起銷毀，不會污染其他測試。
async function openStartupPage(
  mode: 'hang' | 'reject',
  options: { failMetaReads?: boolean, seedBookmarkTitle?: string } = {},
): Promise<StartupSession> {
  const probe: StartupProbe = { rejections: [], stubCalls: 0 }
  const userDataDir = await createProfile('moorread-e2e-startup-', 'e2e/startup.spec.ts')
  const extensionPath = path.resolve(
    process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod',
  )
  const context: BrowserContext = await chromium.launchPersistentContext(
    userDataDir,
    {
      channel: 'chromium',
      headless: true,
      locale: 'zh-TW',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    },
  )
  const close = async () => {
    await context.close()
    await removeProfile(userDataDir)
  }
  try {
    let [worker] = context.serviceWorkers()
    worker ??= await context.waitForEvent('serviceworker')
    const extensionId = new URL(worker.url()).host
    if (options.seedBookmarkTitle) {
      await worker.evaluate(
        title => chrome.bookmarks.create({ title, url: 'https://retry.example/' }),
        options.seedBookmarkTitle,
      )
    }
    const page = await context.newPage()
    await page.addInitScript(
      ({ mode, manifestKey, probe, failMetaReads }) => {
        window.__startupProbe = probe
        const recordStubCall = () => {
          probe.stubCalls += 1
        }
        const sync = chrome.storage.sync
        const originalGet = sync.get.bind(sync)
        const touchesManifest = (keys: unknown) =>
          keys === manifestKey
          || (Array.isArray(keys) && keys.includes(manifestKey))
        Object.defineProperty(sync, 'get', {
          configurable: true,
          writable: true,
          value: (keys?: unknown, callback?: unknown) => {
            if (touchesManifest(keys)) {
              recordStubCall()
              return mode === 'reject'
                ? Promise.reject(new Error('metadata sync unavailable'))
                : new Promise(() => {})
            }
            // 呼叫端可能只用單一參數（例如舊資料遷移直接呼叫 `chrome.storage.sync.get(key)`）；
            // 明確傳入 `undefined` callback 會被 Chrome 拒絕（No matching signature），
            // 必須依實際有無 callback 原樣轉呼叫，保持與真實 API 相同的語意。
            return callback === undefined
              ? (originalGet as (k?: unknown) => unknown)(keys)
              : (originalGet as (k?: unknown, cb?: unknown) => unknown)(keys, callback)
          },
        })
        // 只攔截必要資料（meta）的讀取，且由頁面開關控制，重試時可恢復正常。
        window.__failMetaReads = failMetaReads === true
        const local = chrome.storage.local
        const originalLocalGet = local.get.bind(local)
        const touchesMeta = (keys: unknown) =>
          keys === 'moorread:meta'
          || (Array.isArray(keys) && keys.includes('moorread:meta'))
        Object.defineProperty(local, 'get', {
          configurable: true,
          writable: true,
          value: (keys?: unknown, callback?: unknown) => {
            if (window.__failMetaReads && touchesMeta(keys)) {
              return Promise.reject(new Error(
                'IO error: C:\\profile\\Local Extension Settings\\moorread\\MANIFEST-000001: NewSequentialFile: forced failure',
              ))
            }
            return callback === undefined
              ? (originalLocalGet as (k?: unknown) => unknown)(keys)
              : (originalLocalGet as (k?: unknown, cb?: unknown) => unknown)(keys, callback)
          },
        })
        window.addEventListener('unhandledrejection', (event) => {
          probe.rejections.push(String(event.reason))
        })
      },
      { mode, manifestKey, probe, failMetaReads: options.failMetaReads === true },
    )
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')
    return { close, page }
  }
  catch (error) {
    await close()
    throw error
  }
}

test('finishes loading before a slow metadata sync resolves', async () => {
  const { close, page: newTabPage } = await openStartupPage('hang')
  try {
    // 正向证据：stub 确实被命中（元数据同步已启动），骨架屏收起，页面标记为 ready，导航已渲染。
    await expect.poll(() => newTabPage.evaluate(() => window.__startupProbe?.stubCalls ?? 0)).toBeGreaterThan(0)
    await expect(newTabPage.locator('.newtab-shell')).toHaveAttribute(
      'data-newtab-ready',
      'true',
    )
    await expect(newTabPage.getByTestId('bookmark-grid-loading')).toHaveCount(0)
    await expect(newTabPage.getByLabel('搜尋書籤和資料夾')).toBeVisible()
    await expect(newTabPage.locator('nav button').first()).toBeVisible()
    expect(await newTabPage.evaluate(() => window.__startupProbe?.rejections ?? []))
      .toEqual([])
  }
  finally {
    await close()
  }
})

test('stays ready and reports no unhandled rejection when metadata sync rejects', async () => {
  const { close, page: newTabPage } = await openStartupPage('reject')
  try {
    // 先确认 stub 被触发并已发生真实失败（重试耗尽），再断言页面仍 ready 且无冒泡 rejection。
    await expect.poll(() => newTabPage.evaluate(() => window.__startupProbe?.stubCalls ?? 0)).toBeGreaterThanOrEqual(3)
    await expect.poll(() => newTabPage.evaluate(async () => {
      const key = 'moorread:metadata-sync-log'
      const raw = (await chrome.storage.local.get(key))[key]
      const log = typeof raw === 'string' ? JSON.parse(raw) : raw
      return log?.[0]?.state
    })).toBe('error')
    await expect(newTabPage.locator('.newtab-shell')).toHaveAttribute(
      'data-newtab-ready',
      'true',
    )
    await expect(newTabPage.getByTestId('bookmark-grid-loading')).toHaveCount(0)
    await newTabPage.getByLabel('搜尋書籤和資料夾').fill('startup probe')
    await expect.poll(() => newTabPage.evaluate(() => window.__startupProbe?.rejections ?? []))
      .toEqual([])
  }
  finally {
    await close()
  }
})

test('shows a recoverable error instead of an empty grid when required storage reads fail', async () => {
  const { close, page: newTabPage } = await openStartupPage('hang', {
    failMetaReads: true,
    seedBookmarkTitle: '重試後可見的書籤',
  })
  try {
    const alert = newTabPage.getByRole('alert').filter({ hasText: '書籤資料讀取失敗' })
    // 重試耗盡後必須明確失敗：保留錯誤提示、不標記 ready、不以空書籤畫面呈現。
    await expect(alert).toBeVisible()
    await expect(newTabPage.locator('.newtab-shell')).not.toHaveAttribute(
      'data-newtab-ready',
      'true',
    )
    await expect(newTabPage.getByTestId('bookmark-grid-loading')).toHaveCount(0)
    await expect(newTabPage.getByText('重試後可見的書籤', { exact: true })).toHaveCount(0)

    // 恢復途徑：錯誤消失後按重試，應重新讀取並正常顯示既有書籤。
    await newTabPage.evaluate(() => {
      window.__failMetaReads = false
    })
    await alert.getByRole('button', { name: '重試' }).click()
    await expect(newTabPage.locator('.newtab-shell')).toHaveAttribute(
      'data-newtab-ready',
      'true',
    )
    await expect(alert).toHaveCount(0)
    await newTabPage.getByLabel('搜尋書籤和資料夾').fill('重試後可見的書籤')
    await expect(newTabPage.getByText('重試後可見的書籤', { exact: true }).first()).toBeVisible()
  }
  finally {
    await close()
  }
})
