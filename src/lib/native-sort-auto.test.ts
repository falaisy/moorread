import type { NativeBookmarkSortSettings } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * native-sort-auto 測試（D2 / HQ-10）：
 *  - 佇列競態：enqueue 與 flush 並行時新事件不遺失
 *  - 失敗保留：非 completed 結果不移除待排項目，且不被快速無限重試
 *  - 新事件不遺失：flush 期間新增的資料夾會被同一輪處理
 *  - scope 傳遞（HQ-4）與祖先 manual 繼承（HQ-5）
 */

const h = vi.hoisted(() => ({
  session: new Map<string, unknown>(),
  sync: new Map<string, unknown>(),
  sortCalls: [] as Array<{ targetIds: string[], scope: string, recurse: boolean }>,
  sortImpl: null as null | ((targetIds: string[], scope: string) => Promise<{ status: string }>),
  listeners: {} as Record<string, (arg: string, info: { parentId: string }) => void>,
}))

vi.mock('./storage-port', () => ({
  createStoragePort: () => ({
    get: async (k: string) => h.sync.get(k),
    set: async (k: string, v: unknown) => {
      h.sync.set(k, v)
    },
    remove: async (k: string) => {
      h.sync.delete(k)
    },
  }),
}))

vi.mock('./bookmark-native-sort', () => ({
  normalizeSortCriteria: (c: unknown) => (Array.isArray(c) ? c : []),
  sortNativeBookmarks: async (opts: { targetFolderIds: string[], scope: string, recurse: boolean }) => {
    h.sortCalls.push({ targetIds: opts.targetFolderIds, scope: opts.scope, recurse: opts.recurse })
    return h.sortImpl ? h.sortImpl(opts.targetFolderIds, opts.scope) : { status: 'completed' }
  },
}))

const PENDING = 'moorread:auto-sort-pending'
const SETTINGS_KEY = 'moorread:settings'

interface TreeNode { id: string, children?: TreeNode[] }

function installChrome(tree: TreeNode[] = []) {
  const g = globalThis as unknown as { chrome: unknown }
  g.chrome = {
    storage: {
      session: {
        get: async (k: string) => ({ [k]: h.session.get(k) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) h.session.set(k, v)
        },
      },
      onChanged: { addListener: () => {} },
    },
    bookmarks: {
      getTree: async () => tree,
      get: async () => [],
      onCreated: {
        addListener: (fn: (id: string, info: { parentId: string }) => void) => {
          h.listeners.created = fn
        },
      },
      onChanged: { addListener: () => {} },
      onMoved: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      onChildrenReordered: { addListener: () => {} },
    },
  }
}

function setSettings(patch: Partial<NativeBookmarkSortSettings>) {
  const base: Partial<NativeBookmarkSortSettings> = {
    enabled: true,
    autoSort: true,
    scope: 'selected-only',
    sortCriteria: [{ field: 'title', direction: 'asc' }],
    sortMode: 'criteria',
    sortSelf: true,
    targetFolderIds: [],
    ignoreFolderIds: [],
    foldersFirst: true,
  }
  h.sync.set(SETTINGS_KEY, { nativeBookmarkSort: { ...base, ...patch } })
}

async function loadModule() {
  vi.resetModules()
  return import('./native-sort-auto')
}

