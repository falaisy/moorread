import { parseFullBookmarkSnapshot } from './backup'
import { hasBackupConsent, loadBackupConsent } from './backup-consent'
import { legacyMigrationReady } from './legacy-migration-gate'
import { decryptMetadataText, encryptMetadataText, isEncryptedMetadataEnvelope } from './metadata-crypto'
import { createStoragePort } from './storage-port'

export const WEBDAV_CONFIG_KEY = 'moorread:webdav-config'
export const WEBDAV_STATUS_KEY = 'moorread:webdav-status'
const obsoleteHistoryKeys = ['moorread:webdav-history', 'yunji-tab:webdav-history'] // 新舊 key 都清
export const WEBDAV_FILENAME = 'moorread-full-snapshot.json'
export const WEBDAV_DEFAULT_URL = 'https://dav.jianguoyun.com/dav/'
const backupStorage = createStoragePort('local')
const lockName = 'moorread:webdav-backup'
// Older snapshots are pruned after each upload so the remote folder cannot grow forever.
export const WEBDAV_BACKUP_RETENTION = 10
const encryptedSnapshotKind = 'moorread-encrypted-full-snapshot'
// 0.1.5／0.1.6 上傳的加密快照外殼；`metadata-crypto.ts` 自 dae60e5 起未變更，
// 格式（AES-GCM／PBKDF2-SHA-256／150000 次）與現行完全相同，因此可直接沿用同一套解密與驗證。
const legacyEncryptedSnapshotKind = 'yunji-tab-encrypted-full-snapshot'
const webdavPasswordKey = 'moorread:webdav-password'
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const timestampPattern = '(\\d{8}T\\d{9}Z)'
const filenamePattern = new RegExp(`^moorread-backup-${timestampPattern}-${uuidPattern}\\.json$`)
const legacyFilenamePattern = new RegExp(`^(?:yunji-tab-backup-${timestampPattern}-${uuidPattern}|yunji-tab-snapshot-${uuidPattern})\\.json$`)
const legacyFixedFilename = 'yunji-tab-full-snapshot.json'

export interface WebdavConfig {
  enabled: boolean
  url: string
  username: string
  password: string
  intervalHours: number
  encryptionPassphrase?: string
}

export interface WebdavStatus {
  lastSuccessAt?: number
  lastCheckedAt?: number
  fingerprint?: string
  error?: WebdavErrorCode
  lastResult?: 'uploaded' | 'unchanged' | 'failed'
}

export interface WebdavBackupFile {
  filename: string
  timestamp?: number
  size?: number
  etag?: string
  directory: string
  username: string
}

export type WebdavErrorCode = 'address' | 'insecure' | 'credentials' | 'permission' | 'auth' | 'missing' | 'network' | 'server' | 'invalid' | 'changed' | 'passphrase' | 'decrypt' | 'migration'

class WebdavError extends Error {
  constructor(public code: WebdavErrorCode) {
    super(`webdav.${code}`)
  }
}

export function webdavErrorCode(error: unknown): WebdavErrorCode {
  return error instanceof WebdavError ? error.code : 'network'
}

// The password lives in session storage only, which Chrome clears when the browser closes.
async function readSessionPassword(): Promise<string> {
  const stored = await chrome.storage.session.get(webdavPasswordKey)
  const value = stored?.[webdavPasswordKey]
  return typeof value === 'string' ? value : ''
}

export async function loadWebdavConfig(): Promise<WebdavConfig> {
  const [stored, sessionPassword] = await Promise.all([
    backupStorage.get<Partial<Omit<WebdavConfig, 'password'>>>(WEBDAV_CONFIG_KEY),
    readSessionPassword(),
    ...obsoleteHistoryKeys.map(key => backupStorage.remove(key)), // Discard obsolete local history; files stay on WebDAV.
  ])
  return {
    enabled: stored?.enabled === true,
    url: typeof stored?.url === 'string' ? stored.url : WEBDAV_DEFAULT_URL,
    username: typeof stored?.username === 'string' ? stored.username : '',
    password: sessionPassword,
    encryptionPassphrase: typeof stored?.encryptionPassphrase === 'string' ? stored.encryptionPassphrase : '',
    intervalHours: [1, 6, 24, 72].includes(stored?.intervalHours ?? 0) ? stored!.intervalHours! : 24,
  }
}

export async function loadWebdavStatus(): Promise<WebdavStatus> {
  return await backupStorage.get<WebdavStatus>(WEBDAV_STATUS_KEY) ?? {}
}

