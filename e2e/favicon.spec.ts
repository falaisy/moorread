import type { BrowserContext, Page, Worker } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { chromium, expect, test } from '@playwright/test'
import { createProfile, removeProfile } from './support/e2e-profile'

const execFileAsync = promisify(execFile)

// 1x1 PNG：真實位元組，用來確認 SW 取回的是本機內容而不是任何快取或預設圖示。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_SHA = createHash('sha256').update(PNG).digest('hex')
const GOOGLE_URL = 'https://www.google.com/s2/favicons?domain=lemonsqueezy.com&sz=128'

// 執行期自簽憑證：只用 .NET CertificateRequest 產生 PEM 檔，不寫入任何憑證存放區。
const CERT_SCRIPT = `param([Parameter(Mandatory=$true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$san = New-Object System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder
$san.AddDnsName('www.google.com')
$req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(
  'CN=www.google.com', $rsa,
  [System.Security.Cryptography.HashAlgorithmName]::SHA256,
  [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$req.CertificateExtensions.Add($san.Build())
$cert = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddDays(1))
[IO.File]::WriteAllText((Join-Path $OutDir 'key.pem'), $rsa.ExportPkcs8PrivateKeyPem())
$b64 = [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks')
[IO.File]::WriteAllText((Join-Path $OutDir 'cert.pem'), "-----BEGIN CERTIFICATE-----\`n$b64\`n-----END CERTIFICATE-----\`n")
`

let certDir: string | undefined
let httpsServer: https.Server | undefined
let httpServer: http.Server | undefined
let httpsPort = 0
let httpPort = 0

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve((server.address() as { port: number }).port)
    })
  })
}

async function closeServer(server?: http.Server | https.Server) {
  if (!server || !server.listening)
    return
  await new Promise<void>(resolve => server.close(() => resolve()))
  server.closeAllConnections?.()
}

async function generateCertificate(dir: string) {
  const scriptPath = path.join(dir, 'make-cert.ps1')
  await writeFile(scriptPath, CERT_SCRIPT, 'utf8')
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-OutDir',
    dir,
  ]
  try {
    await execFileAsync('pwsh', args, { windowsHide: true })
  }
  catch (cause) {
    throw new Error(
      `無法以 pwsh 產生執行期自簽憑證（不新增依賴、不安裝系統憑證）：${String(cause)}`,
    )
  }
}

test.beforeAll(async () => {
  certDir = await mkdtemp(path.join(os.tmpdir(), 'moorread-e2e-favicon-'))
  await generateCertificate(certDir)
  const key = await readFile(path.join(certDir, 'key.pem'))
  const cert = await readFile(path.join(certDir, 'cert.pem'))

  httpsServer = https.createServer({ key, cert }, (req, res) => {
    if ((req.url ?? '').startsWith('/s2/favicons')) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
      })
      res.end(PNG)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  const pageHtml = `<!doctype html><html><head><meta charset="utf-8">
<link rel="icon" type="image/png" href="/icon.png"><title>favicon e2e</title></head>
<body>favicon e2e</body></html>`
  httpServer = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(pageHtml)
      return
    }
    if (req.url === '/icon.png' || req.url === '/favicon.ico') {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
      })
      res.end(PNG)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })

  httpsPort = await listen(httpsServer)
  httpPort = await listen(httpServer)
})

