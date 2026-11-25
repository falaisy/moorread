import type { HistoryEntry, TrashEntry } from './activity'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { historyStorageKey, trashStorageKey } from './activity'

const store = vi.hoisted(() => ({
  areas: [] as string[],
  values: new Map<string, unknown>(),
  failKeys: new Set<string>(),
}))
vi.mock('@plasmohq/storage', () => ({
  Storage: class {
    constructor(options: { area: string }) { store.areas.push(options.area) }
    async get(key: string) { return structuredClone(store.values.get(key)) }
    async set(key: string, value: unknown) {
      if (store.failKeys.has(key))
        throw new Error('quota-exceeded')
      store.values.set(key, structuredClone(value))
    }

    async remove(key: string) { store.values.delete(key) }
  },
}))

const gate = vi.hoisted(() => ({ ready: false }))
vi.mock('./legacy-migration-gate', () => ({
  legacyMigrationReady: async () => gate.ready,
}))

const suppressed = vi.hoisted(() => new Set<string>())
vi.mock('./bookmark-deletion-safety', () => ({
  consumeBookmarkDeletionSuppression: async (id: string) => suppressed.delete(id),
}))

vi.mock('./metadata-sync', () => ({
  markLocalMetadataChanged: async () => {},
}))

vi.mock('./bookmark-groups-store', () => ({
  useBookmarkGroupsStore: { getState: () => ({ reconcileSources: async () => {} }) },
}))

const fallbacks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('./diagnostics', () => ({
  reportExpectedFallback: fallbacks.report,
}))

const PENDING_KEY = 'moorread:pending-external-deletions'
const MARKER_KEY = 'moorread:storage-migration:v1'

type RemovalListener = (id: string, info: { node: { id: string, title: string, url?: string }, parentId?: string }) => void
const listeners = {
  onRemoved: [] as RemovalListener[],
  onCreated: [] as Array<() => void>,
  onChanged: [] as Array<() => void>,
  onStartup: [] as Array<() => void>,
  storageChanged: [] as Array<(changes: Record<string, unknown>, area: string) => void>,
}

function installChromeStub() {
  vi.stubGlobal('chrome', {
    bookmarks: {
      onRemoved: { addListener: (fn: RemovalListener) => listeners.onRemoved.push(fn) },
      onCreated: { addListener: (fn: () => void) => listeners.onCreated.push(fn) },
      onChanged: { addListener: (fn: () => void) => listeners.onChanged.push(fn) },
    },
    runtime: { onStartup: { addListener: (fn: () => void) => listeners.onStartup.push(fn) } },
    storage: {
      onChanged: { addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => listeners.storageChanged.push(fn) },
    },
  })
  vi.stubGlobal('navigator', {
    locks: { request: (_name: string, task: () => Promise<unknown>) => task() },
  })
}

async function settle(rounds = 30): Promise<void> {
  // 產品碼這條路徑只有 promise 鏈，沒有計時器；每一輪 setImmediate 都跨一次 macrotask
  // 邊界，microtask（所有 await／then）會在邊界前清空，足以等完封存與佇列補寫。
  // 取代原本的 setTimeout(0)：Windows 上每輪至少 1ms 且受排程抖動影響，90 輪累積後
  // 會吃掉單測 5 秒預算，造成「冷 import + 磁碟延遲」時的偶發逾時。
  for (let i = 0; i < rounds; i++)
    await new Promise<void>(resolve => setImmediate(resolve))
}

function node(id: string, url = `https://deleted.test/${id}`) {
  return { id, title: `Deletion ${id}`, url, syncing: false }
}

const legacyTrash: TrashEntry = {
  id: 'legacy-trash',
  label: { key: 'runtimeExternalBookmarkDeletion', params: { name: 'old' } },
  deletedAt: 1,
  expiresAt: Date.now() + 3_600_000,
  roots: [{ id: 'old', title: 'old', url: 'https://old.test/', syncing: false }],
  categoryMeta: {},
}
const legacyHistory: HistoryEntry = {
  id: 'legacy-history',
  action: 'delete',
  label: { key: 'runtimeExternalBookmarkDeletion', params: { name: 'old' } },
  createdAt: 1,
}

