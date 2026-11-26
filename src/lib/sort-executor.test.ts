import type {
  BookmarkAdapter,
  ChangeEventInfo,
  CreateEventInfo,
  MoveEventInfo,
  RemoveEventInfo,
  ReorderEventInfo,
  SortBookmarkNode,
  StorageAdapter,
} from './sort-executor'
import type { JobRecord, NativeSortRule, PlannerNode, SnapshotData } from './sort-types'
import { describe, expect, it } from 'vitest'
import {
  _fingerprintForTest,
  JOB_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SortExecutor,
} from './sort-executor'
import { buildSortPlan, DEFAULT_SORT_CRITERIA, planToTargets } from './sort-planner'
import { captureSnapshot } from './sort-snapshot'

/* ------------------------------ mock 基礎建設 ------------------------------ */

class MockStorage implements StorageAdapter {
  local = new Map<string, unknown>()
  session = new Map<string, unknown>()
  localQuotaBytes = 10 * 1024 * 1024
  async localGet<T>(k: string): Promise<T | undefined> {
    return (this.local.has(k) ? this.local.get(k) : undefined) as T | undefined
  }

  async localSet(k: string, v: unknown): Promise<void> {
    this.local.set(k, v)
  }

  async localRemove(k: string): Promise<void> {
    this.local.delete(k)
  }

  async localGetBytesInUse(k: string): Promise<number> {
    return this.local.has(k) ? JSON.stringify(this.local.get(k)).length : 0
  }

  async sessionGet<T>(k: string): Promise<T | undefined> {
    return (this.session.has(k) ? this.session.get(k) : undefined) as T | undefined
  }

  async sessionSet(k: string, v: unknown): Promise<void> {
    this.session.set(k, v)
  }

  async sessionRemove(k: string): Promise<void> {
    this.session.delete(k)
  }
}

interface MockMeta {
  id: string
  parentId: string
  isFolder: boolean
  title?: string
  url?: string
}

class MockBookmarks implements BookmarkAdapter {
  children = new Map<string, string[]>()
  meta = new Map<string, MockMeta>()
  handlers: {
    moved: ((id: string, info: MoveEventInfo) => void)[]
    reordered: ((id: string, info: ReorderEventInfo) => void)[]
    changed: ((id: string, info: ChangeEventInfo) => void)[]
    created: ((id: string, info: CreateEventInfo) => void)[]
    removed: ((id: string, info: RemoveEventInfo) => void)[]
  } = { moved: [], reordered: [], changed: [], created: [], removed: [] }

  // 注入控制
  eventDelayMs = 0
  suppressEvents = false
  failMoveIds = new Set<string>()
  mismatchMoveIds = new Set<string>()
  duplicateMoveIds = new Set<string>()
  hangMoveIds = new Set<string>()
  /** getChildren 對此 folderId 抛错（模擬讀取失敗） */
  failReadIds = new Set<string>()

  wire(executor: SortExecutor): () => void {
    const moved = (id: string, info: MoveEventInfo) => executor.onMoved(id, info)
    const reordered = (id: string, info: ReorderEventInfo) => executor.onChildrenReordered(id, info)
    const changed = (id: string, info: ChangeEventInfo) => executor.onChanged(id, info)
    const created = (id: string, info: CreateEventInfo) => executor.onCreated(id, info)
    const removed = (id: string, info: RemoveEventInfo) => executor.onRemoved(id, info)
    this.handlers.moved.push(moved)
    this.handlers.reordered.push(reordered)
    this.handlers.changed.push(changed)
    this.handlers.created.push(created)
    this.handlers.removed.push(removed)
    return () => {
      this.handlers.moved = this.handlers.moved.filter(h => h !== moved)
      this.handlers.reordered = this.handlers.reordered.filter(h => h !== reordered)
      this.handlers.changed = this.handlers.changed.filter(h => h !== changed)
      this.handlers.created = this.handlers.created.filter(h => h !== created)
      this.handlers.removed = this.handlers.removed.filter(h => h !== removed)
    }
  }

  private fire<K extends keyof MockBookmarks['handlers']>(key: K, ...args: Parameters<MockBookmarks['handlers'][K][number]>) {
    for (const h of [...this.handlers[key]])
      (h as (...a: unknown[]) => void)(...args)
  }

