/**
 * 書籤排序子系統的共享型別（無行為，不算第四個核心模組）。
 *
 * 三個核心模組：
 *   - sort-planner.ts   排序規則解析、範圍正規化、TargetState 計算
 *   - sort-snapshot.ts  排序前快照、復原計畫、部分復原統計
 *   - sort-executor.ts  唯一呼叫 chrome.bookmarks.move()，pending/指紋/事件核對/中斷恢復
 *
 * bookmark-native-sort.ts 是薄型入口與接線層，重新匯出這裡的公開型別以保持向後相容。
 */

/** 排序維度 */
export type NativeSortField = 'title' | 'url' | 'dateAdded' | 'dateLastUsed'

/** 排序方向 */
export type NativeSortDirection = 'asc' | 'desc'

/** 單一排序依據 */
export interface NativeSortCriterion {
  field: NativeSortField
  direction: NativeSortDirection
}

/** 排序模式 */
export type NativeSortMode = 'criteria' | 'manual' | 'random'

/**
 * 單一資料夾適用的排序規則。
 * - mode='criteria'：依 criteria 多欄位排序
 * - mode='manual'：保留目前原生順序，不主動移動（自動排序也不得覆蓋）
 * - mode='random'：以 seed 決定固定目標順序（同一 job 重跑結果一致）
 *
 * pinnedTop / pinnedBottom 保留使用者指定的節點 id 與順序，不被其他規則破壞。
 * 明確設定在資料夾上的規則即為獨立覆寫（inherit 未指定或 false）；
 * inherit=true 代表宣告沿用最近祖先的覆寫規則（跳過自己）。
 * Planner 與自動排序共用同一語意（resolveEffectiveRule）。
 */
export interface NativeSortRule {
  mode: NativeSortMode
  criteria?: NativeSortCriterion[]
  foldersFirst?: boolean
  seed?: number
  pinnedTop?: string[]
  pinnedBottom?: string[]
  inherit?: boolean
}

/** 資料夾獨立規則 */
export interface NativeFolderRule {
  folderId: string
  rule: NativeSortRule
}

/**
 * 排序範圍四選一（清楚表達，不得因遷移擴大範圍）：
 *   - all              全部可寫資料夾
 *   - selected-only    只排序指定資料夾本身（不遞迴）
 *   - selected-with-sub 指定資料夾及其全部子資料夾
 *   - children-only    不排序指定資料夾本身，只排序其子資料夾
 */
export type NativeSortScope
  = 'all'
    | 'selected-only'
    | 'selected-with-sub'
    | 'children-only'

/** Planner 輸入的輕量節點（不依賴 Chrome API，方便單元測試） */
export interface PlannerNode {
  id: string
  parentId?: string
  index?: number
  title?: string
  url?: string
  dateAdded?: number
  dateLastUsed?: number
  /** Chrome 原生型別為 string（如 "managed"），這裡以 truthy 判斷不可寫 */
  unmodifiable?: string | boolean
  children?: PlannerNode[]
}

/** 單一資料夾的目標子節點順序 */
export interface TargetState {
  folderId: string
  /** 期望的子節點 id 順序（同資料夾內，不跨資料夾） */
  order: string[]
}

/** 單一資料夾的排序計畫 */
export interface FolderPlan {
  folderId: string
  /** 解析後（含繼承/覆寫）實際套用的規則 */
  rule: NativeSortRule
  /** 目標狀態 */
  target: TargetState
  /** 跳過原因；有值代表此資料夾不執行移動 */
  skipReason?: string
}

/** 整個排序工作的計畫（post-order：子資料夾先、父資料夾後；每個資料夾只出現一次） */
export interface SortPlan {
  /** 依執行順序排列（子在前、父在後） */
  folders: FolderPlan[]
  createdAt: number
}

/** 快照中保存的單一節點最小資訊 */
export interface SnapshotNode {
  id: string
  parentId: string
  index: number
  isFolder: boolean
  title?: string
}

/**
 * 排序前的完整快照。
 * 保存每個父資料夾的原始子節點順序，以及節點是否存在/被移動的判斷依據。
 */
export interface SnapshotData {
  capturedAt: number
  /** folderId -> 原始子節點 id 順序 */
  folderOrders: Record<string, string[]>
  /** id -> 節點資訊（用於判斷是否被外部移動/刪除） */
  nodes: Record<string, SnapshotNode>
  /** 本次排序涵蓋的資料夾 id 集合 */
  scopeFolderIds: string[]
}

/** 一筆預期/暫存的移動操作 */
export interface PendingMove {
  id: string
  parentId: string
  oldIndex: number
  index: number
  /** 移動後預期的結構指紋 */
  hAfter: string
  /** 隸屬的資料夾（用於統計與除錯） */
  folderId: string
}

/** 工作種類 */
export type JobKind = 'sort' | 'restore'

/** 工作狀態 */
export type JobStatus
  = 'active' // 執行中或 SW 休眠中斷，可恢復
    | 'awaiting-user' // 瀏覽器重啟後，等待使用者確認才繼續
    | 'stopped-external' // 外部變動，已安全停止，保留快照
    | 'completed'
    | 'failed'

/**
 * 持久化的排序/復原工作記錄。
 * 存於 chrome.storage.local（跨 SW 休眠、跨瀏覽器重啟皆保留）。
 * sessionId 另存於 chrome.storage.session（瀏覽器關閉即清除），
 * 用於區分「SW 休眠」（自動恢復）與「瀏覽器重啟」（等待使用者確認）。
 */
export interface JobRecord {
  jobId: string
  kind: JobKind
  sessionId: string
  startedAt: number
  status: JobStatus
  /** 每個資料夾的目標狀態（sort job）或復原目標（restore job） */
  targets: TargetState[]
  /** 快照；restore job 也有自己的快照 */
  snapshot: SnapshotData
  /** 執行進度：目前處理到的資料夾 index（對應 targets 陣列） */
  cursorFolderIndex: number
  /** 目前資料夾內已完成到第幾步 */
  cursorStep: number
  /** 最後一次確認的結構指紋 */
  hConfirmed: string
  /** 尚未確認完成的移動 */
  pending: PendingMove | null
  /** 是否偵測到外部變動 */
  externalDirty: boolean
  /** 統計 */
  movedBookmarks: number
  movedFolders: number
  foldersProcessed: number
  verificationFailures: number
  skipped: Array<{ folderId: string, reason: string }>
  error?: string
}

/** 復原統計 */
export interface RestoreStats {
  restored: number
  skipped: number
  failed: number
}
