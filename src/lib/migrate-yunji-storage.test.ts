import type { BookmarkGroup } from './bookmark-groups'
import type { MigrationStorage } from './migrate-yunji-storage'
import { describe, expect, it, vi } from 'vitest'
import { decodeBookmarkGroups, encodeBookmarkGroup, parseBookmarkGroup } from './bookmark-groups'
import {
  inspectLegacyBookmarkGroupMigration,
  LEGACY_BOOKMARK_GROUP_PREFIX,
  migrateLegacyBookmarkGroups,
  MIGRATION_MARKER_KEY,
  MIGRATION_STATE_KEY,
  runLegacyStorageMigration,
  SYNC_QUOTA_BYTES,
} from './migrate-yunji-storage'

interface FakeArea extends MigrationStorage {
  data: Map<string, unknown>
}

function createArea(initial: Record<string, unknown> = {}): FakeArea {
  const data = new Map<string, unknown>(Object.entries(initial))
  const area: FakeArea = {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value)
    }),
    setAll: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values))
        data.set(key, value)
    }),
    keys: vi.fn(async () => [...data.keys()]),
    getAll: vi.fn(async () => Object.fromEntries(data)),
  }
  return area
}

function createPorts(localInit: Record<string, unknown> = {}, syncInit: Record<string, unknown> = {}) {
  return { local: createArea(localInit), sync: createArea(syncInit) }
}

/** 舊版書籤組：manifest 與分片都使用 `yunji-tab:bookmark-group:` 前綴。 */
function legacyGroupKeys(group: BookmarkGroup, generation = 'gen-old'): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(encodeBookmarkGroup(group, generation))
      .map(([key, value]) => [key.replace('moorread:bookmark-group:', LEGACY_BOOKMARK_GROUP_PREFIX), value]),
  )
}

function newGroups(sync: FakeArea): BookmarkGroup[] {
  return decodeBookmarkGroups(Object.fromEntries(sync.data))
}

