import { createStoragePort } from './storage-port'

/**
 * 備份相關傳輸的同意範圍。上傳與讀取分開，Gist 與 WebDAV 也分開：
 * - gist：上傳完整快照到 Gist
 * - gist-read：讀取 Gist、測試 Gist 連線
 * - webdav：上傳完整快照到 WebDAV
 * - webdav-read：測試連線、讀取遠端紀錄、還原
 * - webdav-auto：開啟新分頁時自動上傳
 */
export type BackupConsentScope
  = | 'gist'
    | 'gist-read'
    | 'webdav'
    | 'webdav-read'
    | 'webdav-auto'

export type BackupConsentRecord = Partial<Record<BackupConsentScope, number>>

export const BACKUP_CONSENT_KEY = 'moorread:backup-consent'

export const BACKUP_CONSENT_SCOPES: readonly BackupConsentScope[] = [
  'gist',
  'gist-read',
  'webdav',
  'webdav-read',
  'webdav-auto',
]

const consentStorage = createStoragePort('local')

function isValidConsentTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * 只接受「已知範圍 + 安全正整數時間戳」；陣列、字串、NaN、Infinity、負數、
 * 小數、超大值與未知欄位一律丟棄。任何異常形狀都退回空紀錄（fail-closed）。
 */
function sanitizeConsentRecord(stored: unknown): BackupConsentRecord {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return {}
  const source = stored as Record<string, unknown>
  const record: BackupConsentRecord = {}
  for (const scope of BACKUP_CONSENT_SCOPES) {
    if (isValidConsentTime(source[scope]))
      record[scope] = source[scope]
  }
  return record
}

/** 讀取同意紀錄；讀取失敗或格式異常視為未同意，寧可多問一次也不得未經同意傳輸。 */
export async function loadBackupConsent(): Promise<BackupConsentRecord> {
  try {
    return sanitizeConsentRecord(await consentStorage.get(BACKUP_CONSENT_KEY))
  }
  catch {
    return {}
  }
}

export function hasBackupConsent(
  record: BackupConsentRecord,
  scope: BackupConsentScope,
): boolean {
  return isValidConsentTime(record[scope])
}

// 同一頁面內的同意寫入必須序列化，避免「讀取→修改→寫入」互相覆蓋。
let consentWriteQueue: Promise<unknown> = Promise.resolve()

function enqueueConsentWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = consentWriteQueue.then(task, task)
  consentWriteQueue = next.catch(() => undefined)
  return next
}

export function grantBackupConsent(scope: BackupConsentScope): Promise<void> {
  return enqueueConsentWrite(async () => {
    const record = await loadBackupConsent()
    await consentStorage.set(BACKUP_CONSENT_KEY, { ...record, [scope]: Date.now() })
  })
}

/** 撤回所有備份同意；既有設定與憑證保留，但所有自發與手動傳輸都會重新詢問。 */
export function revokeBackupConsent(): Promise<void> {
  return enqueueConsentWrite(async () => {
    await consentStorage.remove(BACKUP_CONSENT_KEY)
  })
}

export type ManualConsentOutcome<T>
  = | { status: 'denied' }
    | { status: 'completed', result: T }

/**
 * 傳輸前的同意 gate：未同意時先詢問，拒絕就完全不做任何事
 * （不匯出快照、不發出請求）。
 */
export async function runWithManualConsent<T>(
  scope: BackupConsentScope,
  askConsent: () => Promise<boolean>,
  run: () => Promise<T>,
): Promise<ManualConsentOutcome<T>> {
  const record = await loadBackupConsent()
  if (!hasBackupConsent(record, scope)) {
    if (!await askConsent())
      return { status: 'denied' }
    await grantBackupConsent(scope)
  }
  return { status: 'completed', result: await run() }
}