function filenameTimestamp(filename: string): number | undefined {
  const compact = filename.match(filenamePattern)?.[1]
    ?? filename.match(legacyFilenamePattern)?.[1]
  if (!compact)
    return undefined
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.${compact.slice(15, 18)}Z`
  const time = Date.parse(iso)
  return Number.isFinite(time) && new Date(time).toISOString() === iso ? time : undefined
}

function isBackupFilename(filename: string): boolean {
  return filenameTimestamp(filename) !== undefined
    || legacyFilenamePattern.test(filename)
    || filename === WEBDAV_FILENAME
    || filename === legacyFixedFilename
}

export function webdavDirectory(config: WebdavConfig): URL {
  let url: URL
  try {
    url = new URL(config.url.trim())
  }
  catch {
    throw new WebdavError('address')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new WebdavError('address')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new WebdavError('insecure')
  if (!config.username.trim() || config.username.includes(':') || !config.password)
    throw new WebdavError('credentials')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}

export function requestWebdavPermission(config: WebdavConfig): Promise<boolean> {
  const url = webdavDirectory(config)
  // Call directly from the button handler; no await may consume the user gesture.
  return chrome.permissions.request({ origins: [`${url.protocol}//${url.host}/*`] })
}

async function withWebdavLock<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(lockName, task)
}

export async function saveWebdavConfig(config: WebdavConfig): Promise<void> {
  const { password, ...rest } = config
  const normalized = { ...rest, url: webdavDirectory(config).href, username: config.username.trim(), encryptionPassphrase: config.encryptionPassphrase ?? '' }
  await withWebdavLock(async () => {
    const previous = await loadWebdavConfig()
    if (previous.url !== normalized.url || previous.username !== normalized.username || previous.password !== password
      || previous.encryptionPassphrase !== normalized.encryptionPassphrase) {
      await backupStorage.remove(WEBDAV_STATUS_KEY)
    }
    await Promise.all([
      backupStorage.set(WEBDAV_CONFIG_KEY, normalized),
      chrome.storage.session.set({ [webdavPasswordKey]: password }),
    ])
  })
}

export async function forgetWebdavConfig(): Promise<void> {
  await withWebdavLock(async () => {
    await Promise.all([
      backupStorage.remove(WEBDAV_CONFIG_KEY),
      backupStorage.remove(WEBDAV_STATUS_KEY),
      ...obsoleteHistoryKeys.map(key => backupStorage.remove(key)),
      chrome.storage.session.remove(webdavPasswordKey),
    ])
  })
}

// Larger payloads get more time before we give up; a fixed 30s made big backups fail forever.
function requestTimeoutMs(payloadBytes: number): number {
  return Math.min(300_000, 30_000 + Math.ceil(payloadBytes / 262_144) * 10_000)
}

