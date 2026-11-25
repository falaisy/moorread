import type { Settings } from './types'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFullBookmarkSnapshot, createMoorreadBackup } from './backup'
import { useBookmarkGroupsStore } from './bookmark-groups-store'
import { uploadToGist } from './gist-backup'
import { useNavStore } from './store'
import { DEFAULT_SETTINGS } from './store-settings-state'

const storageState = vi.hoisted(() => ({
  writes: [] as Array<{ area: string, key: string, value: unknown }>,
  values: new Map<string, unknown>(),
  setError: null as Error | null,
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    area: string

    constructor(options: { area: string }) {
      this.area = options.area
    }

    async get(key: string) {
      return structuredClone(storageState.values.get(`${this.area}:${key}`))
    }

    async set(key: string, value: unknown) {
      if (storageState.setError)
        throw storageState.setError
      storageState.writes.push({ area: this.area, key, value })
      storageState.values.set(`${this.area}:${key}`, structuredClone(value))
    }

    async remove(key: string) {
      storageState.values.delete(`${this.area}:${key}`)
    }
  },
}))

const CURRENT_TOKEN = 'ghp_existing_token'
const CURRENT_PASSPHRASE = 'existing-passphrase'
const CURRENT_GIST_ID = 'gist-existing'

const currentSettings: Settings = {
  ...DEFAULT_SETTINGS,
  gistBackup: {
    token: CURRENT_TOKEN,
    gistId: CURRENT_GIST_ID,
    encrypt: true,
    passphrase: CURRENT_PASSPHRASE,
  },
}

function exportedBackup(overrides: {
  settings?: (settings: Record<string, unknown>) => void
} = {}): string {
  const backup = createMoorreadBackup({
    settings: currentSettings,
    meta: {},
    usage: {},
    categoryMeta: {},
    categories: [],
    bookmarkGroups: [],
  })
  const settings = backup.settings as unknown as Record<string, unknown>
  overrides.settings?.(settings)
  return JSON.stringify({ ...backup, settings })
}

const initialState = useNavStore.getInitialState()

beforeEach(() => {
  storageState.writes.length = 0
  storageState.values.clear()
  storageState.setError = null
  useNavStore.setState(initialState, true)
  useBookmarkGroupsStore.setState({ groups: [], error: false })
  useNavStore.setState({ settings: structuredClone(currentSettings) })
  vi.stubGlobal('chrome', {
    bookmarks: {
      getTree: async () => [{ id: '0', title: '', syncing: false, children: [] }],
      create: async (details: { title?: string }) => ({ id: 'restored-root', title: details.title ?? '' }),
      removeTree: async () => undefined,
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a1 完整備份還原不得清空 Gist 憑證', () => {
  it('正常還原：備份中的憑證欄位是淨化後的空字串時，保留目前有效的憑證', async () => {
    await useNavStore.getState().importBackup(exportedBackup())

    expect(useNavStore.getState().settings.gistBackup).toMatchObject({
      token: CURRENT_TOKEN,
      passphrase: CURRENT_PASSPHRASE,
      gistId: CURRENT_GIST_ID,
    })
    expect(storageState.values.get('sync:moorread:settings')).toMatchObject({
      gistBackup: { token: CURRENT_TOKEN, passphrase: CURRENT_PASSPHRASE },
    })
  })

  it('空白欄位：備份只有 gistId 而 token／passphrase 為空時，保留目前憑證', async () => {
    await useNavStore.getState().importBackup(exportedBackup({
      settings: (settings) => {
        settings.gistBackup = { gistId: 'gist-from-backup', encrypt: true, token: '', passphrase: '' }
      },
    }))

    expect(useNavStore.getState().settings.gistBackup).toMatchObject({
      token: CURRENT_TOKEN,
      passphrase: CURRENT_PASSPHRASE,
      gistId: 'gist-from-backup',
    })
  })

  it('缺少欄位：舊版備份沒有 gistBackup 時，保留目前憑證', async () => {
    await useNavStore.getState().importBackup(exportedBackup({
      settings: (settings) => {
        delete settings.gistBackup
      },
    }))

    expect(useNavStore.getState().settings.gistBackup).toMatchObject({
      token: CURRENT_TOKEN,
      passphrase: CURRENT_PASSPHRASE,
      gistId: CURRENT_GIST_ID,
    })
  })

  it('有效值：備份明確提供新憑證時套用新值', async () => {
    await useNavStore.getState().importBackup(exportedBackup({
      settings: (settings) => {
        settings.gistBackup = { token: 'ghp_from_backup', gistId: 'gist-from-backup', encrypt: true, passphrase: 'pass-from-backup' }
      },
    }))

    expect(useNavStore.getState().settings.gistBackup).toEqual({
      token: 'ghp_from_backup',
      gistId: 'gist-from-backup',
      encrypt: true,
      passphrase: 'pass-from-backup',
    })
  })

  it('明確清除：備份以 null 標記要清除憑證時才清除', async () => {
    await useNavStore.getState().importBackup(exportedBackup({
      settings: (settings) => {
        settings.gistBackup = { token: null, gistId: null, encrypt: false, passphrase: null }
      },
    }))

    expect(useNavStore.getState().settings.gistBackup).toEqual({
      token: '',
      gistId: '',
      encrypt: false,
      passphrase: '',
    })
  })

  it('完整快照還原後，Gist 備份仍可使用目前憑證', async () => {
    const snapshot = JSON.stringify(createFullBookmarkSnapshot({
      moorread: createMoorreadBackup({
        settings: currentSettings,
        meta: {},
        usage: {},
        categoryMeta: {},
        categories: [],
        bookmarkGroups: [],
      }),
      nativeRoots: [],
    }))
    await useNavStore.getState().restoreFullBackup(snapshot)

    const gist = useNavStore.getState().settings.gistBackup
    expect(gist.token).toBe(CURRENT_TOKEN)
    expect(gist.passphrase).toBe(CURRENT_PASSPHRASE)

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ id: 'gist-uploaded' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadToGist({
      token: gist.token,
      gistId: gist.gistId,
      encrypt: false,
    }, '{}')).resolves.toBe('gist-uploaded')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/gists/'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${CURRENT_TOKEN}` }),
      }),
    )
  })

  it('失敗回滾：完整快照還原寫入失敗時，憑證與設定維持原值', async () => {
    const snapshot = JSON.stringify(createFullBookmarkSnapshot({
      moorread: createMoorreadBackup({
        settings: currentSettings,
        meta: {},
        usage: {},
        categoryMeta: {},
        categories: [],
        bookmarkGroups: [],
      }),
      nativeRoots: [],
    }))
    storageState.setError = new Error('quota exceeded')

    await expect(useNavStore.getState().restoreFullBackup(snapshot)).rejects.toThrow('quota exceeded')

    expect(useNavStore.getState().settings.gistBackup).toMatchObject({
      token: CURRENT_TOKEN,
      passphrase: CURRENT_PASSPHRASE,
      gistId: CURRENT_GIST_ID,
    })
    expect(useNavStore.getState().settings).toEqual(currentSettings)
  })
})