async function loadModule() {
  vi.resetModules()
  return import('./bookmark-events')
}

beforeAll(async () => {
  // 先預熱模組圖（transform ＋ 首次求值）：否則第一個測試要替整個檔案付冷 import
  // 成本（實測約 2.5s），加上斷言前的等待會貼近 vitest 預設的 5 秒單測上限。
  // 這裡刻意不呼叫 registerBookmarkEvents()；import 期間建立的 storage port 會在
  // 第一個 beforeEach 被清掉。
  await import('./bookmark-events')
})

beforeEach(() => {
  listeners.onRemoved.length = 0
  listeners.onCreated.length = 0
  listeners.onChanged.length = 0
  listeners.onStartup.length = 0
  listeners.storageChanged.length = 0
  store.areas.length = 0
  store.values.clear()
  store.failKeys.clear()
  gate.ready = false
  suppressed.clear()
  fallbacks.report.mockReset()
  installChromeStub()
})

afterEach(async () => {
  // 等這一輪遺留的佇列任務跑完，再讓下一個測試清空共用的 hoisted store／listeners；
  // 否則前一個測試的 async 封存可能在下一個測試開始後才寫入 store，造成交叉污染。
  await settle()
  vi.unstubAllGlobals()
})

function fireRemoval(value = node('n1')) {
  for (const listener of listeners.onRemoved)
    listener(value.id, { node: value })
}

function fireMarkerChange() {
  for (const listener of listeners.storageChanged)
    listener({ [MARKER_KEY]: { newValue: { phase: 1 } } }, 'local')
}