async function webdavRequest(config: WebdavConfig, method: 'PROPFIND' | 'PUT' | 'GET' | 'DELETE', body?: string, filename = WEBDAV_FILENAME, depth: '0' | '1' = '0', etag?: string, timeoutMs = 30_000): Promise<Response> {
  const directory = webdavDirectory(config)
  if (!await chrome.permissions.contains({ origins: [`${directory.protocol}//${directory.host}/*`] }))
    throw new WebdavError('permission')
  const bytes = new TextEncoder().encode(`${config.username.trim()}:${config.password}`)
  const authorization = `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`
  const response = await fetch(method === 'PROPFIND' ? directory.href : new URL(filename, directory).href, {
    method,
    headers: {
      Authorization: authorization,
      ...(method === 'PROPFIND' ? { 'Depth': depth, 'Content-Type': 'application/xml; charset=utf-8' } : {}),
      ...(method === 'PUT' ? { 'Content-Type': 'application/json; charset=utf-8', 'If-None-Match': '*' } : {}),
      ...(method === 'GET' && etag ? { 'If-Match': etag } : {}),
    },
    body: method === 'PROPFIND' ? '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>' : body,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    await response.body?.cancel()
    if (method === 'GET' && response.status === 412)
      throw new WebdavError('changed')
    throw new WebdavError(response.status === 401 || response.status === 403 ? 'auth' : response.status === 404 || response.status === 409 ? 'missing' : 'server')
  }
  return response
}

function davChildren(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(child => child.namespaceURI === 'DAV:' && child.localName === name)
}

function davText(element: Element, name: string): string {
  return davChildren(element, name)[0]?.textContent?.trim() ?? ''
}

function successfulProperties(response: Element): Element[] {
  return davChildren(response, 'propstat')
    .filter(stat => /^HTTP\/\d(?:\.\d)?\s+200(?:\s|$)/.test(davText(stat, 'status')))
    .flatMap(stat => davChildren(stat, 'prop'))
}

async function readMultistatus(response: Response): Promise<Document> {
  if (response.status !== 207) {
    await response.body?.cancel()
    throw new WebdavError('server')
  }
  const document = new DOMParser().parseFromString(await response.text(), 'application/xml')
  if (document.getElementsByTagName('parsererror').length
    || document.documentElement.namespaceURI !== 'DAV:' || document.documentElement.localName !== 'multistatus') {
    throw new WebdavError('server')
  }
  return document
}

export async function testWebdavConnection(config: WebdavConfig): Promise<void> {
  const document = await readMultistatus(await webdavRequest(config, 'PROPFIND'))
  const properties = davChildren(document.documentElement, 'response').flatMap(successfulProperties)
  if (!properties.some(prop => davChildren(prop, 'resourcetype').some(type => davChildren(type, 'collection').length > 0)))
    throw new WebdavError('missing')
}

async function listBackupFiles(config: WebdavConfig): Promise<WebdavBackupFile[]> {
  const directory = webdavDirectory(config)
  const document = await readMultistatus(await webdavRequest(config, 'PROPFIND', undefined, undefined, '1'))
  const files = new Map<string, WebdavBackupFile>()
  for (const response of davChildren(document.documentElement, 'response')) {
    const properties = successfulProperties(response)
    const status = davText(response, 'status')
    if (!properties.length || (status && !/^HTTP\/\d(?:\.\d)?\s+2\d\d(?:\s|$)/.test(status)))
      continue
    if (properties.some(prop => davChildren(prop, 'resourcetype').some(type => davChildren(type, 'collection').length)))
      continue
    let filename: string
    try {
      const href = davText(response, 'href')
      if (!href)
        continue
      const url = new URL(href, directory)
      if (url.origin !== directory.origin || url.username || url.password || url.search || url.hash)
        continue
      const path = decodeURIComponent(url.pathname)
      const base = decodeURIComponent(directory.pathname)
      if (!path.startsWith(base))
        continue
      filename = path.slice(base.length)
      if (!isBackupFilename(filename))
        continue
    }
    catch {
      continue
    }
    if (files.has(filename))
      continue
    const property = (name: string) => properties.map(prop => davText(prop, name)).find(Boolean) ?? ''
    const modified = Date.parse(property('getlastmodified'))
    const length = property('getcontentlength')
    const size = /^\d+$/.test(length) ? Number(length) : undefined
    const etag = property('getetag')
    files.set(filename, {
      filename,
      timestamp: filenameTimestamp(filename) ?? (Number.isFinite(modified) ? modified : undefined),
      size: size !== undefined && Number.isSafeInteger(size) ? size : undefined,
      etag: /^"[\x21\x23-\x7E]*"$/.test(etag) ? etag : undefined,
      directory: directory.href,
      username: config.username,
    })
  }
  return Array.from(files.values()).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || b.filename.localeCompare(a.filename))
}

export async function listWebdavBackups(): Promise<WebdavBackupFile[]> {
  return withWebdavLock(async () => listBackupFiles(await loadWebdavConfig()))
}

// Best effort: a failed prune must never fail the upload that already succeeded.
async function pruneBackupFiles(config: WebdavConfig): Promise<void> {
  let files: WebdavBackupFile[]
  try {
    files = await listBackupFiles(config)
  }
  catch {
    return
  }
  for (const file of files.slice(WEBDAV_BACKUP_RETENTION)) {
    try {
      const response = await webdavRequest(config, 'DELETE', undefined, file.filename)
      await response.body?.cancel()
    }
    catch {
      // Leave the file for the next run; retention is best effort.
    }
  }
}

