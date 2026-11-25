import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFullBookmarkSnapshot, createMoorreadBackup } from './backup'
import { normalizeSettings } from './store-settings-state'

const state = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock('@plasmohq/storage', () => ({
  Storage: class {
    async get(key: string) { return structuredClone(state.values.get(key)) }
    async set(key: string, value: unknown) { state.values.set(key, structuredClone(value)) }
    async remove(key: string) { state.values.delete(key) }
  },
}))

const sessionValues = new Map<string, unknown>()
const sessionStorageArea = {
  async get(key: string) {
    return sessionValues.has(key) ? { [key]: structuredClone(sessionValues.get(key)) } : {}
  },
  async set(values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values))
      sessionValues.set(key, structuredClone(value))
  },
  async remove(key: string) { sessionValues.delete(key) },
}
const emptyStorageArea = {
  async get() { return {} },
  async set() {},
  async remove() {},
}
const permissions = { contains: vi.fn(async () => true), request: vi.fn(async () => true) }
const fetchMock = vi.fn()

const config = { enabled: true, url: 'https://dav.example.com/backups/', username: 'kiwi', password: 'test-app-password', intervalHours: 24, encryptionPassphrase: '' }

function snapshot() {
  return JSON.stringify(createFullBookmarkSnapshot({
    moorread: createMoorreadBackup({ settings: normalizeSettings({}), meta: {}, usage: {}, categoryMeta: {}, categories: [] }),
    nativeRoots: [],
  }))
}

beforeEach(() => {
  state.values.clear()
  sessionValues.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(null, { status: 201 }))
  state.values.set('moorread:webdav-config', config)
  sessionValues.set('moorread:webdav-password', config.password)
  // 自動備份需要使用者明示同意；此檔驗證的是遷移 gate，同意狀態視為已取得。
  state.values.set('moorread:backup-consent', { 'webdav-auto': Date.now() })
  vi.stubGlobal('chrome', { permissions, storage: { session: sessionStorageArea } })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, task: () => Promise<unknown>) => task() },
  })
})

describe('webDAV backup respects the legacy migration gate', () => {
  it('blocks auto and manual backups when the migration state is unavailable', async () => {
    const { runWebdavBackup, WEBDAV_STATUS_KEY } = await import('./webdav-backup')
    // 沒有 chrome.storage.local／sync → 遷移狀態不可驗證，一律視為未就緒。
    await expect(runWebdavBackup(async () => '{}')).rejects.toMatchObject({ message: 'webdav.migration' })
    await expect(runWebdavBackup(async () => '{}', true)).rejects.toMatchObject({ message: 'webdav.migration' })
    expect(state.values.has(WEBDAV_STATUS_KEY)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resumes both auto and manual backups once the migration state is ready', async () => {
    vi.stubGlobal('chrome', {
      permissions,
      storage: { session: sessionStorageArea, local: emptyStorageArea, sync: emptyStorageArea },
    })
    const { runWebdavBackup, WEBDAV_STATUS_KEY } = await import('./webdav-backup')
    await expect(runWebdavBackup(async () => snapshot(), true)).resolves.toBe('uploaded')
    expect(state.values.has(WEBDAV_STATUS_KEY)).toBe(true)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true)

    // 自動備份也恢復：清掉狀態（等同間隔到期）後應再次上傳。
    state.values.delete(WEBDAV_STATUS_KEY)
    await expect(runWebdavBackup(async () => snapshot())).resolves.toBe('uploaded')
  })
})