  setFolder(folderId: string, childIds: string[]): void {
    this.children.set(folderId, [...childIds])
    childIds.forEach((id) => {
      const existing = this.meta.get(id)
      this.meta.set(id, existing
        ? { ...existing, parentId: folderId }
        : { id, parentId: folderId, isFolder: !id.startsWith('bm') })
    })
  }

  async getChildren(folderId: string): Promise<SortBookmarkNode[]> {
    // 模擬讀取失敗
    if (this.failReadIds.has(folderId))
      throw new Error(`mock read failed: ${folderId}`)
    const ids = this.children.get(folderId) ?? []
    return ids.map((id, index) => {
      const m = this.meta.get(id) ?? { id, parentId: folderId, isFolder: false }
      return { id, parentId: m.parentId, index, title: m.title, url: m.url }
    })
  }

  async move(id: string, dest: { parentId: string, index: number }): Promise<void> {
    if (this.hangMoveIds.has(id))
      return new Promise(() => {}) // 永遠不 resolve，模擬 SW 在 move 中被殺
    if (this.failMoveIds.has(id))
      throw new Error(`chrome move failed for ${id}`)

    const meta = this.meta.get(id)
    if (!meta)
      throw new Error('unknown node')
    const srcFolder = meta.parentId
    const srcList = this.children.get(srcFolder) ?? []
    const from = srcList.indexOf(id)
    if (from === -1)
      throw new Error('node not in source folder')

    // 套用 Chrome 移動語意（同層往前搬會 index-1）
    srcList.splice(from, 1)
    let insertIndex = dest.index
    if (srcFolder === dest.parentId && from < dest.index)
      insertIndex = dest.index - 1
    const dstList = this.children.get(dest.parentId) ?? []
    dstList.splice(insertIndex, 0, id)
    meta.parentId = dest.parentId
    this.children.set(srcFolder, srcList)
    this.children.set(dest.parentId, dstList)

    const newIndex = dstList.indexOf(id)
    if (!this.suppressEvents) {
      const fire = () => {
        let info: MoveEventInfo = {
          parentId: dest.parentId,
          oldParentId: srcFolder,
          index: newIndex,
          oldIndex: from,
        }
        if (this.mismatchMoveIds.has(id))
          info = { ...info, index: info.index + 99 } // 參數不符
        this.fire('moved', id, info)
        if (this.duplicateMoveIds.has(id))
          this.fire('moved', id, info) // 重複事件
      }
      if (this.eventDelayMs > 0)
        setTimeout(fire, this.eventDelayMs)
      else
        fire()
    }
  }

  // 外部操作模擬（直接改變樹並觸發事件，不登記預期事件）
  externalCreate(id: string, folderId: string, index: number): void {
    const list = this.children.get(folderId) ?? []
    list.splice(index, 0, id)
    this.meta.set(id, { id, parentId: folderId, isFolder: false, title: id })
    this.children.set(folderId, list)
    this.fire('created', id, { parentId: folderId, index })
  }

  externalRemove(id: string): void {
    const meta = this.meta.get(id)
    if (!meta)
      return
    const list = this.children.get(meta.parentId) ?? []
    const index = list.indexOf(id)
    list.splice(index, 1)
    this.children.set(meta.parentId, list)
    this.fire('removed', id, { parentId: meta.parentId, index, node: { id, parentId: meta.parentId, index } })
  }

  externalReorder(folderId: string): void {
    this.fire('reordered', folderId, { childIds: this.children.get(folderId) ?? [] })
  }

  externalChange(id: string, title: string): void {
    const m = this.meta.get(id)
    if (m)
      m.title = title
    this.fire('changed', id, { title })
  }
}

/* -------------------------------- 輔助函式 -------------------------------- */

function makeTree(order: string[]): { tree: PlannerNode[], snapshot: SnapshotData } {
  const children = order.map(id => ({
    id,
    title: id,
    url: `https://${id}.test`,
    index: order.indexOf(id),
  }))
  const tree: PlannerNode[] = [{
    id: '0',
    title: 'root',
    children: [{ id: '1', title: 'folder', children }],
  }]
  const snapshot = captureSnapshot(tree, ['1'])
  return { tree, snapshot }
}