/** 新鍵在 chrome.storage 內是 JSON 字串（與 @plasmohq/storage 一致），讀取時還原。 */
function stored(area: FakeArea, key: string): unknown {
  const raw = area.data.get(key)
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const seriesGroup: BookmarkGroup = {
  id: 'g1',
  title: '每週閱讀',
  description: '舊描述',
  bookmarks: [{ id: 'b1', url: 'https://a.test/', title: 'A' }],
}

describe('runLegacyStorageMigration（第一階段）', () => {
  it('把舊 yunji-tab 資料複製到 moorread 鍵，且不刪除舊鍵', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { description: '舊描述', tags: ['x'] } },
      'yunji-tab:trash': [{ id: 'b1' }],
    }, {
      'yunji-tab:settings': { defaultCategoryId: 'cat-1' },
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.status).toBe('migrated')
    expect(result.migrated).toContain('moorread:meta')
    expect(result.migrated).toContain('moorread:trash')
    expect(result.migrated).toContain('moorread:settings')
    expect(stored(local, 'moorread:meta')).toEqual({ 'https://a.test': { description: '舊描述', tags: ['x'] } })
    expect(stored(sync, 'moorread:settings')).toEqual({ defaultCategoryId: 'cat-1' })
    // 原始資料保留
    expect(local.data.get('yunji-tab:meta')).toBeDefined()
    expect(local.data.get('yunji-tab:trash')).toBeDefined()
    expect(result.marked).toBe(true)
    expect(local.data.get(MIGRATION_MARKER_KEY)).toBeDefined()
  })

  it('第一階段不複製書籤組，只記錄待處理狀態，且不宣稱整體完成', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.pendingGroups).toEqual(['g1'])
    expect(result.status).toBe('migrated')
    // 書籤組沒有被自動複製
    expect(sync.data.get('moorread:bookmark-group:g1')).toBeUndefined()
    expect(newGroups(sync)).toEqual([])
    // 舊資料完整保留
    expect(sync.data.get(`${LEGACY_BOOKMARK_GROUP_PREFIX}g1`)).toBeDefined()
    // 完成標記只代表第一階段，且列出待處理書籤組
    const marker = local.data.get(MIGRATION_MARKER_KEY) as Record<string, unknown>
    expect(marker.phase).toBe(1)
    expect(marker.pendingBookmarkGroups).toEqual(['g1'])
    const state = local.data.get(MIGRATION_STATE_KEY) as Record<string, unknown>
    expect(state.phase1).toBe('complete')
    expect(state.phase2).toBe('pending')
  })

  it('逐欄合併：新版優先、舊版獨有欄位保留、集合去重', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': {
        'https://a.test': {
          description: '舊描述',
          tags: ['工作', '舊'],
          alternateUrls: ['https://old.test/'],
        },
      },
      'moorread:meta': {
        'https://a.test': {
          description: '新描述',
          tags: ['舊', '新'],
          icon: 'i.png',
        },
        'https://only-new.test': { tags: ['新版獨有'] },
      },
    })

    await runLegacyStorageMigration({ local, sync })

    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': {
        description: '新描述',
        tags: ['舊', '新', '工作'],
        alternateUrls: ['https://old.test/'],
        icon: 'i.png',
      },
      'https://only-new.test': { tags: ['新版獨有'] },
    })
  })

  it('舊版獨有描述保留；新版記錄缺少該欄位不代表清空', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { description: '舊描述' } },
      'moorread:meta': { 'https://a.test': { tags: ['新'] } },
    })

    await runLegacyStorageMigration({ local, sync })

    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': { description: '舊描述', tags: ['新'] },
    })
  })

  it('空字串與空陣列不視為有效新值，不會清掉舊資料', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { description: '舊描述', tags: ['舊'] } },
      'moorread:meta': { 'https://a.test': { description: '', tags: [] } },
    })

    await runLegacyStorageMigration({ local, sync })

    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': { description: '舊描述', tags: ['舊'] },
    })
  })

  it('使用者刻意清空：設定中以 null 表示清空，保留清空結果', async () => {
    const { local, sync } = createPorts({}, {
      'yunji-tab:settings': {
        headerWidget: { clockEnabled: true, location: { name: '台北', latitude: 25, longitude: 121 } },
        theme: 'light',
      },
      'moorread:settings': {
        headerWidget: { location: null },
        theme: 'dark',
      },
    })

    await runLegacyStorageMigration({ local, sync })

    expect(stored(sync, 'moorread:settings')).toEqual({
      headerWidget: { clockEnabled: true, location: null },
      theme: 'dark',
    })
  })

  it('新舊同時修改時保留較新的時間資料', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { pinnedAt: 300, inboxAt: 100 } },
      'moorread:meta': { 'https://a.test': { pinnedAt: 200, inboxAt: 500 } },
    })

    await runLegacyStorageMigration({ local, sync })

    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': { pinnedAt: 300, inboxAt: 500 },
    })
  })

  it('重複啟動不會重複匯入', async () => {
    const { local, sync } = createPorts({ 'yunji-tab:meta': { 'https://a.test': { tags: ['x'] } } })

    const first = await runLegacyStorageMigration({ local, sync })
    const second = await runLegacyStorageMigration({ local, sync })

    expect(first.status).toBe('migrated')
    expect(second.status).toBe('already-migrated')
    expect(second.migrated).toEqual([])
    expect(second.marked).toBe(false)
  })

  it('中途失敗不寫標記，下次啟動可重試且不覆蓋已成功資料', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { tags: ['x'] } },
      'yunji-tab:trash': [{ id: 'b1' }],
    })

    const failingSet = vi.fn(async (key: string, value: unknown) => {
      if (key === 'moorread:trash')
        throw new Error('quota')
      local.data.set(key, value)
    })
    const first = await runLegacyStorageMigration({
      local: { ...local, set: failingSet } as MigrationStorage,
      sync,
    })

    expect(first.status).toBe('partial')
    expect(first.failed).toEqual(['moorread:trash'])
    expect(first.marked).toBe(false)
    expect(local.data.get(MIGRATION_MARKER_KEY)).toBeUndefined()

    const retry = await runLegacyStorageMigration({ local, sync })
    expect(retry.status).toBe('migrated')
    expect(retry.migrated).toEqual(['moorread:trash'])
    expect(stored(local, 'moorread:meta')).toEqual({ 'https://a.test': { tags: ['x'] } })
    expect(stored(local, 'moorread:trash')).toEqual([{ id: 'b1' }])
  })

  it('列舉 sync 鍵失敗時不寫完成標記，且仍遷移可處理的靜態鍵', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { tags: ['x'] } },
    }, {
      'yunji-tab:settings': { theme: 'dark' },
    })
    const brokenSync = {
      ...sync,
      keys: vi.fn(async () => {
        throw new Error('sync-unavailable')
      }),
    }

    const result = await runLegacyStorageMigration({ local, sync: brokenSync as MigrationStorage })

    expect(result.status).toBe('partial')
    expect(result.incomplete).toBe(true)
    expect(result.marked).toBe(false)
    expect(local.data.get(MIGRATION_MARKER_KEY)).toBeUndefined()
    // 靜態鍵照樣搬過去，不會因為列舉失敗而整批放棄
    expect(stored(local, 'moorread:meta')).toEqual({ 'https://a.test': { tags: ['x'] } })
    expect(stored(sync, 'moorread:settings')).toEqual({ theme: 'dark' })
  })

  it('有 Web Locks 時在鎖內執行，兩個分頁同時啟動不會互相覆蓋', async () => {
    const queue: Promise<unknown>[] = []
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      const run = (queue.at(-1) ?? Promise.resolve()).then(callback)
      queue.push(run.catch(() => undefined))
      return run
    })
    vi.stubGlobal('navigator', { locks: { request } })
    try {
      const { local, sync } = createPorts({
        'yunji-tab:meta': { 'https://a.test': { tags: ['舊'] } },
        'moorread:meta': { 'https://b.test': { tags: ['新'] } },
      })

      const [first, second] = await Promise.all([
        runLegacyStorageMigration({ local, sync }),
        runLegacyStorageMigration({ local, sync }),
      ])

      expect(request).toHaveBeenCalledTimes(2)
      expect([first.status, second.status].sort()).toEqual(['already-migrated', 'migrated'])
      // 新資料沒被舊資料蓋掉，且只寫一次標記
      expect(stored(local, 'moorread:meta')).toEqual({
        'https://a.test': { tags: ['舊'] },
        'https://b.test': { tags: ['新'] },
      })
      expect(vi.mocked(local.set).mock.calls.filter(([key]) => key === MIGRATION_MARKER_KEY)).toHaveLength(1)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('沒有舊資料時不寫入任何東西', async () => {
    const { local, sync } = createPorts({ 'moorread:meta': {} })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.status).toBe('nothing-to-migrate')
    expect(local.set).not.toHaveBeenCalled()
    expect(sync.set).not.toHaveBeenCalled()
    expect(local.data.get(MIGRATION_MARKER_KEY)).toBeUndefined()
  })

  it('不遷移舊密碼、home-tab-id 與內部快取鍵', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:webdav-password': 'secret',
      'yunji-tab:home-tab-id': '42',
      'yunji-tab:metadata-sync-log': [{ at: 1 }],
      'yunji-tab:bookmark-groups-cache': { g1: { title: 'cached' } },
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.status).toBe('nothing-to-migrate')
    expect(local.data.get('moorread:webdav-password')).toBeUndefined()
    expect(local.data.get('moorread:home-tab-id')).toBeUndefined()
    expect(local.data.get('moorread:metadata-sync-log')).toBeUndefined()
    expect(local.data.get('moorread:bookmark-groups-cache')).toBeUndefined()
    // 原始資料保持原樣
    expect(local.data.get('yunji-tab:webdav-password')).toBe('secret')
    expect(local.data.get('yunji-tab:home-tab-id')).toBe('42')
  })

  it('storage 不可用時回報 unavailable 且不拋錯', async () => {
    const result = await runLegacyStorageMigration({ local: undefined, sync: undefined })
    expect(result.status).toBe('unavailable')
    expect(result.migrated).toEqual([])
  })

  it('遷移完成後重新啟動不再合併舊資料：使用者刪除的欄位不會復活', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { description: '舊描述', tags: ['舊'] } },
    })
    await runLegacyStorageMigration({ local, sync })

    // 使用者遷移後自行清空描述與標籤
    local.data.set('moorread:meta', { 'https://a.test': {} })
    vi.mocked(local.set).mockClear()

    const second = await runLegacyStorageMigration({ local, sync })

    expect(second.status).toBe('already-migrated')
    expect(second.migrated).toEqual([])
    expect(stored(local, 'moorread:meta')).toEqual({ 'https://a.test': {} })
    expect(local.set).not.toHaveBeenCalled()
  })

  it('寫入後讀回不一致時不寫完成標記', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { tags: ['x'] } },
    })
    const get = vi.fn(async (key: string) =>
      key === 'moorread:meta' ? undefined : local.data.get(key))

    const result = await runLegacyStorageMigration({
      local: { ...local, get } as MigrationStorage,
      sync,
    })

    expect(result.status).toBe('partial')
    expect(result.failed).toEqual(['moorread:meta'])
    expect(result.marked).toBe(false)
    expect(local.data.get(MIGRATION_MARKER_KEY)).toBeUndefined()
  })

  it('部分失敗重試時保留使用者已寫入的新資料', async () => {
    const { local, sync } = createPorts({
      'yunji-tab:meta': { 'https://a.test': { tags: ['舊'] } },
    })
    let failedOnce = false
    const set = vi.fn(async (key: string, value: unknown) => {
      if (key === 'moorread:meta' && !failedOnce) {
        failedOnce = true
        throw new Error('temporary failure')
      }
      local.data.set(key, value)
    })

    const first = await runLegacyStorageMigration({ local: { ...local, set } as MigrationStorage, sync })
    expect(first.status).toBe('partial')

    // 使用者在新版本新增資料後重試
    local.data.set('moorread:meta', { 'https://b.test': { tags: ['新'] } })
    const retry = await runLegacyStorageMigration({ local, sync })

    expect(retry.status).toBe('migrated')
    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': { tags: ['舊'] },
      'https://b.test': { tags: ['新'] },
    })
  })
})

