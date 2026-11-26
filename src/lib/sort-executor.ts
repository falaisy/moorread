import type {
  JobKind,
  JobRecord,
  JobStatus,
  PendingMove,
  RestoreStats,
  SnapshotData,
  TargetState,
} from './sort-types'
import { planFolderMoves } from './sort-snapshot'

/**
 * Executor 模組：唯一可以呼叫 chrome.bookmarks.move() 的模組。
 *
 * 設計要點（對應任務規範）：
 *  - 單一執行控制：同一時間只有一個 job 在跑。
 *  - 工作持久化：JobRecord 存 chrome.storage.local（跨 SW 休眠、跨瀏覽器重啟）。
 *  - sessionId 存 chrome.storage.session（瀏覽器關閉即清除）→ 區分 SW 休眠（自動恢復）
 *    與瀏覽器重啟（等待使用者確認）。
 *  - 結構指紋：只使用 (id, parentId, index)，不含 title/url。
 *  - 每筆移動：保存 pending → 登記預期事件 → move() → 等 API + onMoved 核對 →
 *    必要時重讀實況 → 指紋裁決 → 清除 pending → 下一筆。
 *  - 不得把 Promise resolve 當成事件已完成；事件未抵達用有限等待 + 重讀裁決。
 *  - 失敗立即停止；外部變動立即停止，不覆蓋使用者操作。
 *  - 不使用全域 sortingInProgress 旗標忽略所有移動事件；監聽器永久註冊，
 *    以預期事件 FIFO 核對，未知事件標記 externalDirty。
 */

export interface SortBookmarkNode {
  id: string
  parentId?: string
  index?: number
  title?: string
  url?: string
}

export interface BookmarkAdapter {
  getChildren: (folderId: string) => Promise<SortBookmarkNode[]>
  move: (id: string, dest: { parentId: string, index: number }) => Promise<void>
}

export interface MoveEventInfo {
  parentId: string
  oldParentId: string
  index: number
  oldIndex: number
}
export interface ReorderEventInfo {
  childIds: string[]
}
export interface ChangeEventInfo {
  title?: string
  url?: string
}
export interface CreateEventInfo {
  parentId: string
  index?: number
}
export interface RemoveEventInfo {
  parentId: string
  index: number
  node: SortBookmarkNode
}

export interface EventAdapter {
  // 實際由接線層在 SW 頂層同步註冊後，把事件轉呼到 executor 的 handler。
  // 這裡僅定義 handler 形狀；events 介面保留給需要的接線。
  _placeholder?: never
}

export interface StorageAdapter {
  localGet: <T>(key: string) => Promise<T | undefined>
  localSet: (key: string, value: unknown) => Promise<void>
  localRemove: (key: string) => Promise<void>
  localGetBytesInUse: (key: string) => Promise<number>
  localQuotaBytes: number
  sessionGet: <T>(key: string) => Promise<T | undefined>
  sessionSet: (key: string, value: unknown) => Promise<void>
  sessionRemove: (key: string) => Promise<void>
}

export const JOB_STORAGE_KEY = 'moorread:sort-job'
export const SESSION_STORAGE_KEY = 'moorread:sort-session'
const EVENT_WAIT_MS = 4000
const RECENT_CONFIRMED_TTL_MS = 5000
const MAX_MOVE_RETRIES = 1

interface ExpectedMove {
  id: string
  parentId: string
  oldIndex: number
  index: number
  resolve: () => void
  reject: (reason: 'external') => void
}

interface Deps {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  /** 可注入的時鐘，便於測試 */
  now?: () => number
  /** 事件等待逾時（ms），預設 4000；測試可縮短 */
  eventWaitMs?: number
}

export interface ExecutorResult {
  job: JobRecord
  completed: boolean
}

/* --------------------------------- 指紋 ---------------------------------- */