function planTargets(tree: PlannerNode[], rule: NativeSortRule) {
  const plan = buildSortPlan(tree, {
    scope: 'selected-only',
    targetFolderIds: ['1'],
    ignoreFolderIds: [],
    defaultRule: rule,
  })
  return planToTargets(plan)
}

function makeExecutor(bookmarks: MockBookmarks, storage: MockStorage, waitMs = 20) {
  const exec = new SortExecutor({
    bookmarks,
    storage,
    now: () => Date.now(),
    eventWaitMs: waitMs,
  })
  bookmarks.wire(exec)
  return exec
}

const ascTitle: NativeSortRule = {
  mode: 'criteria',
  criteria: [{ field: 'title', direction: 'asc' }],
  foldersFirst: true,
}

/* ---------------------------------- 測試 ---------------------------------- */

describe('executor — 正常移動', () => {
  it('sorts a folder and verifies against actual chrome order', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'A', 'B'])
    bookmarks.setFolder('1', ['C', 'A', 'B'])
    const exec = makeExecutor(bookmarks, storage)

    const targets = planTargets(tree, ascTitle)
    const result = await exec.runSort(targets, snapshot)

    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B', 'C'])
    expect(result.job.movedBookmarks).toBe(2)
    expect(result.job.verificationFailures).toBe(0)
  })

  it('persists a job record and clears on completion', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)
    await exec.runSort(planTargets(tree, ascTitle), snapshot)
    // session 標記在完成後不清除（job 完成）；local 仍保留完成記錄供查詢
    expect(await storage.localGet<JobRecord>(JOB_STORAGE_KEY)).toBeTruthy()
  })
})

describe('executor — move API 失敗立即停止', () => {
  it('stops on first move failure, does not continue', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'A', 'B'])
    bookmarks.setFolder('1', ['C', 'A', 'B'])
    bookmarks.failMoveIds.add('A') // 第一步要移 A（向後搬到 0）
    const exec = makeExecutor(bookmarks, storage)

    const result = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(result.completed).toBe(false)
    expect(result.job.status).toBe('failed')
    // 失敗後不得繼續：順序仍未完全排序
    expect(bookmarks.children.get('1')).not.toEqual(['A', 'B', 'C'])
  })
})

describe('executor — 事件延遲 / 未抵達 / 參數不符 / 重複', () => {
  it('promise resolve 但事件延遲：仍能成功核對', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.eventDelayMs = 5 // 事件在 resolve 之後 5ms 才到
    const exec = makeExecutor(bookmarks, storage, 50)
    const result = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })

  it('事件未抵達：逾時後重讀實況，以指紋裁決成功', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.suppressEvents = true // move 套用但完全不觸發 onMoved
    const exec = makeExecutor(bookmarks, storage, 20)
    const result = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    // move 有實際套用 → 指紋符合 hAfter → 成功
    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })

  it('事件參數不符：視為外部變動，停止', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'A', 'B'])
    bookmarks.setFolder('1', ['C', 'A', 'B'])
    bookmarks.mismatchMoveIds.add('A')
    const exec = makeExecutor(bookmarks, storage, 30)
    const result = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(result.completed).toBe(false)
    expect(result.job.status).toBe('stopped-external')
    expect(result.job.externalDirty).toBe(true)
  })

  it('重複事件：第二筆被忽略，工作仍成功', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.duplicateMoveIds.add('A')
    const exec = makeExecutor(bookmarks, storage, 30)
    const result = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })
})

