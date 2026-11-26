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
  /** key=null 表示整個 storage area 已使用位元組數（Chrome getBytesInUse(null)） */
  localGetBytesInUse: (key: string | null) => Promise<number>
  localQuotaBytes: number
  sessionGet: <T>(key: string) => Promise<T | undefined>
  sessionSet: (key: string, value: unknown) => Promise<void>
  sessionRemove: (key: string) => Promise<void>
}

export const JOB_STORAGE_KEY = 'moorread:sort-job'
export const SESSION_STORAGE_KEY = 'moorread:sort-session'

/**
 * 最初排序前的原始 Snapshot，與 restore job 的快照獨立保存。
 * - sort job 啟動時寫入；restore job 不覆蓋此鍵。
 * - restore 完成且使用者放棄（discard）或明確接受後才清除。
 * - 瀏覽器重啟後若 restore 尚未完成，仍可從此鍵回到最初順序。
 */
export const SORT_SNAPSHOT_KEY = 'moorread:sort-snapshot-original'
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

/** 啟動工作的掛鉤（接線層用） */
export interface RunHooks {
  /**
   * 成功取得執行權（job 已持久化為 active）且確認有實際移動要做後呼叫。
   * 用於保存「最初排序前 Snapshot」：被拒絕或 no-op 的工作不得覆寫它。
   * 拋錯 → 工作立即 failed，且不得執行任何 move。
   */
  onAcquired?: () => Promise<void>
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

/** UTF-8 位元組數（Chrome storage 配額語意，不能用 String.length / UTF-16） */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** active / awaiting-user 之外都是終止狀態 */
function isTerminalStatus(status: JobStatus): boolean {
  return status !== 'active' && status !== 'awaiting-user'
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
  /** 协作式取消信号。cancel() 触发 abort()，所有 async 检查点终止 */
  private abortCtrl: AbortController | null = null
  /** 取消原因缓存，让等待中的协程能写入 status */
  private cancelReason: string | null = null
  /** 目前執行中的 JobRecord（cancel 立即標記終止狀態，結果物件才看得到） */
  private activeJobRef: JobRecord | null = null
  /** 序列化所有狀態寫入：讀取-合併-寫入不可交錯，避免舊物件覆蓋新終止狀態 */
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: Deps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /* ----------------------------- 儲存輔助 ----------------------------- */

  private async loadJob(): Promise<JobRecord | null> {
    const job = await this.deps.storage.localGet<JobRecord>(JOB_STORAGE_KEY)
    return job && typeof job === 'object' ? job : null
  }

  /**
   * 所有狀態寫入都經過這裡：串行化「讀取持久化副本 → 合併 → 寫入」，
   * 讓 cancel()/markExternal()/continueJob() 不會交錯寫入而互相覆蓋。
   */
  private saveJob(job: JobRecord): Promise<void> {
    const next = this.writeChain.then(() => this.writeJobNow(job))
    this.writeChain = next.catch(() => undefined)
    return next
  }

  private async writeJobNow(job: JobRecord): Promise<void> {
    // 以持久化副本裁決，避免執行中的舊物件（仍為 active）覆蓋較新的終止狀態。
    const merged = await this.mergeWithPersisted(job)
    // 配額（Chrome 語意）：
    //  - UTF-8 位元組，不可用 String.length。
    //  - 寫入既有 JOB_STORAGE_KEY 會取代舊值 → 不可把新舊大小重複相加。
    //  - 必須計入其他 storage 資料已用空間。
    const estimate = utf8Bytes(JSON.stringify(merged))
    const totalUsed = await this.deps.storage.localGetBytesInUse(null).catch(() => 0)
    const previousJobBytes = await this.deps.storage.localGetBytesInUse(JOB_STORAGE_KEY).catch(() => 0)
    if (totalUsed - previousJobBytes + estimate > this.deps.storage.localQuotaBytes)
      throw new Error('insufficient storage for sort job')
    await this.deps.storage.localSet(JOB_STORAGE_KEY, merged)
    // 讓呼叫端持有的物件同步為實際寫入的狀態（後續檢查點才會看到終止狀態）
    Object.assign(job, merged)
  }

  /**
   * 終止狀態單調性：同一 jobId 一旦持久化為終止狀態，較舊的 in-memory 物件
   * 不得把它寫回 active / completed。新工作（不同 jobId，例如 restore）不受影響。
   * pending 與 snapshot 一律保留，避免狀態競態遺失復原資訊。
   */
  private async mergeWithPersisted(job: JobRecord): Promise<JobRecord> {
    const persisted = await this.loadJob()
    if (!persisted || persisted.jobId !== job.jobId)
      return job
    if (isTerminalStatus(persisted.status)) {
      return {
        ...job,
        status: persisted.status,
        error: persisted.error ?? job.error,
        externalDirty: job.externalDirty || persisted.externalDirty,
        pending: job.pending ?? persisted.pending,
      }
    }
    if (persisted.externalDirty && !job.externalDirty)
      return { ...job, externalDirty: true }
    return job
  }

  private async clearJob(): Promise<void> {
    this.currentJobId = null
    await this.deps.storage.localRemove(JOB_STORAGE_KEY)
    await this.deps.storage.sessionRemove(SESSION_STORAGE_KEY)
  }

  /* --------------------------- 範圍/快取同步 --------------------------- */

  private async readOrdersFor(folderIds: string[]): Promise<Map<string, string[]>> {
    const orders = new Map<string, string[]>()
    const failed: string[] = []
    await Promise.all(folderIds.map(async (id) => {
      try {
        const children = await this.deps.bookmarks.getChildren(id)
        orders.set(id, children.map(n => n.id))
      }
      catch {
        // 讀取失敗 → 不偽裝成空資料夾。必要 folder 的失敗由上層（createJob 或 continueJob）處理
        failed.push(id)
      }
    }))
    if (failed.length > 0)
      throw new Error(`cannot read folders: ${failed.join(',')}`)
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
    // 2) 重複/延遲的已確認事件 → 忽略（必須核對全部四個欄位，避免誤吞使用者操作）
    const now = this.now()
    this.recentConfirmed = this.recentConfirmed.filter(e => now - e.ts < RECENT_CONFIRMED_TTL_MS)
    if (this.recentConfirmed.some(e =>
      e.id === id
      && e.parentId === info.parentId
      && e.oldIndex === info.oldIndex
      && e.index === info.index)) {
      return
    }
    // 3) 未知事件：先判斷是否涉及本次排序範圍，範圍外不得中止目前工作
    if (!this.scopeSet.has(info.parentId) && !this.scopeSet.has(info.oldParentId))
      return
    // 4) 範圍內的未知事件 → 外部變動
    await this.markExternal(job, `unexpected onMoved: ${id}`)
    if (head)
      head.reject('external')
  }

  async onChildrenReordered(id: string, _info: ReorderEventInfo): Promise<void> {
    const job = await this.loadJob()
    if (!job || job.status !== 'active')
      return
    // 範圍外資料夾的重排不影響本次工作
    if (!this.scopeSet.has(id))
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
    // 保留 pending 供稽核／恢復資訊，不用狀態競態把它清掉
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
  runSort(targets: TargetState[], snapshot: SnapshotData, hooks?: RunHooks): Promise<ExecutorResult> {
    return this.preflightNoActive().then(() =>
      this.enqueue(() => this.runJob('sort', targets, snapshot, hooks)),
    )
  }

  /** 啟動復原工作（獨立 job，有自己的 snapshot） */
  runRestore(targets: TargetState[], snapshot: SnapshotData, hooks?: RunHooks): Promise<ExecutorResult> {
    return this.preflightNoActive().then(() =>
      this.enqueue(() => this.runJob('restore', targets, snapshot, hooks)),
    )
  }

  /**
   * 可靠等待目前執行鏈到達安全停止點（含 cancel 觸發後的協作式終止）。
   * restore 以此取代固定延遲猜測，不強制中斷執行中的 Chrome API。
   */
  async whenIdle(): Promise<void> {
    for (;;) {
      const current = this.running
      await current.catch(() => undefined)
      if (current === this.running)
        return
    }
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
    hooks?: RunHooks,
  ): Promise<ExecutorResult> {
    const job = await this.createJob(kind, targets, snapshot)
    // no-op（目標與現況相同）：不移動、不呼叫 onAcquired，
    // 避免自動排序重複的 no-op 工作覆寫真正的原始 Snapshot。
    if (!this.hasPendingWork(job)) {
      job.status = 'completed'
      job.pending = null
      await this.saveJob(job)
      return { job, completed: true }
    }
    if (hooks?.onAcquired) {
      try {
        await hooks.onAcquired()
      }
      catch (cause) {
        // 原始 Snapshot 保存失敗 → 立即停止，且尚未執行任何 move
        job.status = 'failed'
        job.error = cause instanceof Error ? cause.message : 'cannot persist sort snapshot'
        job.pending = null
        await this.saveJob(job)
        return { job, completed: false }
      }
    }
    return this.continueJob(job)
  }

  /** 目標順序與目前實際順序不同 → 需要移動 */
  private hasPendingWork(job: JobRecord): boolean {
    return job.targets.some((target) => {
      const actual = this.orders.get(target.folderId) ?? []
      if (actual.length !== target.order.length)
        return true
      return actual.some((id, index) => id !== target.order[index])
    })
  }

  /** 從目前 cursor 繼續執行（共用於首次執行與 SW 恢復） */
  private async continueJob(job: JobRecord): Promise<ExecutorResult> {
    // 讓 cancel() 能立即在同一個物件上標記終止狀態（結果與持久化都一致）
    this.activeJobRef = job
    try {
      return await this.continueJobInner(job)
    }
    finally {
      if (this.activeJobRef === job)
        this.activeJobRef = null
    }
  }

  private async continueJobInner(job: JobRecord): Promise<ExecutorResult> {
    // 每次進入執行階段都重置 abortCtrl；cancel 走它而不走 enqueue 排隊
    this.abortCtrl = new AbortController()
    this.cancelReason = null
    // 預期事件是「本工作」的執行期狀態：新工作不得被前一個工作中斷後
    // 遺留的預期事件干擾（否則本工作的事件會被誤判為未知/重複）。
    this.expected = []

    this.setScopeFromSnapshot(job.snapshot)
    // 同步快取 orders（若空則重讀）；讀取失敗 → 工作立即失敗，不可偽裝
    if (this.orders.size === 0) {
      try {
        this.orders = await this.readOrdersFor([...this.scopeSet])
      }
      catch (cause) {
        job.status = 'failed'
        job.error = cause instanceof Error ? cause.message : 'cannot read initial folder state'
        await this.saveJob(job)
        return { job, completed: false }
      }
    }

    for (let i = job.cursorFolderIndex; i < job.targets.length; i++) {
      // 協作式取消檢查點：cancel() 立即生效，不排隊
      if (this.abortCtrl?.signal.aborted) {
        job.status = 'failed'
        job.error = this.cancelReason ?? 'cancelled by user'
        // 保留 pending（未完成的那筆移動）供稽核與後續恢復
        await this.saveJob(job)
        return { job, completed: false }
      }

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

    // 缺陷 1：驗證失敗 → 工作明確失敗，不可標記 completed
    if (job.verificationFailures > 0) {
      job.status = 'failed'
      job.error = `verification failed on ${job.verificationFailures} folder(s)`
      job.pending = null
      await this.saveJob(job)
      return { job, completed: false }
    }

    job.status = 'completed'
    job.pending = null
    job.error = undefined
    await this.saveJob(job)
    return { job, completed: true }
  }

  private async processFolder(job: JobRecord, target: TargetState): Promise<'ok' | 'stop'> {
    // 最多重複到目標達成或外部/失敗；每次重新讀實際順序並規劃向後搬
    for (;;) {
      // 協作式取消檢查點
      if (this.abortCtrl?.signal.aborted)
        return 'stop'
      if (job.externalDirty || job.status !== 'active')
        return 'stop'
      const actual = await this.safeGetChildren(target.folderId)
      if (actual === null) {
        // 缺陷 2：讀取失敗 → 真正的操作失敗，不是預期跳過。停止並標記失敗。
        job.skipped.push({ folderId: target.folderId, reason: 'cannot read folder' })
        job.status = 'failed'
        job.error = `cannot read folder: ${target.folderId}`
        await this.saveJob(job)
        return 'stop'
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
    // move 前檢查取消（避免在已取消狀態下仍呼叫 Chrome API）
    if (this.abortCtrl?.signal.aborted) {
      job.status = 'failed'
      job.error = this.cancelReason ?? 'cancelled by user'
      return 'stop'
    }
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
      // 每輪 retry 開始前再次檢查取消
      if (this.abortCtrl?.signal.aborted) {
        job.status = 'failed'
        job.error = this.cancelReason ?? 'cancelled by user'
        job.pending = pending // 保留 pending 供稽核
        await this.saveJob(job)
        return 'stop'
      }

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
        // 取消/外部事件：這筆移動可能仍會在稍後送達 onMoved。
        // 登記為已知引擎事件，避免下一個工作把它誤判成外部變動。
        this.forgetExpected(waiter, true)
        return 'stop' // 已由 markExternal 或 cancel 處理
      }
      // matched 的項目已由 onMoved 移出；timeout 的項目也必須清掉，
      // 但事件可能延遲到達 → 一併登記為已知事件。
      this.forgetExpected(waiter, outcome === 'timeout')

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

  /** 移出預期佇列；remember=true 時登記為已知事件（延遲或中斷後的自家事件） */
  private forgetExpected(entry: ExpectedMove, remember: boolean): void {
    this.expected = this.expected.filter(e => e !== entry)
    if (remember) {
      this.recentConfirmed.push({
        id: entry.id,
        parentId: entry.parentId,
        oldIndex: entry.oldIndex,
        index: entry.index,
        ts: this.now(),
        resolve: () => {},
        reject: () => {},
      })
    }
  }

  private waitForEvent(entry: ExpectedMove): Promise<'matched' | 'external' | 'timeout'> {
    const promise = (entry as unknown as { promise: Promise<void> }).promise
    const ctrl = this.abortCtrl
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.deps.eventWaitMs ?? EVENT_WAIT_MS, 'timeout')
      // 协作式取消：cancel() 触发 abort 后，等待中的 waiter 立即 resolve 'external'
      const onAbort = () => {
        clearTimeout(timer)
        // reject head 让 markExternal 处理外部变动路径（或直接 resolve 'external'）
        if (this.expected[0] === entry)
          entry.reject('external')
        else
          resolve('external')
      }
      if (ctrl?.signal) {
        if (ctrl.signal.aborted) {
          clearTimeout(timer)
          resolve('external')
          return
        }
        ctrl.signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
          () => {
            clearTimeout(timer)
            ctrl.signal.removeEventListener('abort', onAbort)
            resolve('matched')
          },
          () => {
            clearTimeout(timer)
            ctrl.signal.removeEventListener('abort', onAbort)
            resolve('external')
          },
        )
      }
      else {
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
      }
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
      // completed → 已完成，SW 重啟不需恢復（但 original snapshot 可能仍存在供 restore 入口）
      if (job.status === 'completed')
        return null
      // failed / stopped-external / awaiting-user → 都保留供 UI 顯示，不清除

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
    // 讀取失敗 → 工作失敗，不可偽裝成空
    try {
      this.orders = await this.readOrdersFor([...this.scopeSet])
    }
    catch (cause) {
      job.status = 'failed'
      job.error = cause instanceof Error ? cause.message : 'cannot read initial folder state'
      job.pending = null
      await this.saveJob(job)
      return job
    }
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
    // 取消中的工作若有 abort 信号一并触发，避免卡在 waitForEvent
    this.abortCtrl?.abort()
    await this.enqueue(async () => {
      await this.deps.storage.localRemove(SORT_SNAPSHOT_KEY)
      await this.clearJob()
    })
  }

  /**
   * 安全取消目前工作：**不走 enqueue 排队**，立即触发协作式取消信号。
   * - abort 后 continueJob/processFolder/executeMove/waitForEvent 所有检查点终止
   * - 保留 Snapshot、pending 和当前 job 记录，状态标记为 failed，error 记录取消原因
   * - 保存后即使 SW 休眠或重啟，仍可从 resumeAfterRestart 看到取消状态
   */
  async cancel(): Promise<void> {
    // 同步觸發 abort，讓所有 async 檢查點立即生效
    this.cancelReason = 'cancelled by user'
    // 執行中的工作物件先標記終止：即使協程稍後才保存，結果物件與持久化都是 failed
    const active = this.activeJobRef
    if (active && (active.status === 'active' || active.status === 'awaiting-user')) {
      active.status = 'failed'
      active.error = this.cancelReason
    }
    this.abortCtrl?.abort()
    // 立即保存取消狀態（不走 enqueue，避免排隊）
    try {
      if (active) {
        await this.saveJob(active)
        return
      }
      const job = await this.loadJob()
      // active / awaiting-user 都視為可中止：awaiting-user 若被中止（例如使用者改選擇復原），
      // 必須標 failed 才能通過 restore 的 preflightNoActive，且不得虛報為完成。
      if (job && (job.status === 'active' || job.status === 'awaiting-user')) {
        job.status = 'failed'
        job.error = this.cancelReason
        await this.saveJob(job)
      }
    }
    catch {
      // 保存失败不抛给调用者：abort 信号已发出，协程会自行终止
    }
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