beforeEach(() => {
  h.session.clear()
  h.sync.clear()
  h.sortCalls.length = 0
  h.sortImpl = null
  h.listeners = {}
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('d2-3 — 自動排序失敗不可丟棄佇列', () => {
  it('非 completed 結果 → 保留待排項目，且同輪不無限重試', async () => {
    installChrome()
    setSettings({ targetFolderIds: ['f1'] })
    h.sortImpl = async () => ({ status: 'failed' })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    // 只嘗試一次（不會無限迴圈）
    expect(h.sortCalls).toHaveLength(1)
    // 失敗者保留在佇列，等待下一次事件/啟動
    expect(h.session.get(PENDING)).toEqual(['f1'])
  })

  it('completed 結果 → 從佇列移除', async () => {
    installChrome()
    setSettings({ targetFolderIds: ['f1'] })
    h.sortImpl = async () => ({ status: 'completed' })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(1)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('sort 抛例外（忙碌/API 錯誤）→ 保留佇列，不虛報成功', async () => {
    installChrome()
    setSettings({ targetFolderIds: ['f1'] })
    h.sortImpl = async () => {
      throw new Error('busy')
    }
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.session.get(PENDING)).toEqual(['f1'])
  })
})

describe('d2-4 — enqueue 與 flush 並行時新事件不遺失', () => {
  it('flush 等待 f1 期間 enqueue f2 → 同輪仍處理 f2，最終清空', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }, { id: 'f2' }] }])
    setSettings({ targetFolderIds: ['f1', 'f2'] })
    let resolveF1: (v: { status: string }) => void = () => {}
    h.sortImpl = (ids) => {
      if (ids[0] === 'f1')
        return new Promise((r) => { resolveF1 = r })
      return Promise.resolve({ status: 'completed' })
    }
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    mod.registerNativeSortAutoListener() // 捕捉 onCreated
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(500) // flush 啟動，卡在 f1

    // 並行：使用者新增書籤 → onCreated 觸發 enqueue f2
    h.listeners.created?.('x', { parentId: 'f2' })
    await Promise.resolve()
    await Promise.resolve()

    // f1 完成，flush 續跑
    resolveF1({ status: 'completed' })
    await vi.advanceTimersByTimeAsync(600)

    // f2 沒有被舊 Set 覆蓋而遺失
    expect(h.sortCalls.map(c => c.targetIds[0])).toEqual(['f1', 'f2'])
    expect(h.session.get(PENDING)).toEqual([])
  })
})

describe('hQ-4 — 自動排序 scope 傳遞', () => {
  it('selected-with-sub → 引擎收到相同 scope 且遞迴', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ scope: 'selected-with-sub', targetFolderIds: ['f1'] })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls[0].scope).toBe('selected-with-sub')
    expect(h.sortCalls[0].recurse).toBe(true)
  })
})

describe('hQ-5 — 祖先 manual 規則繼承與忽略清單', () => {
  it('祖先資料夾為 manual → 子資料夾跳過，不呼叫排序', async () => {
    installChrome([{ id: '0', children: [{ id: 'p', children: [{ id: 'f1' }] }] }])
    setSettings({
      targetFolderIds: ['f1'],
      folderRules: [{ folderId: 'p', rule: { mode: 'manual', criteria: [] } }],
    })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('忽略清單中的資料夾 → 跳過並自佇列移除', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ targetFolderIds: ['f1'], ignoreFolderIds: ['f1'] })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('全局 manual 模式 → 完全不自動排序', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ sortMode: 'manual', targetFolderIds: ['f1'] })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
    expect(h.session.get(PENDING)).toEqual([])
  })
})

/* ===================== D2 第二輪：selected-with-sub 範圍 ===================== */

/** 三層樹：0 → p → sub → grand（用來驗證後代與忽略子樹） */
const nestedTree: TreeNode[] = [
  { id: '0', children: [{ id: 'p', children: [{ id: 'sub', children: [{ id: 'grand' }] }] }] },
]

async function drainMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++)
    await Promise.resolve()
}