test.afterAll(async () => {
  try {
    await closeServer(httpsServer)
    await closeServer(httpServer)
  }
  finally {
    if (certDir)
      await rm(certDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

interface FaviconSession {
  close: () => Promise<void>
  extensionPage: Page
  worker: Worker
}

// favicon 專用 context：只有這裡使用 --host-resolver-rules 與 --ignore-certificate-errors，
// 其他 spec 的瀏覽器設定完全不受影響。
async function openFaviconSession(): Promise<FaviconSession> {
  const extensionPath = path.resolve(
    process.env.MOORREAD_E2E_EXT_PATH ?? 'build/chrome-mv3-prod',
  )
  const userDataDir = await createProfile('moorread-e2e-favicon-', 'e2e/favicon.spec.ts')
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    locale: 'zh-TW',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--host-resolver-rules=MAP www.google.com 127.0.0.1:${httpsPort}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  const close = async () => {
    await context.close()
    // 暫存 profile 由本測試建立，必須在 finally 一併移除（避免長期累積拖垮磁碟 IO）。
    await removeProfile(userDataDir)
  }
  try {
    let [worker] = context.serviceWorkers()
    worker ??= await context.waitForEvent('serviceworker')
    const extensionId = new URL(worker.url()).host
    const extensionPage = await context.newPage()
    await extensionPage.goto(`chrome-extension://${extensionId}/newtab.html`)
    await extensionPage.waitForLoadState('domcontentloaded')
    return { close, extensionPage, worker }
  }
  catch (error) {
    await close()
    throw error
  }
}

test('loads remote favicons with a browser API fallback', async () => {
  const session = await openFaviconSession()
  try {
    const { extensionPage, worker } = session

    // A-1：真實 Service Worker fetch 原本的 Google URL（經 host-resolver 導向本機 HTTPS）。
    const sw = await worker.evaluate(async (url) => {
      const response = await fetch(url)
      const buffer = await response.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (const byte of bytes)
        binary += String.fromCharCode(byte)
      return {
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        length: bytes.length,
        bodyB64: btoa(binary),
      }
    }, GOOGLE_URL)

    expect(sw.status).toBe(200)
    expect(sw.type).toBe('image/png')
    expect(sw.length).toBe(PNG.length)
    expect(createHash('sha256').update(Buffer.from(sw.bodyB64, 'base64')).digest('hex'))
      .toBe(PNG_SHA)

    // A-2：走產品既有的訊息處理路徑（未修改產品碼）。
    const remote = await extensionPage.evaluate(async (url) => {
      const response = await chrome.runtime.sendMessage({
        type: 'moorread:fetch-remote-favicon',
        url,
      }) as { base64?: string, bytes?: number[], ok: boolean, type?: string }
      const size = response.base64
        ? atob(response.base64).length
        : (response.bytes?.length ?? 0)
      return { ok: response.ok, size, type: response.type ?? '', base64: response.base64 ?? '' }
    }, GOOGLE_URL)

    expect(remote.ok).toBe(true)
    expect(remote.size).toBeGreaterThan(0)
    expect(remote.type).toMatch(/^image\//)
    expect(createHash('sha256').update(Buffer.from(remote.base64, 'base64')).digest('hex'))
      .toBe(PNG_SHA)

    // B：先造訪本機測試頁，再呼叫 Chrome 內建 _favicon 後備介面。
    // 注意：這只證明 Chrome 的後備圖示介面可用；已證實未造訪頁面也會回預設圖示，
    // 因此 ok／size>0／image/* 不代表已取得指定網站的自訂圖示。
    const localPage = await contextPage(session.extensionPage)
    const pageUrl = `http://127.0.0.1:${httpPort}/page`
    try {
      await localPage.goto(pageUrl)
      await localPage.waitForTimeout(2000)
    }
    finally {
      await localPage.close()
    }

    const browser = await extensionPage.evaluate(async (target) => {
      const url = new URL(chrome.runtime.getURL('/_favicon/'))
      url.searchParams.set('pageUrl', target)
      url.searchParams.set('size', '128')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(url.toString(), { signal: controller.signal })
        const blob = await response.blob()
        return { ok: response.ok, status: response.status, size: blob.size, type: blob.type }
      }
      finally {
        clearTimeout(timer)
      }
    }, pageUrl)

    expect(browser.ok).toBe(true)
    expect(browser.size).toBeGreaterThan(0)
    expect(browser.type).toMatch(/^image\//)
  }
  finally {
    await session.close()
  }
})

// 取得與 extensionPage 同一個 context 的新分頁（不影響 extensionPage 的擴充來源）。
async function contextPage(extensionPage: Page): Promise<Page> {
  return extensionPage.context().newPage()
}