describe('bookmark deletion archiving during legacy migration', () => {
  it('never writes trash/history before migration and flushes into the migrated data afterwards', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()
    expect(store.values.has(trashStorageKey)).toBe(false)
    expect(store.values.has(historyStorageKey)).toBe(false)

    fireRemoval()
    await settle()
    // 遷移未完成：不得建立 keep-new 目標鍵，事件先進持久佇列。
    expect(store.values.has(trashStorageKey)).toBe(false)
    expect(store.values.has(historyStorageKey)).toBe(false)
    const pending = store.values.get(PENDING_KEY) as Array<{ id: string, node: { id: string } }>
    expect(pending).toHaveLength(1)
    expect(pending[0].node.id).toBe('n1')
    // 複合識別：node id ＋ 時間 ＋ 隨機序，不是單純 node id。
    expect(pending[0].id.startsWith('n1:')).toBe(true)
    expect(pending[0].id.length).toBeGreaterThan('n1:'.length)

    // 遷移完成（舊資料已寫入新鍵）→ 補寫時必須保留舊資料。
    store.values.set(trashStorageKey, [legacyTrash])
    store.values.set(historyStorageKey, [legacyHistory])
    gate.ready = true
    fireMarkerChange()
    await settle()

    const trash = store.values.get(trashStorageKey) as TrashEntry[]
    expect(trash).toHaveLength(2)
    expect(trash[0].sourceEventId).toBe(pending[0].id)
    expect(trash.some(entry => entry.id === 'legacy-trash')).toBe(true)
    const history = store.values.get(historyStorageKey) as HistoryEntry[]
    expect(history).toHaveLength(2)
    expect(history.some(entry => entry.id === 'legacy-history')).toBe(true)
    expect(store.values.has(PENDING_KEY)).toBe(false)
  })

  it('is idempotent when the archive succeeded but clearing the queue failed', async () => {
    const { registerBookmarkEvents } = await loadModule()
    gate.ready = true
    registerBookmarkEvents()
    await settle()

    const eventId = 'n9:111:uuid'
    store.values.set(PENDING_KEY, [{ id: eventId, node: node('n9'), queuedAt: 111 }])
    store.values.set(trashStorageKey, [{ ...legacyTrash, id: 'archived', sourceEventId: eventId }])
    store.values.set(historyStorageKey, [{ ...legacyHistory, id: 'archived-h', sourceEventId: eventId }])

    fireMarkerChange()
    await settle()

    expect(store.values.get(trashStorageKey) as TrashEntry[]).toHaveLength(1)
    expect(store.values.get(historyStorageKey) as HistoryEntry[]).toHaveLength(1)
    expect(store.values.has(PENDING_KEY)).toBe(false)
  })

  it('recovers a persisted queue after a service worker restart', async () => {
    store.values.set(PENDING_KEY, [{ id: 'n5:222:uuid', node: node('n5'), queuedAt: 222 }])
    gate.ready = true
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()

    const trash = store.values.get(trashStorageKey) as TrashEntry[]
    expect(trash).toHaveLength(1)
    expect(trash[0].sourceEventId).toBe('n5:222:uuid')
    expect(store.values.has(PENDING_KEY)).toBe(false)
  })

  it('keeps distinct events for the same node and does not merge them', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()
    fireRemoval(node('n1'))
    fireRemoval(node('n1'))
    await settle()
    const pending = store.values.get(PENDING_KEY) as Array<{ id: string }>
    expect(pending).toHaveLength(2)
    expect(pending[0].id).not.toBe(pending[1].id)

    store.values.set(trashStorageKey, [legacyTrash])
    store.values.set(historyStorageKey, [legacyHistory])
    gate.ready = true
    fireMarkerChange()
    await settle()
    const trash = store.values.get(trashStorageKey) as TrashEntry[]
    expect(trash).toHaveLength(3)
    expect(new Set(trash.map(entry => entry.sourceEventId)).size).toBe(3)
  })

  it('registers listeners only once even when called repeatedly', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    registerBookmarkEvents()
    fireRemoval(node('n1'))
    await settle()
    // 一次註冊：封存用 onRemoved ＋ reconcile 用 onRemoved ＝ 2 個監聽器。
    expect(listeners.onRemoved).toHaveLength(2)
    expect(listeners.onCreated).toHaveLength(1)
    expect(listeners.storageChanged).toHaveLength(1)
    const pending = store.values.get(PENDING_KEY) as Array<{ id: string }>
    expect(pending).toHaveLength(1)
  })

  it('skips events that were suppressed by in-app deletions', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()
    suppressed.add('n2')
    fireRemoval(node('n2'))
    await settle()
    expect(store.values.has(PENDING_KEY)).toBe(false)
    expect(store.values.has(trashStorageKey)).toBe(false)
  })

  it('reports a queue write failure instead of archiving or pretending success', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()
    store.failKeys.add(PENDING_KEY)
    fireRemoval(node('n3'))
    await settle()
    expect(store.values.has(trashStorageKey)).toBe(false)
    expect(fallbacks.report).toHaveBeenCalledWith('bookmark-events.archive-queue', expect.anything())
  })

  it('serializes concurrent events and flushes them in order', async () => {
    const { registerBookmarkEvents } = await loadModule()
    registerBookmarkEvents()
    await settle()
    fireRemoval(node('a1'))
    fireRemoval(node('a2'))
    fireRemoval(node('a3'))
    await settle()
    expect((store.values.get(PENDING_KEY) as unknown[])).toHaveLength(3)

    store.values.set(trashStorageKey, [legacyTrash])
    store.values.set(historyStorageKey, [legacyHistory])
    gate.ready = true
    fireMarkerChange()
    await settle()
    const trash = store.values.get(trashStorageKey) as TrashEntry[]
    expect(trash).toHaveLength(4)
    expect(trash.slice(0, 3).map(entry => entry.roots[0].id)).toEqual(['a3', 'a2', 'a1'])
  })
})