describe('d2-r2-4 — selected-with-sub 自動排序範圍', () => {
  it('selected-with-sub 的子資料夾事件能觸發排序', async () => {
    installChrome(nestedTree)
    setSettings({ scope: 'selected-with-sub', targetFolderIds: ['p'] })
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    h.listeners.created?.('x', { parentId: 'sub' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls.map(c => c.targetIds[0])).toEqual(['sub'])
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('多層孫資料夾也能正確處理', async () => {
    installChrome(nestedTree)
    setSettings({ scope: 'selected-with-sub', targetFolderIds: ['p'] })
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    h.listeners.created?.('x', { parentId: 'grand' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls.map(c => c.targetIds[0])).toEqual(['grand'])
  })

  it('忽略資料夾及其後代不會被排序', async () => {
    installChrome(nestedTree)
    setSettings({ scope: 'selected-with-sub', targetFolderIds: ['p'], ignoreFolderIds: ['sub'] })
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    h.listeners.created?.('x', { parentId: 'grand' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('selected-only 不會擴大至子資料夾', async () => {
    installChrome(nestedTree)
    setSettings({ scope: 'selected-only', targetFolderIds: ['p'] })
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    h.listeners.created?.('x', { parentId: 'sub' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
  })

  it('children-only 不處理指定資料夾本身，但處理其子資料夾', async () => {
    installChrome(nestedTree)
    setSettings({ scope: 'children-only', targetFolderIds: ['p'] })
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()

    h.listeners.created?.('x', { parentId: 'p' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)

    h.listeners.created?.('x', { parentId: 'sub' })
    await drainMicrotasks()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls.map(c => c.targetIds[0])).toEqual(['sub'])
  })
})

describe('d2-r2-3 — Planner 與自動排序的規則繼承語意一致', () => {
  const tree = [{ id: '0', children: [{ id: 'p', children: [{ id: 'f1' }] }] }]

  it('inherit=true 的資料夾規則沿用祖先 manual（不得誤判為獨立覆寫）', async () => {
    installChrome(tree)
    setSettings({
      targetFolderIds: ['f1'],
      folderRules: [
        { folderId: 'p', rule: { mode: 'manual', inherit: false } },
        { folderId: 'f1', rule: { mode: 'criteria', inherit: true } },
      ],
    })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(0)
  })

  it('ui 格式的獨立規則（inherit=false）可覆寫全局 manual', async () => {
    installChrome(tree)
    setSettings({
      sortMode: 'manual',
      targetFolderIds: ['f1'],
      folderRules: [{ folderId: 'f1', rule: { mode: 'criteria', inherit: false } }],
    })
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls.map(c => c.targetIds[0])).toEqual(['f1'])
  })
})

/* ================= D3 — P1-1：版本號與有限輪次收斂 ================= */

describe('d3-p1-1 — 排序期間的新需求不被誤刪，且能有限輪次收斂', () => {
  it('排序期間 enqueue 提高版本號 → 完成時保留，下一輪 no-op 後才清空', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ targetFolderIds: ['f1'] })
    let calls = 0
    h.sortImpl = async () => {
      calls++
      if (calls === 1) {
        // 模擬引擎自身 move 事件在排序期間到達
        h.listeners.created?.('x', { parentId: 'f1' })
        for (let i = 0; i < 12; i++)
          await Promise.resolve()
      }
      return { status: 'completed' }
    }
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    // 版本號已變 → 不得誤刪新需求
    expect(h.session.get(PENDING)).toEqual(['f1'])

    // 下一輪已無新事件 → 冪等 no-op 後清空
    await vi.advanceTimersByTimeAsync(600)
    expect(h.sortCalls).toHaveLength(2)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('random + autoSort：引擎自身 move 事件後在有限輪次內停止重排', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ sortMode: 'random', targetFolderIds: ['f1'] })
    let calls = 0
    h.sortImpl = async () => {
      calls++
      if (calls === 1) {
        // 第一輪排序真的移動了 → 引擎事件再次 enqueue
        h.listeners.created?.('x', { parentId: 'f1' })
        for (let i = 0; i < 12; i++)
          await Promise.resolve()
      }
      return { status: 'completed' }
    }
    h.session.set(PENDING, ['f1'])
    const mod = await loadModule()
    mod.registerNativeSortAutoListener()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(600)
    // 不得持續重排：輪次有界且佇列最終清空
    expect(calls).toBeLessThanOrEqual(3)
    expect(h.session.get(PENDING)).toEqual([])
  })

  it('sW 重啟：未完成的 pending 保留，下次啟動後可正確恢復', async () => {
    installChrome([{ id: '0', children: [{ id: 'f1' }] }])
    setSettings({ targetFolderIds: ['f1'] })
    h.sortImpl = async () => ({ status: 'failed' })
    h.session.set(PENDING, ['f1'])
    let mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    // 失敗保留，不得因 SW 重啟而遺失
    expect(h.session.get(PENDING)).toEqual(['f1'])

    // 模擬 Service Worker 重啟：模組重新載入（記憶體狀態消失，pending 仍在 session）
    h.sortImpl = async () => ({ status: 'completed' })
    mod = await loadModule()
    await mod.resumeNativeSortAutoOnStartup()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.session.get(PENDING)).toEqual([])
  })
})