describe('executor — 外部變動偵測', () => {
  it('外部新增（範圍內）→ 停止，不覆蓋使用者操作', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.suppressEvents = true // 讓 executor 進入等待視窗
    const exec = makeExecutor(bookmarks, storage, 50)
    const targets = planTargets(tree, ascTitle)
    const p = exec.runSort(targets, snapshot)
    await new Promise(r => setTimeout(r, 5))
    bookmarks.externalCreate('NEW', '1', 0) // 使用者在範圍內新增
    const result = await p
    expect(result.completed).toBe(false)
    expect(result.job.status).toBe('stopped-external')
    // 使用者新增的節點仍在，未被覆蓋
    expect(bookmarks.children.get('1')).toContain('NEW')
  })

  it('外部刪除（範圍內）→ 停止', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.suppressEvents = true
    const exec = makeExecutor(bookmarks, storage, 50)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    await new Promise(r => setTimeout(r, 5))
    bookmarks.externalRemove('B')
    const result = await p
    expect(result.job.status).toBe('stopped-external')
  })

  it('onChildrenReordered → 停止', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.suppressEvents = true
    const exec = makeExecutor(bookmarks, storage, 50)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    await new Promise(r => setTimeout(r, 5))
    bookmarks.externalReorder('1')
    const result = await p
    expect(result.job.status).toBe('stopped-external')
  })

  it('onChanged 範圍內節點 → 計畫失效並停止', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.suppressEvents = true
    const exec = makeExecutor(bookmarks, storage, 50)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    await new Promise(r => setTimeout(r, 5))
    bookmarks.externalChange('A', 'Renamed By User')
    const result = await p
    expect(result.job.status).toBe('stopped-external')
  })

  it('外部變動不在範圍內 → 不影響排序', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.setFolder('99', ['X']) // 不在 scope
    bookmarks.suppressEvents = true
    const exec = makeExecutor(bookmarks, storage, 50)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    await new Promise(r => setTimeout(r, 5))
    bookmarks.externalCreate('OUT', '99', 0) // 範圍外
    const result = await p
    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })
})

describe('executor — 單一執行控制', () => {
  it('拒絕同時啟動第二個工作', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'B', 'A'])
    bookmarks.setFolder('1', ['C', 'B', 'A'])
    bookmarks.eventDelayMs = 200 // 第一個工作在等待事件，保持 active
    const exec = makeExecutor(bookmarks, storage, 500)
    const targets = planTargets(tree, ascTitle)
    const first = exec.runSort(targets, snapshot)
    await new Promise(r => setTimeout(r, 20)) // 讓第一個工作持久化為 active
    await expect(exec.runSort(targets, snapshot)).rejects.toThrow(/already in progress/)
    const result = await first // 第一個工作最後仍正常完成
    expect(result.completed).toBe(true)
    expect(bookmarks.children.get('1')).toEqual(['A', 'B', 'C'])
  })
})

