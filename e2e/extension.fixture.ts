import type { BrowserContext, Page, Worker } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { test as base, chromium } from '@playwright/test'
import { createProfile, pruneStaleProfiles, removeProfile } from './support/e2e-profile'

interface ExtensionWorkerFixtures {
  sessionCleanup: void
}

interface ExtensionTestFixtures {
  extensionContext: BrowserContext
  extensionId: string
  extensionWorker: Worker
  newTabPage: Page
}

interface Session {
  file: string
  context: BrowserContext
  userDataDir: string
  worker?: Worker
  extensionId?: string
}

// 診斷資料可能包含 console 內容；只保留除錯所需，並移除憑證樣式字串。
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[^\s"']+/gi, 'Bearer <redacted>'],
  [/sk-[-\w]{8,}/g, 'sk-<redacted>'],
]

function redact(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  )
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  }
  catch {
    return redact(value)
  }
}

// 每個 spec 檔共用一個 session（同一檔內的測試仍可累積狀態），換檔即重建。
// 原本 worker-scoped 的單一 profile 會讓 24 個 spec 互相污染：`chrome.storage.sync`
// 每分鐘寫入配額、LevelDB MANIFEST IO、殘留書籤與計時器都會累積到後面的測試。
let session: Session | undefined

async function launchSession(file: string): Promise<Session> {
  const userDataDir = await createProfile('moorread-e2e-', path.basename(file))
  const extensionPath = path.resolve(process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod')
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
  return { file, context, userDataDir }
}

// 只記錄 teardown 階段；同步寫 stderr，由既有 reporter 的 onStdErr 收進該輪 output.log。
function logTeardownStage(stage: string, file: string) {
  process.stderr.write(`${JSON.stringify({
    event: 'worker-teardown',
    stage,
    at: new Date().toISOString(),
    pid: process.pid,
    file: path.basename(file),
  })}\n`)
}

async function closeSession() {
  const current = session
  if (!current)
    return
  session = undefined
  let closeError: unknown
  logTeardownStage('context.close.start', current.file)
  try {
    await current.context.close()
  }
  catch (error) {
    closeError = error
  }
  logTeardownStage('context.close.done', current.file)
  // 清理失敗不再被吞掉：removeProfile 會在有上限的重試後丟出錯誤，
  // 使該次測試／worker 結束明確失敗，而不是留下殘留卻回報 PASS。
  logTeardownStage('removeProfile.start', current.file)
  await removeProfile(current.userDataDir)
  logTeardownStage('removeProfile.done', current.file)
  if (closeError)
    throw closeError
}

export const test = base.extend<ExtensionTestFixtures, ExtensionWorkerFixtures>({
  // worker 結束（也就是整份測試跑完）時關閉最後一個 session，避免留下瀏覽器與暫存 profile。
  sessionCleanup: [async ({}, use) => {
    await pruneStaleProfiles()
    await use()
    await closeSession()
  }, { scope: 'worker', auto: true }],

  extensionContext: async ({}, use, testInfo) => {
    if (!session || session.file !== testInfo.file) {
      await closeSession()
      session = await launchSession(testInfo.file)
    }
    await use(session.context)
  },

  extensionWorker: async ({ extensionContext }, use) => {
    const current = session!
    if (!current.worker) {
      let [worker] = extensionContext.serviceWorkers()
      worker ??= await extensionContext.waitForEvent('serviceworker', { timeout: 30_000 })
      current.worker = worker
    }
    await use(current.worker)
  },

  extensionId: async ({ extensionWorker }, use) => {
    const current = session!
    current.extensionId ??= new URL(extensionWorker.url()).host
    await use(current.extensionId)
  },

  newTabPage: async ({ extensionContext, extensionId }, use, testInfo) => {
    const page = await extensionContext.newPage()
    const consoleEntries: string[] = []
    const pageErrors: string[] = []
    const requestFailures: string[] = []
    const pendingConsole: Array<Promise<void>> = []
    page.on('console', (message) => {
      if (consoleEntries.length >= 200)
        return
      pendingConsole.push((async () => {
        const args = await Promise.all(message.args().map(async (arg) => {
          try {
            const value = await arg.evaluate((input) => {
              if (input instanceof Error)
                return `${input.name}: ${input.message}\n${input.stack ?? ''}`
              return typeof input === 'string' ? input : JSON.stringify(input)
            })
            return redact(String(value))
          }
          catch {
            return '<unserializable>'
          }
        }))
        consoleEntries.push(`${message.type()}: ${args.join(' ')}`)
      })())
    })
    page.on('pageerror', (error) => {
      pageErrors.push(redact(`${error.name}: ${error.message}\n${error.stack ?? ''}`))
    })
    page.on('requestfailed', (request) => {
      requestFailures.push(
        `${request.method()} ${sanitizeUrl(request.url())} ${request.failure()?.errorText ?? ''}`,
      )
    })
    await page.goto(`chrome-extension://${extensionId}/newtab.html`)
    await page.waitForLoadState('domcontentloaded')
    await use(page)
    const failed = testInfo.status !== testInfo.expectedStatus
      || testInfo.errors.length > 0
    if (failed) {
      await Promise.allSettled(pendingConsole)
      fs.writeFileSync(
        testInfo.outputPath('page-diagnostics.json'),
        JSON.stringify({
          title: testInfo.title,
          file: testInfo.file,
          line: testInfo.line,
          console: consoleEntries,
          pageErrors,
          requestFailures,
        }, null, 2),
      )
    }
    await page.close()
  },
})

export { expect } from '@playwright/test'