describe('migrateLegacyBookmarkGroups（第二階段）', () => {
  it('使用者按下按鈕後才複製書籤組，舊資料保留', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

    const report = await migrateLegacyBookmarkGroups({ local, sync })

    expect(report.phase2).toBe('complete')
    expect(report.migrated).toEqual(['g1'])
    expect(report.pendingGroupCount).toBe(0)
    expect(newGroups(sync)).toEqual([seriesGroup])
    expect(sync.data.get(`${LEGACY_BOOKMARK_GROUP_PREFIX}g1`)).toBeDefined()
    const state = local.data.get(MIGRATION_STATE_KEY) as Record<string, unknown>
    expect(state.phase2).toBe('complete')
    expect(state.completedGroups).toEqual(['g1'])
  })

  it('第二階段完成後清空 state.pendingGroups，但保留完成標記的第一階段歷史快照', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

    await runLegacyStorageMigration({ local, sync })
    expect((local.data.get(MIGRATION_MARKER_KEY) as Record<string, unknown>).pendingBookmarkGroups).toEqual(['g1'])

    const report = await migrateLegacyBookmarkGroups({ local, sync })
    expect(report.phase2).toBe('complete')

    // 權威待辦清單在 state：第二階段成功後必須清空。
    expect((local.data.get(MIGRATION_STATE_KEY) as Record<string, unknown>).pendingGroups).toEqual([])
    // 完成標記只記錄第一階段當下的快照，不是待辦清單；不得為了「看起來完成」而竄改歷史。
    const marker = local.data.get(MIGRATION_MARKER_KEY) as Record<string, unknown>
    expect(marker.phase).toBe(1)
    expect(marker.pendingBookmarkGroups).toEqual(['g1'])
  })

  it('新舊書籤組逐欄合併：新版優先、舊版獨有欄位與成員保留、成員去重', async () => {
    const legacy: BookmarkGroup = {
      id: 'g1',
      title: '舊標題',
      description: '舊描述',
      icon: 'old.png',
      sortOrder: 3,
      bookmarks: [
        { id: 'b1', url: 'https://a.test/', title: 'A 舊' },
        { id: 'b2', url: 'https://b.test/', title: 'B' },
      ],
    }
    const current: BookmarkGroup = {
      id: 'g1',
      title: '新標題',
      description: '',
      bookmarks: [{ id: 'b1', url: 'https://a.test/', title: 'A 新' }],
    }
    const { local, sync } = createPorts({}, {
      ...legacyGroupKeys(legacy),
      ...encodeBookmarkGroup(current, 'gen-new'),
    })

    await migrateLegacyBookmarkGroups({ local, sync })

    expect(newGroups(sync)).toEqual([{
      id: 'g1',
      title: '新標題',
      description: '舊描述',
      icon: 'old.png',
      sortOrder: 3,
      bookmarks: [
        { id: 'b1', url: 'https://a.test/', title: 'A 新' },
        { id: 'b2', url: 'https://b.test/', title: 'B' },
      ],
    }])
  })

  it('重複執行不產生重複資料，也不會重寫已完成的書籤組', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

    const first = await migrateLegacyBookmarkGroups({ local, sync })
    const writesAfterFirst = vi.mocked(sync.setAll!).mock.calls.length
    const second = await migrateLegacyBookmarkGroups({ local, sync })

    expect(first.migrated).toEqual(['g1'])
    expect(second.migrated).toEqual([])
    expect(second.skipped).toEqual(['g1'])
    expect(second.phase2).toBe('complete')
    expect(vi.mocked(sync.setAll!).mock.calls.length).toBe(writesAfterFirst)
    expect(newGroups(sync)).toEqual([seriesGroup])
  })

  it('容量不足時停止遷移並保留待處理狀態，釋放空間後可以重試', async () => {
    const { local, sync } = createPorts({}, {
      ...legacyGroupKeys(seriesGroup),
      'moorread:blob': 'x'.repeat(SYNC_QUOTA_BYTES + 1000),
    })

    const report = await migrateLegacyBookmarkGroups({ local, sync })

    expect(report.phase2).toBe('insufficient-space')
    expect(report.reason).toBe('insufficient-space')
    expect(report.pendingGroupCount).toBe(1)
    expect(sync.data.get('moorread:bookmark-group:g1')).toBeUndefined()

    // 釋放空間後重新檢查（不沿用先前估算）
    sync.data.delete('moorread:blob')
    const summary = await inspectLegacyBookmarkGroupMigration({ local, sync })
    expect(summary.phase2).toBe('pending')
    const retry = await migrateLegacyBookmarkGroups({ local, sync })
    expect(retry.phase2).toBe('complete')
    expect(newGroups(sync)).toEqual([seriesGroup])
  })

  it('實際寫入發生 quota error 時如實回報，之後可重試且不重複', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))
    const failingSetAll = vi.fn(async () => {
      throw new Error('QUOTA_BYTES quota exceeded')
    })

    const first = await migrateLegacyBookmarkGroups({
      local,
      sync: { ...sync, setAll: failingSetAll } as MigrationStorage,
    })

    expect(first.phase2).toBe('insufficient-space')
    expect(first.reason).toBe('insufficient-space')
    expect(first.pendingGroupCount).toBe(1)
    expect(sync.data.get(`${LEGACY_BOOKMARK_GROUP_PREFIX}g1`)).toBeDefined()

    const retry = await migrateLegacyBookmarkGroups({ local, sync })
    expect(retry.phase2).toBe('complete')
    expect(retry.migrated).toEqual(['g1'])
    expect(newGroups(sync)).toEqual([seriesGroup])
  })

  it('取鎖失敗時不寫入任何資料並回報 unavailable', async () => {
    const request = vi.fn(async () => {
      throw new Error('lock denied')
    })
    vi.stubGlobal('navigator', { locks: { request } })
    try {
      const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

      const report = await migrateLegacyBookmarkGroups({ local, sync })

      expect(report.reason).toBe('unavailable')
      expect(report.pendingGroupCount).toBe(1)
      expect(sync.data.get('moorread:bookmark-group:g1')).toBeUndefined()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('多分頁同時按下時序列化執行，不會重複寫入或覆蓋', async () => {
    const queue: Promise<unknown>[] = []
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      const run = (queue.at(-1) ?? Promise.resolve()).then(callback)
      queue.push(run.catch(() => undefined))
      return run
    })
    vi.stubGlobal('navigator', { locks: { request } })
    try {
      const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))

      const [first, second] = await Promise.all([
        migrateLegacyBookmarkGroups({ local, sync }),
        migrateLegacyBookmarkGroups({ local, sync }),
      ])

      expect(request).toHaveBeenCalledTimes(2)
      expect(first.migrated.length + second.migrated.length).toBe(1)
      expect(first.pendingGroupCount).toBe(0)
      expect(second.pendingGroupCount).toBe(0)
      expect(newGroups(sync)).toEqual([seriesGroup])
      expect(Object.keys(Object.fromEntries(sync.data)).filter(key => key.startsWith('moorread:bookmark-group:g1:'))).toHaveLength(1)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('沒有舊書籤組時回報 nothing-to-migrate 且不寫入', async () => {
    const { local, sync } = createPorts({ 'moorread:meta': {} })

    const report = await migrateLegacyBookmarkGroups({ local, sync })

    expect(report.phase2).toBe('not-needed')
    expect(report.migrated).toEqual([])
    expect(sync.setAll).not.toHaveBeenCalled()
  })

  it('第二階段完成後使用者刪除整組，重新檢查與執行都不會讓舊資料復活', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))
    await migrateLegacyBookmarkGroups({ local, sync })

    for (const key of [...sync.data.keys()]) {
      if (key.startsWith('moorread:bookmark-group:'))
        sync.data.delete(key)
    }
    const writes = vi.mocked(sync.setAll!).mock.calls.length

    const summary = await inspectLegacyBookmarkGroupMigration({ local, sync })
    const report = await migrateLegacyBookmarkGroups({ local, sync })

    expect(summary.phase2).toBe('complete')
    expect(summary.pendingGroupCount).toBe(0)
    expect(report.migrated).toEqual([])
    expect(report.skipped).toEqual(['g1'])
    expect(vi.mocked(sync.setAll!).mock.calls.length).toBe(writes)
    expect(newGroups(sync)).toEqual([])
    // 舊鍵仍在，未被刪除
    expect(sync.data.get(`${LEGACY_BOOKMARK_GROUP_PREFIX}g1`)).toBeDefined()
  })

  it('使用者移除已遷移書籤組的成員後，重試不會把成員加回', async () => {
    const { local, sync } = createPorts({}, legacyGroupKeys(seriesGroup))
    await migrateLegacyBookmarkGroups({ local, sync })

    // 使用者在新版把成員 b1 換成 b9
    const edited = parseBookmarkGroup({
      id: 'g1',
      title: '每週閱讀',
      description: '舊描述',
      bookmarks: [{ id: 'b9', url: 'https://c.test/', title: 'C' }],
    })
    if (!edited)
      throw new Error('invalid test fixture')
    for (const key of [...sync.data.keys()]) {
      if (key.startsWith('moorread:bookmark-group:g1'))
        sync.data.delete(key)
    }
    for (const [key, value] of Object.entries(encodeBookmarkGroup(edited, 'gen-edit')))
      sync.data.set(key, value)
    const writes = vi.mocked(sync.setAll!).mock.calls.length

    const report = await migrateLegacyBookmarkGroups({ local, sync })

    expect(report.migrated).toEqual([])
    expect(vi.mocked(sync.setAll!).mock.calls.length).toBe(writes)
    expect(newGroups(sync)).toEqual([edited])
  })
})