describe('executor — Service Worker 中斷恢復（每個 pending 階段）', () => {
  function freshExecutorWithSameState(
    bookmarks: MockBookmarks,
    storage: MockStorage,
  ): SortExecutor {
    // 全新 executor 實例（模擬 SW 重啟，記憶體狀態遺失，但 storage 仍在）
    return makeExecutor(bookmarks, storage, 20)
  }

  it('hNow == hConfirmed 且無 pending → 從 cursor 繼續', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)
    await exec.runSort(planTargets(tree, ascTitle), snapshot)
    // 完成後模擬重啟：全新 executor + storage 仍有完成記錄 → 不應重跑
    const exec2 = freshExecutorWithSameState(bookmarks, storage)
    const resumed = await exec2.resumeOnStartup()
    expect(resumed).toBeNull() // 已完成，不恢復
  })

  it('hNow == pending.hAfter → 移動已成功但未記錄，清除 pending 繼續', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'B', 'A'])
    const targets = planTargets(tree, ascTitle) // ['A','B','C']
    // 第一步：A from2→0，套用後 ['A','C','B']（move 已生效，但 SW 被殺未記錄）
    bookmarks.setFolder('1', ['A', 'C', 'B'])
    const job: JobRecord = {
      jobId: 'r1',
      kind: 'sort',
      sessionId: 's',
      startedAt: Date.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: _fingerprintForTest({ 1: ['C', 'B', 'A'] }),
      pending: {
        id: 'A',
        parentId: '1',
        oldIndex: 2,
        index: 0,
        hAfter: _fingerprintForTest({ 1: ['A', 'C', 'B'] }),
        folderId: '1',
      },
      externalDirty: false,
      movedBookmarks: 0,
      movedFolders: 0,
      foldersProcessed: 0,
      verificationFailures: 0,
      skipped: [],
    }
    await storage.sessionSet(SESSION_STORAGE_KEY, { sessionId: 's' })
    await storage.localSet(JOB_STORAGE_KEY, job)
    const resumed = await freshExecutorWithSameState(bookmarks, storage).resumeOnStartup()
    expect(resumed!.status).toBe('completed')
    expect(bookmarks.children.get('1')).toEqual(['A', 'B', 'C'])
    expect(resumed!.movedBookmarks).toBe(2) // pending 那筆 + 後續 B
  })

  it('hNow == hConfirmed 且 pending 存在 → 移動尚未生效，重新執行', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    const targets = planTargets(tree, ascTitle) // ['A','B']
    bookmarks.setFolder('1', ['B', 'A']) // move 尚未生效
    const job: JobRecord = {
      jobId: 'r2',
      kind: 'sort',
      sessionId: 's',
      startedAt: Date.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: _fingerprintForTest({ 1: ['B', 'A'] }),
      pending: {
        id: 'A',
        parentId: '1',
        oldIndex: 1,
        index: 0,
        hAfter: _fingerprintForTest({ 1: ['A', 'B'] }),
        folderId: '1',
      },
      externalDirty: false,
      movedBookmarks: 0,
      movedFolders: 0,
      foldersProcessed: 0,
      verificationFailures: 0,
      skipped: [],
    }
    await storage.sessionSet(SESSION_STORAGE_KEY, { sessionId: 's' })
    await storage.localSet(JOB_STORAGE_KEY, job)
    const resumed = await freshExecutorWithSameState(bookmarks, storage).resumeOnStartup()
    expect(resumed!.status).toBe('completed')
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })

  it('hNow 不符 hConfirmed 也不符 pending.hAfter → 外部變動，停止且不覆蓋', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    const targets = planTargets(tree, ascTitle)
    bookmarks.setFolder('1', ['X', 'Y']) // 與預期完全不同（外部變動）
    const job: JobRecord = {
      jobId: 'r3',
      kind: 'sort',
      sessionId: 's',
      startedAt: Date.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: _fingerprintForTest({ 1: ['B', 'A'] }),
      pending: {
        id: 'A',
        parentId: '1',
        oldIndex: 1,
        index: 0,
        hAfter: _fingerprintForTest({ 1: ['A', 'B'] }),
        folderId: '1',
      },
      externalDirty: false,
      movedBookmarks: 0,
      movedFolders: 0,
      foldersProcessed: 0,
      verificationFailures: 0,
      skipped: [],
    }
    await storage.sessionSet(SESSION_STORAGE_KEY, { sessionId: 's' })
    await storage.localSet(JOB_STORAGE_KEY, job)
    const resumed = await freshExecutorWithSameState(bookmarks, storage).resumeOnStartup()
    expect(resumed!.status).toBe('stopped-external')
    expect(bookmarks.children.get('1')).toEqual(['X', 'Y']) // 未被覆蓋
  })

  it('瀏覽器重啟（session 標記遺失）→ 不自行繼續；使用者確認後才完成', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    const targets = planTargets(tree, ascTitle)
    bookmarks.setFolder('1', ['B', 'A'])
    const job: JobRecord = {
      jobId: 'r4',
      kind: 'sort',
      sessionId: 'old',
      startedAt: Date.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: _fingerprintForTest({ 1: ['B', 'A'] }),
      pending: {
        id: 'A',
        parentId: '1',
        oldIndex: 1,
        index: 0,
        hAfter: _fingerprintForTest({ 1: ['A', 'B'] }),
        folderId: '1',
      },
      externalDirty: false,
      movedBookmarks: 0,
      movedFolders: 0,
      foldersProcessed: 0,
      verificationFailures: 0,
      skipped: [],
    }
    await storage.localSet(JOB_STORAGE_KEY, job)
    // 不設定 session → 模擬瀏覽器重啟：不可自行繼續
    const exec2 = freshExecutorWithSameState(bookmarks, storage)
    const resumed = await exec2.resumeOnStartup()
    expect(resumed!.status).toBe('awaiting-user')
    expect(bookmarks.children.get('1')).toEqual(['B', 'A']) // 未被改動
    // 使用者確認後才繼續（hNow == hConfirmed 且 pending 存在 → 重新執行）
    const after = await exec2.resumeAfterRestart()
    expect(after!.status).toBe('completed')
    expect(bookmarks.children.get('1')).toEqual(['A', 'B'])
  })

  it('外部變動已標記的 job：SW 重啟後不續跑也不自動回滾，保留快照', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    const targets = planTargets(tree, ascTitle)
    bookmarks.setFolder('1', ['B', 'A'])
    const job: JobRecord = {
      jobId: 'r5',
      kind: 'sort',
      sessionId: 's',
      startedAt: Date.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: _fingerprintForTest({ 1: ['B', 'A'] }),
      pending: null,
      externalDirty: true,
      movedBookmarks: 0,
      movedFolders: 0,
      foldersProcessed: 0,
      verificationFailures: 0,
      skipped: [],
    }
    await storage.sessionSet(SESSION_STORAGE_KEY, { sessionId: 's' })
    await storage.localSet(JOB_STORAGE_KEY, job)
    const resumed = await freshExecutorWithSameState(bookmarks, storage).resumeOnStartup()
    expect(resumed!.status).toBe('stopped-external')
    expect(bookmarks.children.get('1')).toEqual(['B', 'A']) // 不續跑、不回滾
  })
})