export async function readWebdavBackup(selected?: WebdavBackupFile, passphraseOverride?: string): Promise<string> {
  return withWebdavLock(async () => {
    const config = await loadWebdavConfig()
    const file = selected ?? (await listBackupFiles(config))[0]
    if (!file || !isBackupFilename(file.filename) || file.directory !== webdavDirectory(config).href || file.username !== config.username)
      throw new WebdavError('missing')
    const response = await webdavRequest(config, 'GET', undefined, file.filename, undefined, file.etag, requestTimeoutMs(file.size ?? 0))
    let raw = await response.text()
    let value: unknown
    try {
      value = JSON.parse(raw)
    }
    catch {
      throw new WebdavError('invalid')
    }
    if (typeof value === 'object' && value !== null && 'kind' in value
      && (value.kind === encryptedSnapshotKind || value.kind === legacyEncryptedSnapshotKind)) {
      if (!('schemaVersion' in value) || value.schemaVersion !== 1 || !('payload' in value)
        || !isEncryptedMetadataEnvelope(value.payload)
        || !Number.isSafeInteger(value.payload.iterations) || value.payload.iterations < 100_000 || value.payload.iterations > 1_000_000
        || !/^[A-Z0-9+/]{22}==$/i.test(value.payload.salt) || !/^[A-Z0-9+/]{16}$/i.test(value.payload.iv)) {
        throw new WebdavError('invalid')
      }
      const passphrase = passphraseOverride ?? config.encryptionPassphrase
      if (!passphrase)
        throw new WebdavError('passphrase')
      try {
        raw = await decryptMetadataText(value.payload, passphrase)
      }
      catch {
        throw new WebdavError('decrypt')
      }
    }
    try {
      parseFullBookmarkSnapshot(raw)
    }
    catch {
      throw new WebdavError('invalid')
    }
    return raw
  })
}

export async function snapshotFingerprint(raw: string): Promise<string> {
  const snapshot = parseFullBookmarkSnapshot(raw)
  // Export timestamps change on every read, even when the backed-up data did not.
  const { exportedAt: _exportedAt, moorread, legacy: _legacy, ...rest } = snapshot
  // presentSettings／bookmarkGroupsProvided 只是解析輔助，不是備份內容，不能影響指紋。
  const {
    exportedAt: _metadataExportedAt,
    presentSettings: _presentSettings,
    bookmarkGroupsProvided: _bookmarkGroupsProvided,
    gistBackupCleared: _gistBackupCleared,
    ...metadata
  } = moorread
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(stable)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]))
    return value
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable({ ...rest, moorread: metadata }))))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function runWebdavBackup(exportSnapshot: () => Promise<string>, manual = false): Promise<'uploaded' | 'unchanged' | 'skipped'> {
  // 舊資料還沒搬完（或狀態不明）時，快照會缺少 `yunji-tab:*` 的資料，
  // 而且寫 `moorread:webdav-status` 會讓 keep-new 遷移跳過舊狀態。
  // 自動與手動備份都必須通過同一個 gate；不把 `initialized` 當成遷移成功。
  // gate 必須在備份鎖之外：遷移自己會取遷移鎖，避免巢狀取鎖。
  if (!await legacyMigrationReady())
    throw new WebdavError('migration')
  return withWebdavLock(async () => {
    const config = await loadWebdavConfig()
    if (!manual && !config.enabled)
      return 'skipped'
    // 自動備份必須先取得使用者明示同意；升級前已啟用但未同意者一律暫停，
    // 避免在沒有充分告知的情況下自動傳輸。
    if (!manual && !hasBackupConsent(await loadBackupConsent(), 'webdav-auto'))
      return 'skipped'
    const status = await loadWebdavStatus()
    const now = Date.now()
    if (!manual && now - (status.lastCheckedAt ?? 0) < config.intervalHours * 3_600_000)
      return 'skipped'
    try {
      const raw = await exportSnapshot()
      const fingerprint = await snapshotFingerprint(raw)
      if (!manual && status.fingerprint === fingerprint) {
        await backupStorage.set(WEBDAV_STATUS_KEY, { ...status, lastCheckedAt: now, error: undefined, lastResult: 'unchanged' })
        return 'unchanged'
      }
      const timestamp = new Date(now).toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('.', '')
      const filename = `moorread-backup-${timestamp}-${crypto.randomUUID()}.json`
      const body = config.encryptionPassphrase
        ? JSON.stringify({
            kind: encryptedSnapshotKind,
            schemaVersion: 1,
            payload: await encryptMetadataText({ plaintext: raw, passphrase: config.encryptionPassphrase, updatedAt: now, deviceId: '' }),
          })
        : raw
      const response = await webdavRequest(config, 'PUT', body, filename, undefined, undefined, requestTimeoutMs(body.length))
      await response.body?.cancel()
      await pruneBackupFiles(config)
      await backupStorage.set(WEBDAV_STATUS_KEY, { lastSuccessAt: Date.now(), lastCheckedAt: now, fingerprint, lastResult: 'uploaded' })
      return 'uploaded'
    }
    catch (error) {
      // Keep the previous successful checkpoint, and throttle failed auto attempts.
      const code = webdavErrorCode(error)
      await backupStorage.set(WEBDAV_STATUS_KEY, { ...status, lastCheckedAt: now, error: code, lastResult: 'failed' })
      throw error
    }
  })
}