/**
 * 舊版經 `@plasmohq/storage` 寫入的鍵，在 `chrome.storage` 內是 JSON 字串；
 * 這組測試用真實底層形態（字串）驗證合併不會因型別不同而漏遷移或清空。
 */
describe('runLegacyStorageMigration（真實序列化格式）', () => {
  it('新鍵已存在且兩邊都是 JSON 字串時，仍逐欄合併', async () => {
    const { local, sync } = createPorts({}, {
      'yunji-tab:settings': JSON.stringify({ descriptionIgnoredDomains: ['old.test'], theme: 'light' }),
      'moorread:settings': JSON.stringify({ descriptionIgnoredDomains: ['new.test'], theme: 'dark' }),
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.status).toBe('migrated')
    const settings = stored(sync, 'moorread:settings') as {
      theme: string
      descriptionIgnoredDomains: string[]
    }
    expect(settings.theme).toBe('dark')
    expect([...settings.descriptionIgnoredDomains].sort()).toEqual(['new.test', 'old.test'])
  })

  it('usage 兩邊都是字串時取較大計數，不會被覆寫成空物件', async () => {
    const { local } = createPorts({
      'yunji-tab:usage': JSON.stringify({ 'https://a.test': { openCount: 5, lastOpenedAt: 100 } }),
      'moorread:usage': JSON.stringify({ 'https://a.test': { openCount: 2, lastOpenedAt: 200 } }),
    })

    const result = await runLegacyStorageMigration({ local, sync: createArea() })

    expect(result.migrated).toContain('moorread:usage')
    expect(JSON.parse(local.data.get('moorread:usage') as string)).toEqual({
      'https://a.test': { openCount: 5, lastOpenedAt: 200 },
    })
  })

  it('meta 以字串格式合併標籤並保留舊版獨有欄位', async () => {
    const { local } = createPorts({
      'yunji-tab:meta': JSON.stringify({ 'https://a.test': { tags: ['x'], description: '舊描述' } }),
      'moorread:meta': JSON.stringify({ 'https://a.test': { tags: ['y'] } }),
    })

    await runLegacyStorageMigration({ local, sync: createArea() })

    expect(stored(local, 'moorread:meta')).toEqual({
      'https://a.test': { tags: ['y', 'x'], description: '舊描述' },
    })
  })

  it('舊值無法解析為 JSON 時不寫入、不寫完成標記，並保留原始內容', async () => {
    const { local, sync } = createPorts({ 'yunji-tab:meta': '{not-json' })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.failed).toContain('moorread:meta')
    expect(result.marked).toBe(false)
    expect(result.status).toBe('partial')
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(false)
    expect(local.data.get('yunji-tab:meta')).toBe('{not-json')
    expect(local.data.has('moorread:meta')).toBe(false)
  })

  it('原生寫入的舊鍵（quick-save-category、bookmark-group-sources）原樣搬移，不做 JSON 解析', async () => {
    const { local } = createPorts({
      'yunji-tab:quick-save-category': 'cat-1',
      'yunji-tab:bookmark-group-sources': { g1: 'https://source.test/feed' },
    })

    const result = await runLegacyStorageMigration({ local, sync: createArea() })

    expect(result.migrated).toContain('moorread:quick-save-category')
    expect(result.migrated).toContain('moorread:bookmark-group-sources')
    expect(local.data.get('moorread:quick-save-category')).toBe('cat-1')
    expect(local.data.get('moorread:bookmark-group-sources')).toEqual({ g1: 'https://source.test/feed' })
  })
})