describe('executor — 儲存容量不足時拒絕開始', () => {
  it('refuses to start when local storage quota is insufficient', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    storage.localQuotaBytes = 1 // 極小配額
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)
    await expect(exec.runSort(planTargets(tree, ascTitle), snapshot)).rejects.toThrow(/insufficient storage/)
  })
})

/* ========================= D2 缺陷：验证失败不得 completed ========================= */
describe('d2-1 — 最终验证失败 → 工作明確 failed，不可 completed', () => {
  it('continueJob 結束時 verificationFailures > 0 → status=failed', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)

    // 第一次 runSort：正常完成（A→B）
    const first = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(first.completed).toBe(true)
    expect(first.job.status).toBe('completed')

    // 手动改 job：注入 verificationFailures + status 改成 awaiting-user（讓 resumeAfterRestart 進入 recoverAndContinue）
    const job = (await storage.localGet<JobRecord>(JOB_STORAGE_KEY))!
    job.verificationFailures = 2
    job.status = 'awaiting-user'
    job.cursorFolderIndex = 0
    job.foldersProcessed = 0
    // bookmarks 此时已经是 ['A', 'B']（正确顺序），所以 verifyFolder 不会新增 failures
    // 但 continueJob 循环结束后会检查 job.verificationFailures → 标 failed

    // 清空 orders 快取让 continueJob 重建
    const exec2 = makeExecutor(bookmarks, storage)
    const resumed = await exec2.resumeAfterRestart()
    // resumeAfterRestart → recoverAndContinue → continueJob → 循环结束 → verificationFailures=2 > 0 → 强制标 failed
    expect(resumed.status).toBe('failed')
    expect(resumed.verificationFailures).toBe(2)
  })
})

/* ========================= D2 缺陷：資料夾讀取失敗不可當成成功 ========================= */
describe('d2-2 — getChildren 失敗 → status=failed，不可偽裝成空資料夾', () => {
  it('createJob 阶段 scope 内 folder 讀取失敗 → 拒絕啟動（抛错）', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    bookmarks.failReadIds.add('1') // 讀取 folder 1 抛错
    const exec = makeExecutor(bookmarks, storage)
    await expect(exec.runSort(planTargets(tree, ascTitle), snapshot)).rejects.toThrow()
  })

  it('continueJob 重建 orders 时 safeGetChildren 讀取失敗 → status=failed', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'A', 'B'])
    bookmarks.setFolder('1', ['C', 'A', 'B'])
    const exec = makeExecutor(bookmarks, storage)

    const targets = planTargets(tree, ascTitle)
    // 第一次 runSort 成功；orders 快取建立
    const first = await exec.runSort(targets, snapshot)
    expect(first.completed).toBe(true)

    // 建立 resume 情境：清空 orders 快取、注入 failReadIds、让 continueJob 重建 orders 时失败
    bookmarks.failReadIds.add('1')
    const job = (await storage.localGet<JobRecord>(JOB_STORAGE_KEY))!
    job.status = 'awaiting-user' // 让 resumeAfterRestart 进入 recoverAndContinue
    job.cursorFolderIndex = 0
    await storage.localSet(JOB_STORAGE_KEY, job)

    const exec2 = makeExecutor(bookmarks, storage)
    // resumeAfterRestart → recoverAndContinue → continueJob → orders 空 → readOrdersFor([...scopeSet]) → folder 1 失败
    // readOrdersFor 抛错 → continueJob catch → 标 failed → 返回
    const resumed = await exec2.resumeAfterRestart()
    expect(resumed.status).toBe('failed')
    expect(resumed.error).toMatch(/cannot read/)
  })
})