function fnv1a(str: string): string {
  let h = 0x811C9DC5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * 結構指紋：只使用 (id, parentId, index)。
 * orders: folderId -> 子節點 id 順序（index 即陣列位置）。
 */
function fingerprint(orders: Map<string, string[]>): string {
  const parts: string[] = []
  for (const folderId of [...orders.keys()].sort()) {
    const list = orders.get(folderId) ?? []
    list.forEach((id, index) => {
      parts.push(`${id}|${folderId}|${index}`)
    })
  }
  return fnv1a(parts.join(','))
}

/** 測試用：計算結構指紋（建構有效 JobRecord 以驗證 SW 恢復規則） */
export function _fingerprintForTest(orders: Record<string, string[]>): string {
  return fingerprint(new Map(Object.entries(orders)))
}

/** 模擬一筆向後搬移對 orders 的影響（回傳新 orders，不變動輸入） */
function applyMoveToOrders(
  orders: Map<string, string[]>,
  folderId: string,
  id: string,
  to: number,
): Map<string, string[]> {
  const next = new Map(orders)
  const list = [...(next.get(folderId) ?? [])]
  const from = list.indexOf(id)
  if (from !== -1) {
    list.splice(from, 1)
    // 向後搬（from > to）：Chrome 對向後搬不作 index-1 位移
    list.splice(to, 0, id)
  }
  next.set(folderId, list)
  return next
}

/* ------------------------------- 工作記錄 -------------------------------- */

function newJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
function newSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyStats(): Pick<
  JobRecord,
  'movedBookmarks' | 'movedFolders' | 'foldersProcessed' | 'verificationFailures' | 'skipped'
> {
  return { movedBookmarks: 0, movedFolders: 0, foldersProcessed: 0, verificationFailures: 0, skipped: [] }
}

/* -------------------------------- Executor -------------------------------- */

export class SortExecutor {
  private running: Promise<unknown> = Promise.resolve()
  private expected: ExpectedMove[] = []
  private recentConfirmed: Array<ExpectedMove & { ts: number }> = []
  private orders: Map<string, string[]> = new Map()
  private readonly scopeSet: Set<string> = new Set() // 由目前 job 的 snapshot 載入
  private currentJobId: string | null = null

  constructor(private readonly deps: Deps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /* ----------------------------- 儲存輔助 ----------------------------- */

  private async loadJob(): Promise<JobRecord | null> {
    const job = await this.deps.storage.localGet<JobRecord>(JOB_STORAGE_KEY)
    return job && typeof job === 'object' ? job : null
  }

  private async saveJob(job: JobRecord): Promise<void> {
    const estimate = JSON.stringify(job).length
    const used = await this.deps.storage.localGetBytesInUse(JOB_STORAGE_KEY).catch(() => 0)
    if (used + estimate > this.deps.storage.localQuotaBytes) {
      throw new Error('insufficient storage for sort job')
    }
    await this.deps.storage.localSet(JOB_STORAGE_KEY, job)
  }

  private async clearJob(): Promise<void> {
    this.currentJobId = null
    await this.deps.storage.localRemove(JOB_STORAGE_KEY)
    await this.deps.storage.sessionRemove(SESSION_STORAGE_KEY)
  }

  /* --------------------------- 範圍/快取同步 --------------------------- */

  private async readOrdersFor(folderIds: string[]): Promise<Map<string, string[]>> {
    const orders = new Map<string, string[]>()
    await Promise.all(folderIds.map(async (id) => {
      try {
        const children = await this.deps.bookmarks.getChildren(id)
        orders.set(id, children.map(n => n.id))
      }
      catch {
        orders.set(id, [])
      }
    }))
    return orders
  }

  private setScopeFromSnapshot(snapshot: SnapshotData): void {
    this.scopeSet.clear()
    for (const id of snapshot.scopeFolderIds)
      this.scopeSet.add(id)
    // 也把快照中出現的所有父資料夾納入偵測範圍（targets 對應的資料夾）
    for (const folderId of Object.keys(snapshot.folderOrders))
      this.scopeSet.add(folderId)
  }

  /* ------------------------------ 事件核對 ----------------------------- */

  /** 由接線層在 SW 頂層同步監聽後轉呼 */
  async onMoved(id: string, info: MoveEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active') {
      // 沒有活躍 job：不處理（讓自動排等其他模組自己決定）
      return
    }
    // 1) 比對預期事件（FIFO，head）
    const head = this.expected[0]
    if (head) {
      const match
        = head.id === id
          && head.parentId === info.parentId
          && head.parentId === info.oldParentId // 同資料夾內移動
          && head.oldIndex === info.oldIndex
          && head.index === info.index
      if (match) {
        this.expected.shift()
        // 立即登記到 recentConfirmed，使同步/快速到達的重複事件能被辨識為重複，
        // 不會誤判為外部變動（onMoved 為 async，重複事件可能在 confirmExpected 前到達）
        this.recentConfirmed.push({
          id: head.id,
          parentId: head.parentId,
          oldIndex: head.oldIndex,
          index: head.index,
          ts: this.now(),
          resolve: () => {},
          reject: () => {},
        })
        head.resolve()
        return
      }
      // 同 id 但參數不符：可能是重複/延遲事件，先檢查 recentConfirmed
    }
    // 2) 重複/延遲的已確認事件 → 忽略
    const now = this.now()
    this.recentConfirmed = this.recentConfirmed.filter(e => now - e.ts < RECENT_CONFIRMED_TTL_MS)
    if (this.recentConfirmed.some(e =>
      e.id === id && e.parentId === info.parentId && e.index === info.index)) {
      return
    }
    // 3) 未知事件 → 外部變動
    await this.markExternal(job, `unexpected onMoved: ${id}`)
    if (head)
      head.reject('external')
  }

  async onChildrenReordered(_id: string, _info: ReorderEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active')
      return
    await this.markExternal(job, 'onChildrenReordered')
    const head = this.expected[0]
    if (head)
      head.reject('external')
  }

  async onChanged(id: string, _info: ChangeEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active')
      return
    // 僅當節點屬於本次範圍（其資料夾在 scope 中）才讓計畫失效
    if (!this.isInScope(id))
      return
    await this.markExternal(job, `onChanged in scope: ${id}`)
    const head = this.expected[0]
    if (head)
      head.reject('external')
  }

  async onCreated(id: string, info: CreateEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active')
      return
    if (!this.scopeSet.has(info.parentId))
      return
    await this.markExternal(job, `onCreated in scope: ${id}`)
    const head = this.expected[0]
    if (head)
      head.reject('external')
  }

  async onRemoved(_id: string, info: RemoveEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active')
      return
    if (!this.scopeSet.has(info.parentId))
      return
    await this.markExternal(job, `onRemoved in scope: ${info.parentId}`)
    const head = this.expected[0]
    if (head)
      head.reject('external')
  }

  private isInScope(nodeId: string): boolean {
    // 節點是否在某個 scope 資料夾中：以快取 orders 判斷（或 snapshot）
    for (const list of this.orders.values()) {
      if (list.includes(nodeId))
        return true
    }
    return false
  }

  private async markExternal(job: JobRecord, reason: string): Promise<void> {
    if (job.externalDirty)
      return
    job.externalDirty = true
    job.status = 'stopped-external'
    job.error = reason
    job.pending = null
    await this.saveJob(job)
  }

  /* ------------------------------ 啟動工作 ----------------------------- */

  private async ensureNoActiveJob(): Promise<void> {
    const existing = await this.loadJob()
    if (existing && (existing.status === 'active' || existing.status === 'awaiting-user')) {
      throw new Error('a sort job is already in progress; complete or discard it first')
    }
  }

  private async createJob(
    kind: JobKind,
    targets: TargetState[],
    snapshot: SnapshotData,
  ): Promise<JobRecord> {
    await this.ensureNoActiveJob()
    const sessionId = newSessionId()
    await this.deps.storage.sessionSet(SESSION_STORAGE_KEY, { sessionId })
    const job: JobRecord = {
      jobId: newJobId(),
      kind,
      sessionId,
      startedAt: this.now(),
      status: 'active',
      targets,
      snapshot,
      cursorFolderIndex: 0,
      cursorStep: 0,
      hConfirmed: '',
      pending: null,
      externalDirty: false,
      ...emptyStats(),
    }
    this.setScopeFromSnapshot(snapshot)
    // 起始指紋
    this.orders = await this.readOrdersFor([...this.scopeSet])
    job.hConfirmed = fingerprint(this.orders)
    await this.saveJob(job)
    this.currentJobId = job.jobId
    return job
  }

  /** 啟動排序工作 */
  runSort(targets: TargetState[], snapshot: SnapshotData): Promise<ExecutorResult> {
    return this.preflightNoActive().then(() =>
      this.enqueue(() => this.runJob('sort', targets, snapshot)),
    )
  }

  /** 啟動復原工作（獨立 job，有自己的 snapshot） */
  runRestore(targets: TargetState[], snapshot: SnapshotData): Promise<ExecutorResult> {
    return this.preflightNoActive().then(() =>
      this.enqueue(() => this.runJob('restore', targets, snapshot)),
    )
  }

  /** 立即檢查是否已有活躍工作，避免在無限等待的工作後面排隊 */
  private async preflightNoActive(): Promise<void> {
    const job = await this.loadJob()
    if (job && (job.status === 'active' || job.status === 'awaiting-user')) {
      throw new Error('a sort job is already in progress; complete or discard it first')
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.running.then(fn)
    this.running = next.catch(() => undefined)
    return next
  }

  private async runJob(
    kind: JobKind,
    targets: TargetState[],
    snapshot: SnapshotData,
  ): Promise<ExecutorResult> {
    const job = await this.createJob(kind, targets, snapshot)
    return this.continueJob(job)
  }

  /** 從目前 cursor 繼續執行（共用於首次執行與 SW 恢復） */
  private async continueJob(job: JobRecord): Promise<ExecutorResult> {
    this.setScopeFromSnapshot(job.snapshot)
    // 同步快取 orders（若空則重讀）
    if (this.orders.size === 0)
      this.orders = await this.readOrdersFor([...this.scopeSet])

    for (let i = job.cursorFolderIndex; i < job.targets.length; i++) {
      const target = job.targets[i]
      const outcome = await this.processFolder(job, target)
      if (outcome === 'stop') {
        await this.saveJob(job)
        return { job, completed: false }
      }
      job.cursorFolderIndex = i + 1
      job.cursorStep = 0
      job.foldersProcessed++
      await this.saveJob(job)

      // 最終核對：以 Chrome 實際順序驗證目標，不以內部模型宣稱成功
      const verified = await this.verifyFolder(target)
      if (!verified)
        job.verificationFailures++
      await this.saveJob(job)
    }

    job.status = 'completed'
    job.pending = null
    await this.saveJob(job)
    return { job, completed: true }
  }

  private async processFolder(job: JobRecord, target: TargetState): Promise<'ok' | 'stop'> {
    // 最多重複到目標達成或外部/失敗；每次重新讀實際順序並規劃向後搬
    for (;;) {
      if (job.externalDirty || job.status !== 'active')
        return 'stop'
      const actual = await this.safeGetChildren(target.folderId)
      if (actual === null) {
        job.skipped.push({ folderId: target.folderId, reason: 'cannot read folder' })
        return 'ok' // 無法讀取就跳過此資料夾，繼續下一個（不擴大損害）
      }
      this.orders.set(target.folderId, actual)
      const steps = planFolderMoves(actual, target.order)
      if (steps.length === 0)
        return 'ok'

      const step = steps[0]
      const moved = await this.executeMove(job, target.folderId, step)
      if (moved !== 'ok')
        return 'stop'
      const isFolder = job.snapshot.nodes[step.id]?.isFolder
      if (isFolder)
        job.movedFolders++
      else
        job.movedBookmarks++
      await this.saveJob(job)
    }
  }

  private async safeGetChildren(folderId: string): Promise<string[] | null> {
    try {
      const children = await this.deps.bookmarks.getChildren(folderId)
      return children.map(n => n.id)
    }
    catch {
      return null
    }
  }

  private async verifyFolder(target: TargetState): Promise<boolean> {
    const actual = await this.safeGetChildren(target.folderId)
    if (actual === null)
      return false
    if (actual.length !== target.order.length)
      return false
    return actual.every((id, index) => id === target.order[index])
  }

  /* ------------------------------ 單筆移動 ----------------------------- */

  private async executeMove(
    job: JobRecord,
    folderId: string,
    step: { id: string, from: number, to: number },
  ): Promise<'ok' | 'stop'> {
    const actual = this.orders.get(folderId) ?? []
    const oldIndex = actual.indexOf(step.id)
    if (oldIndex === -1) {
      // 節點已不在此資料夾 → 外部變動
      await this.markExternal(job, `node missing before move: ${step.id}`)
      return 'stop'
    }

    // 預期移動後的指紋
    const afterOrders = applyMoveToOrders(this.orders, folderId, step.id, step.to)
    const hAfter = fingerprint(afterOrders)

    const pending: PendingMove = {
      id: step.id,
      parentId: folderId,
      oldIndex,
      index: step.to,
      hAfter,
      folderId,
    }
    job.pending = pending
    await this.saveJob(job) // 1. 保存 pending

    for (let attempt = 0; attempt <= MAX_MOVE_RETRIES; attempt++) {
      // 2. 登記預期事件
      const waiter = this.registerExpected(pending)
      // 3. 呼叫 move
      let moveError: unknown
      try {
        await this.deps.bookmarks.move(step.id, { parentId: folderId, index: step.to })
      }
      catch (cause) {
        moveError = cause
      }

      if (moveError !== undefined) {
        // move API 失敗立即停止
        this.expected = this.expected.filter(e => e !== waiter)
        job.status = 'failed'
        job.error = `move failed: ${step.id}`
        job.pending = pending // 保留 pending 供稽核
        await this.saveJob(job)
        return 'stop'
      }

      // 4. 等待 API 結果及對應 onMoved 事件核對（不得把 resolve 當完成）
      const outcome = await this.waitForEvent(waiter)

      if (outcome === 'external') {
        return 'stop' // 已由 markExternal 處理
      }

      // 5. 必要時重新讀取 Chrome 實際資料；6. 指紋裁決
      const actualNow = await this.safeGetChildren(folderId)
      if (actualNow !== null) {
        this.orders.set(folderId, actualNow)
        const hNow = fingerprint(this.orders)
        if (hNow === hAfter) {
          // 7. 確認成功才清除 pending
          this.confirmExpected(pending)
          job.pending = null
          job.hConfirmed = hNow
          return 'ok'
        }
        if (hNow === job.hConfirmed) {
          // 移動尚未生效 → 可重新執行
          if (attempt < MAX_MOVE_RETRIES)
            continue
          job.status = 'failed'
          job.error = `move did not take effect: ${step.id}`
          await this.saveJob(job)
          return 'stop'
        }
      }
      // 其他情況 → 外部變動
      await this.markExternal(job, `fingerprint mismatch after move: ${step.id}`)
      return 'stop'
    }
    return 'stop'
  }

  private registerExpected(pending: PendingMove): ExpectedMove {
    let resolve!: () => void
    let reject!: (reason: 'external') => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    const entry: ExpectedMove = {
      id: pending.id,
      parentId: pending.parentId,
      oldIndex: pending.oldIndex,
      index: pending.index,
      resolve,
      reject,
    }
    ;(entry as unknown as { promise: Promise<void> }).promise = promise
    this.expected.push(entry)
    return entry
  }

  private confirmExpected(pending: PendingMove): void {
    this.recentConfirmed.push({
      id: pending.id,
      parentId: pending.parentId,
      oldIndex: pending.oldIndex,
      index: pending.index,
      ts: this.now(),
      resolve: () => {},
      reject: () => {},
    })
  }

  private waitForEvent(entry: ExpectedMove): Promise<'matched' | 'external' | 'timeout'> {
    const promise = (entry as unknown as { promise: Promise<void> }).promise
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.deps.eventWaitMs ?? EVENT_WAIT_MS, 'timeout')
      promise.then(
        () => {
          clearTimeout(timer)
          resolve('matched')
        },
        () => {
          clearTimeout(timer)
          resolve('external')
        },
      )
    })
  }

  /* --------------------------- SW 中斷恢復 ---------------------------- */

  /**
   * Service Worker 重啟時呼叫。
   *  - sessionId 仍在 storage.session → SW 休眠 → 自動檢查並恢復。
   *  - sessionId 不存在 → 瀏覽器重啟 → 不自行繼續，標記 awaiting-user，等待使用者確認。
   */
  async resumeOnStartup(): Promise<JobRecord | null> {
    return this.enqueue(async () => {
      const job = await this.loadJob()
      if (!job)
        return null
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped-external')
        return null

      const session = await this.deps.storage.sessionGet<{ sessionId: string }>(SESSION_STORAGE_KEY)
      if (!session || session.sessionId !== job.sessionId) {
        // 瀏覽器重啟：不可自行繼續
        if (job.status === 'active') {
          job.status = 'awaiting-user'
          await this.saveJob(job)
        }
        return job
      }

      // SW 休眠恢復
      if (job.externalDirty) {
        job.status = 'stopped-external'
        await this.saveJob(job)
        return job
      }
      return this.recoverAndContinue(job)
    })
  }

  /** 使用者確認後，從瀏覽器重啟的 awaiting-user 狀態繼續 */
  resumeAfterRestart(): Promise<JobRecord | null> {
    return this.enqueue(async () => {
      const job = await this.loadJob()
      if (!job || job.status !== 'awaiting-user')
        return job ?? null
      // 重新綁定 session
      job.sessionId = newSessionId()
      job.status = 'active'
      await this.deps.storage.sessionSet(SESSION_STORAGE_KEY, { sessionId: job.sessionId })
      await this.saveJob(job)
      return this.recoverAndContinue(job)
    })
  }

  private async recoverAndContinue(job: JobRecord): Promise<JobRecord> {
    this.setScopeFromSnapshot(job.snapshot)
    this.orders = await this.readOrdersFor([...this.scopeSet])
    const hNow = fingerprint(this.orders)

    if (job.pending) {
      const pending = job.pending
      if (hNow === pending.hAfter) {
        // 該筆移動已成功但尚未完成記錄 → 視為成功，清除 pending 繼續
        job.hConfirmed = hNow
        job.pending = null
        const isFolder = job.snapshot.nodes[pending.id]?.isFolder
        if (isFolder)
          job.movedFolders++
        else
          job.movedBookmarks++
        await this.saveJob(job)
      }
      else if (hNow === job.hConfirmed) {
        // 該筆移動尚未生效 → 可重新執行（從目前資料夾繼續，processFolder 會重新規劃）
        job.pending = null
        await this.saveJob(job)
      }
      else {
        // 其他情況 → 外部變動，停止自動續跑及自動回滾，保留 Snapshot
        job.externalDirty = true
        job.status = 'stopped-external'
        job.error = 'external change detected during resume'
        job.pending = null
        await this.saveJob(job)
        return job
      }
    }
    else if (hNow !== job.hConfirmed) {
      // 沒有 pending 但指紋不符 → 外部變動
      job.externalDirty = true
      job.status = 'stopped-external'
      job.error = 'external change detected during resume (no pending)'
      await this.saveJob(job)
      return job
    }

    const result = await this.continueJob(job)
    return result.job
  }

  /** 使用者放棄中斷的工作（清除記錄；快照一併清除） */
  async discardJob(): Promise<void> {
    await this.enqueue(async () => {
      await this.clearJob()
    })
  }

  /** 安全取消目前工作（保留快照與記錄，狀態標記為 stopped-external 以外的可查狀態） */
  async cancel(): Promise<void> {
    await this.enqueue(async () => {
      const job = await this.loadJob()
      if (!job || job.status !== 'active')
        return
      job.status = 'stopped-external'
      job.error = 'cancelled by user'
      job.pending = null
      await this.saveJob(job)
    })
  }

  async getJob(): Promise<JobRecord | null> {
    return this.loadJob()
  }
}

/** 建議恢復統計（還原成功/跳過/失敗），便於 UI 顯示；failed 來自執行結果 */
export function summarizeRestore(job: JobRecord): RestoreStats {
  return {
    restored: job.movedBookmarks + job.movedFolders,
    skipped: job.skipped.length,
    failed: job.status === 'failed' || job.status === 'stopped-external' ? 1 : 0,
  }
}

export type { JobStatus }