/**
 * `reconcileSources()` 會在遷移前把
 * `moorread:bookmark-group-sources` 寫成機器產生的快照（沒有書籤時是 `{}`），
 * 舊版 `keep-new` 因此丟掉 `yunji-tab:bookmark-group-sources`。
 * 這裡的資料一律使用已核對的真實 `raw` 形態（原生寫入的物件，不是 JSON 字串）。
 */
describe('runLegacyStorageMigration（bookmark-group-sources 預先初始化的空物件）', () => {
  const legacySources = { g1: 'https://src.test/feed' }
  const sourcesKey = 'moorread:bookmark-group-sources'
  const legacySourcesKey = 'yunji-tab:bookmark-group-sources'

  // A：舊資料存在、新鍵尚未建立 → 正常遷移。
  it('a. 新鍵不存在時原樣搬移舊來源設定', async () => {
    const { local, sync } = createPorts({ [legacySourcesKey]: legacySources })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.migrated).toContain(sourcesKey)
    expect(local.data.get(sourcesKey)).toEqual(legacySources)
    expect(local.data.get(legacySourcesKey)).toEqual(legacySources)
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(true)
  })

  // B：舊資料存在、新鍵被初始化流程預先建立為 `{}` → 修正後仍要遷移。
  it('b. 新鍵被初始化流程寫成空物件時，舊來源設定仍會遷移', async () => {
    const { local, sync } = createPorts({
      [legacySourcesKey]: legacySources,
      [sourcesKey]: {},
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.migrated).toContain(sourcesKey)
    expect(result.keptNew).not.toContain(sourcesKey)
    expect(local.data.get(sourcesKey)).toEqual(legacySources)
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(true)
  })

  // C：新鍵已有非空資料 → 保留新資料，不覆蓋。
  it('c. 新鍵已有非空資料時保留新值', async () => {
    const current = { 'live-1': 'https://live.test/' }
    const { local, sync } = createPorts({
      [legacySourcesKey]: legacySources,
      [sourcesKey]: current,
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.keptNew).toContain(sourcesKey)
    expect(result.migrated).not.toContain(sourcesKey)
    expect(local.data.get(sourcesKey)).toEqual(current)
    expect(local.data.get(legacySourcesKey)).toEqual(legacySources)
  })

  // D：使用者刻意清空（遷移早已完成）→ 不得恢復舊資料。
  it('d. 完成遷移後使用者清空成空物件時不恢復舊資料', async () => {
    const { local, sync } = createPorts({ [legacySourcesKey]: legacySources })
    await runLegacyStorageMigration({ local, sync })
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(true)

    // 使用者／應用程式之後把來源設定清成空物件
    local.data.set(sourcesKey, {})

    const retry = await runLegacyStorageMigration({ local, sync })

    expect(retry.status).toBe('already-migrated')
    expect(local.data.get(sourcesKey)).toEqual({})
  })

  // E：中途寫入失敗 → 不寫完成標記；重試不覆蓋已存在的新資料。
  it('e. 寫入失敗不寫完成標記，重試時不覆蓋已存在的新資料', async () => {
    const { local, sync } = createPorts({ [legacySourcesKey]: legacySources })
    vi.mocked(local.set).mockRejectedValueOnce(new Error('storage write failed'))

    const failed = await runLegacyStorageMigration({ local, sync })

    expect(failed.failed).toContain(sourcesKey)
    expect(failed.marked).toBe(false)
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(false)
    expect(local.data.get(legacySourcesKey)).toEqual(legacySources)

    // 重試前新鍵已由其他流程寫入真實資料 → 保留新資料
    const current = { 'live-1': 'https://live.test/' }
    local.data.set(sourcesKey, current)

    const retry = await runLegacyStorageMigration({ local, sync })

    expect(retry.keptNew).toContain(sourcesKey)
    expect(local.data.get(sourcesKey)).toEqual(current)
    expect(local.data.get(legacySourcesKey)).toEqual(legacySources)
  })

  // F：遷移完成後使用者刪除來源設定 → 重啟與重試都不得復活。
  it('f. 遷移完成後刪除來源設定，重啟與重試都不會復活', async () => {
    const { local, sync } = createPorts({ [legacySourcesKey]: legacySources })
    await runLegacyStorageMigration({ local, sync })
    expect(local.data.get(sourcesKey)).toEqual(legacySources)

    // 使用者刪除來源設定（鍵整個消失）
    local.data.delete(sourcesKey)
    local.data.delete(MIGRATION_STATE_KEY)

    const restarted = createPorts(
      Object.fromEntries(local.data),
      Object.fromEntries(sync.data),
    )
    const retry = await runLegacyStorageMigration(restarted)

    expect(retry.status).toBe('already-migrated')
    expect(restarted.local.data.has(sourcesKey)).toBe(false)
  })

  // G：寫入後讀回不一致 → 判定失敗，不寫完成標記。
  it('g. 讀回值與寫入值不一致時判定失敗且不寫完成標記', async () => {
    const { local, sync } = createPorts({ [legacySourcesKey]: legacySources })
    vi.mocked(local.set).mockImplementation(async (key, value) => {
      // 模擬寫入被截斷：實際落盤的值與寫入值不同
      local.data.set(key, key === sourcesKey ? {} : value)
    })

    const result = await runLegacyStorageMigration({ local, sync })

    expect(result.failed).toContain(sourcesKey)
    expect(result.marked).toBe(false)
    expect(local.data.has(MIGRATION_MARKER_KEY)).toBe(false)
  })
})