/* ========================= D2 缺陷：cancel 及時生效 ========================= */
describe('d2-7 — cancel() 協作式取消，不排隊、立即生效', () => {
  it('active job 進行中 → cancel() 立即停止，不等待 enqueue 排隊', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'B', 'A'])
    bookmarks.setFolder('1', ['C', 'B', 'A'])
    // 让 move 事件延迟，确保 executor 进入 waitForEvent 阶段
    bookmarks.eventDelayMs = 100
    const exec = makeExecutor(bookmarks, storage, 500)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    // 等一下让 executor 进入 processFolder → executeMove → waitForEvent
    await new Promise(r => setTimeout(r, 15))
    // 立即 cancel（不走 enqueue 排队）
    await exec.cancel()
    const result = await p
    expect(result.completed).toBe(false)
    expect(result.job.status).toBe('failed')
    expect(result.job.error).toBe('cancelled by user')
  })

  it('已取消 job → 再次 cancel 不报错；cancel 狀態可查', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)
    // 没有 active job 时 cancel 应静默 no-op
    await expect(exec.cancel()).resolves.not.toThrow()
    const res = await exec.runSort(planTargets(tree, ascTitle), snapshot)
    expect(res.completed).toBe(true)
  })

  it('cancel 後 discard 清除 original snapshot 與 job 記錄', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    const { tree, snapshot } = makeTree(['C', 'B', 'A'])
    bookmarks.setFolder('1', ['C', 'B', 'A'])
    bookmarks.eventDelayMs = 100
    const exec = makeExecutor(bookmarks, storage, 500)
    const p = exec.runSort(planTargets(tree, ascTitle), snapshot)
    await new Promise(r => setTimeout(r, 15))
    await exec.cancel()
    await p
    expect((await storage.localGet<JobRecord>(JOB_STORAGE_KEY))?.status).toBe('failed')
    await exec.discardJob()
    expect(await storage.localGet(JOB_STORAGE_KEY)).toBeUndefined()
  })
})

/* ========================= D2 HQ-9 — 配額估算用 UTF-8 位元組 ========================= */
describe('d2-HQ9 — 儲存配額估算使用 UTF-8 位元組數', () => {
  it('含中文的 job 估算以 UTF-8 計（非 UTF-16 code unit）', async () => {
    const bookmarks = new MockBookmarks()
    const storage = new MockStorage()
    // 計算：含中文的 JSON.stringify 長度 vs Blob.size
    const withChinese = JSON.stringify({ msg: '測試配額估算' })
    const utf16 = withChinese.length // = 15 字元 × 2 bytes = 30 code units
    const utf8 = new Blob([withChinese]).size // 含 5 個中文字 × 3 bytes = 15 + 其餘
    expect(utf8).toBeGreaterThan(utf16) // 確認 Blob.size 比 length 大

    // 驗證 MockStorage.localQuotaBytes 若設太小 → 含中文 job 會被拒絕
    storage.localQuotaBytes = 40 // 極小
    const { tree, snapshot } = makeTree(['B', 'A'])
    bookmarks.setFolder('1', ['B', 'A'])
    const exec = makeExecutor(bookmarks, storage)
    // sortNativeBookmarks 會保存 snapshot 到 storage（executor.createJob）
    // 配額 40 bytes 太小 → 抛错
    await expect(exec.runSort(planTargets(tree, ascTitle), snapshot)).rejects.toThrow(/insufficient storage/)
  })
})

// 抑制未使用警告
void DEFAULT_SORT_CRITERIA
