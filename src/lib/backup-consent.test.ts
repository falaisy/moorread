import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_CONSENT_KEY,
  grantBackupConsent,
  hasBackupConsent,
  loadBackupConsent,
  revokeBackupConsent,
  runWithManualConsent,
} from './backup-consent'

const storageState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  failReads: false,
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    async get(key: string) {
      if (storageState.failReads)
        throw new Error('storage unavailable')
      return structuredClone(storageState.values.get(key))
    }

    async set(key: string, value: unknown) {
      storageState.values.set(key, structuredClone(value))
    }

    async remove(key: string) {
      storageState.values.delete(key)
    }
  },
}))

beforeEach(() => {
  storageState.values.clear()
  storageState.failReads = false
  vi.restoreAllMocks()
})

describe('備份傳輸同意狀態', () => {
  it('預設沒有任何同意紀錄', async () => {
    expect(await loadBackupConsent()).toEqual({})
    expect(hasBackupConsent(await loadBackupConsent(), 'gist')).toBe(false)
    expect(hasBackupConsent(await loadBackupConsent(), 'webdav')).toBe(false)
    expect(hasBackupConsent(await loadBackupConsent(), 'webdav-auto')).toBe(false)
  })

  it('同意後寫入帶時間戳的紀錄，且各服務互不影響', async () => {
    await grantBackupConsent('gist')
    const record = await loadBackupConsent()
    expect(hasBackupConsent(record, 'gist')).toBe(true)
    expect(hasBackupConsent(record, 'webdav')).toBe(false)
    expect(storageState.values.get(BACKUP_CONSENT_KEY)).toMatchObject({ gist: expect.any(Number) })
  })

  it('儲存讀取失敗時視為未同意（fail-closed）', async () => {
    storageState.failReads = true
    expect(await loadBackupConsent()).toEqual({})
  })
})

describe('a5 手動傳輸前的明示同意', () => {
  it('拒絕同意時不執行任何傳輸，也不寫入同意紀錄', async () => {
    const run = vi.fn(async () => 'uploaded')
    const askConsent = vi.fn(async () => false)

    const outcome = await runWithManualConsent('gist', askConsent, run)

    expect(outcome).toEqual({ status: 'denied' })
    expect(askConsent).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(storageState.values.has(BACKUP_CONSENT_KEY)).toBe(false)
  })

  it('同意後才執行傳輸，並記住同意避免每次詢問', async () => {
    const run = vi.fn(async () => 'uploaded')
    const askConsent = vi.fn(async () => true)

    await expect(runWithManualConsent('gist', askConsent, run))
      .resolves
      .toEqual({ status: 'completed', result: 'uploaded' })
    expect(run).toHaveBeenCalledTimes(1)

    await expect(runWithManualConsent('gist', askConsent, async () => 'again'))
      .resolves
      .toEqual({ status: 'completed', result: 'again' })
    expect(askConsent).toHaveBeenCalledTimes(1)
  })

  it('各服務分別同意：同意 Gist 不代表同意 WebDAV', async () => {
    const askConsent = vi.fn(async () => true)
    await runWithManualConsent('gist', askConsent, async () => 'ok')
    const webdavRun = vi.fn(async () => 'ok')

    const outcome = await runWithManualConsent('webdav', async () => false, webdavRun)
    expect(outcome).toEqual({ status: 'denied' })
    expect(webdavRun).not.toHaveBeenCalled()
  })
})

describe('mr149 f01 同意紀錄格式驗證', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['負數', -1],
    ['0', 0],
    ['小數', 1.5],
    ['超大值', 1e300],
    ['字串', '1700000000000'],
    ['布林', true],
    ['物件', { at: 1 }],
  ])('%s 一律視為未同意', async (_label, value) => {
    storageState.values.set(BACKUP_CONSENT_KEY, { gist: value })
    expect(hasBackupConsent(await loadBackupConsent(), 'gist')).toBe(false)
  })

  it('有效時間戳才視為同意', async () => {
    storageState.values.set(BACKUP_CONSENT_KEY, { gist: Date.now() })
    expect(hasBackupConsent(await loadBackupConsent(), 'gist')).toBe(true)
  })

  it('陣列或非物件紀錄一律回空', async () => {
    storageState.values.set(BACKUP_CONSENT_KEY, [Date.now()])
    expect(await loadBackupConsent()).toEqual({})
    storageState.values.set(BACKUP_CONSENT_KEY, 'yes')
    expect(await loadBackupConsent()).toEqual({})
    storageState.values.set(BACKUP_CONSENT_KEY, 1)
    expect(await loadBackupConsent()).toEqual({})
  })

  it('只保留已知且有效的欄位', async () => {
    storageState.values.set(BACKUP_CONSENT_KEY, {
      'gist': Date.now(),
      'webdav': Number.NaN,
      'webdav-auto': 'x',
      'unknown': Date.now(),
    })
    expect(await loadBackupConsent()).toEqual({ gist: expect.any(Number) })
  })
})

describe('mr149 f05 同意寫入競態', () => {
  it('並行同意不同範圍時兩者都保留', async () => {
    await Promise.all([
      grantBackupConsent('gist'),
      grantBackupConsent('webdav'),
      grantBackupConsent('gist-read'),
    ])
    const record = await loadBackupConsent()
    expect(hasBackupConsent(record, 'gist')).toBe(true)
    expect(hasBackupConsent(record, 'webdav')).toBe(true)
    expect(hasBackupConsent(record, 'gist-read')).toBe(true)
  })
})

describe('mr149 f04 撤回同意', () => {
  it('撤回後清除所有範圍', async () => {
    await grantBackupConsent('gist')
    await grantBackupConsent('gist-read')
    await grantBackupConsent('webdav')
    await grantBackupConsent('webdav-read')
    await grantBackupConsent('webdav-auto')

    await revokeBackupConsent()

    expect(await loadBackupConsent()).toEqual({})
    for (const scope of ['gist', 'gist-read', 'webdav', 'webdav-read', 'webdav-auto'] as const)
      expect(hasBackupConsent(await loadBackupConsent(), scope)).toBe(false)
  })
})

describe('mr149 f03 讀取與測試入口的獨立同意', () => {
  it('gist 讀取同意獨立於上傳同意', async () => {
    const run = vi.fn(async () => 'read')
    const outcome = await runWithManualConsent('gist-read', async () => false, run)
    expect(outcome).toEqual({ status: 'denied' })
    expect(run).not.toHaveBeenCalled()
  })

  it('webdav 讀取同意獨立於上傳與自動備份同意', async () => {
    await grantBackupConsent('webdav')
    await grantBackupConsent('webdav-auto')
    const run = vi.fn(async () => 'read')
    const outcome = await runWithManualConsent('webdav-read', async () => false, run)
    expect(outcome).toEqual({ status: 'denied' })
    expect(run).not.toHaveBeenCalled()
  })

  it('同意紀錄格式無效時，讀取入口同樣不執行', async () => {
    storageState.values.set(BACKUP_CONSENT_KEY, { 'gist-read': Number.NaN })
    const run = vi.fn(async () => 'read')
    const outcome = await runWithManualConsent('gist-read', async () => false, run)
    expect(outcome).toEqual({ status: 'denied' })
    expect(run).not.toHaveBeenCalled()
  })
})
