import type {
  HistoryEntry,
  MetadataSyncRecoveryEntry,
  TrashEntry,
} from './activity'
import type { BookmarkTreeNode } from './bookmark-tree'
import type { LocalizedText } from './i18n'
import type { SettingsSlice } from './store-settings-state'
import type { ThemePaletteSlice } from './store-theme-palette-slice'
import type {
  Bookmark,
  BookmarkMeta,
  BookmarkUsage,
  Category,
  CategoryMeta,
  Settings,
} from './types'

export interface DeletionSnapshot {
  label: LocalizedText
  roots: BookmarkTreeNode[]
  categoryMeta: Record<string, CategoryMeta>
  defaultCategoryId?: string
}

export interface PendingDeletion {
  label: LocalizedText
  expiresAt: number
  restoring: boolean
  restoreFailed?: boolean
}

export interface BackupImportResult {
  bookmarkMetaCount: number
  categoryMetaCount: number
  usageCount: number
}

export interface FullBackupRestoreResult extends BackupImportResult {
  restoredFolderName: string
  restoredNodeCount: number
}

export interface TrashRestoreResult {
  restoredRootCount: number
  remainingRootCount: number
  failedRootCount: number
}

export interface DescriptionSyncResult {
  attempted: number
  updated: number
  failed: number
}

export interface MetadataSyncStatus {
  state: 'idle' | 'syncing' | 'success' | 'error'
  direction?: 'downloaded' | 'uploaded' | 'merged' | 'unchanged'
  syncedAt?: number
  byteCount?: number
  omittedBookmarkCount?: number
  retryCount?: number
  error?: LocalizedText
}

export interface MetadataSyncLogEntry {
  id: string
  createdAt: number
  state: 'success' | 'error'
  direction?: MetadataSyncStatus['direction']
  retryCount: number
  message: LocalizedText
}

export interface BackgroundTask {
  id: string
  type: 'metadata-sync' | 'description-sync' | 'health-check' | 'trash-restore' | 'backup'
  label: LocalizedText
  state: 'running' | 'success' | 'error'
  completed: number
  total?: number
  message?: LocalizedText
  startedAt: number
  finishedAt?: number
}

export interface BookmarkSlice {
  categories: Category[]
  bookmarks: Bookmark[]
  // 浏览器书签没有描述/图标字段，使用按 URL 索引的本地元数据补充
  meta: Record<string, BookmarkMeta>
  categoryMeta: Record<string, CategoryMeta>
  usage: Record<string, BookmarkUsage>

  activeCategoryId: string
  /** 本頁是否由使用者主動選過分類；用於避免首屏載入完成後覆蓋使用者的選擇。 */
  categorySelectionTouched: boolean
  bookmarkSearchQuery: string

  loadBookmarks: () => Promise<void>
  applyNativeBookmarkTitle: (nativeId: string, title: string, expectedUrl?: string) => boolean
  /** 手动同步当前缺失的书签描述，同一时间只运行一个任务 */
  syncMissingDescriptions: () => Promise<DescriptionSyncResult>
  syncBookmarkDescriptions: (ids: string[]) => Promise<DescriptionSyncResult>
  /** 更新某 URL 的描述/图标元数据 */
  setBookmarkMeta: (url: string, patch: Partial<BookmarkMeta> | ((latest: BookmarkMeta) => Partial<BookmarkMeta>), bookmarkId?: string) => Promise<void>
  refreshSupplementaryMetadata: () => Promise<void>
  setBookmarkPinned: (url: string, pinned: boolean) => Promise<void>
  reorderPinnedCard: (sourceKey: string, targetKey: string) => Promise<void>
  setBookmarkTags: (url: string, tags: string[]) => Promise<void>
  markBookmarksOrganized: (ids: string[]) => Promise<void>
  setActiveCategory: (id: string) => void
  setBookmarkSearchQuery: (query: string) => void
  addBookmark: (bookmark: Omit<Bookmark, 'id'>) => Promise<void>
  updateBookmark: (
    id: string,
    patch: Partial<Omit<Bookmark, 'id'>>,
  ) => Promise<void>
  reconcileBookmarkUrlChange: (nativeId: string, url: string) => Promise<void>
  removeBookmark: (id: string) => Promise<void>
  moveBookmarks: (ids: string[], categoryId: string) => Promise<void>
  reorderBookmark: (id: string, targetId: string) => Promise<void>
  reorderPinnedBookmark: (id: string, targetId: string) => Promise<void>
  removeBookmarks: (ids: string[]) => Promise<void>
  recordBookmarkOpen: (url: string) => Promise<void>
  refreshUsage: () => Promise<void>
  clearUsage: () => Promise<void>
}

export interface GroupSlice {
  pendingDeletion: PendingDeletion | null

  /** 新建浏览器书签文件夹，同名文件夹直接复用 */
  addCategory: (name: string, emoji?: string) => Promise<string>
  updateCategory: (
    id: string,
    patch: { name?: string, emoji?: string, parentId?: string },
  ) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  undoLastDeletion: () => Promise<void>
  persistDeletion: (snapshot: DeletionSnapshot) => Promise<void>
  recordActivity: (action: HistoryEntry['action'], label: LocalizedText) => Promise<void>
  restoreTrashEntry: (id: string) => Promise<TrashRestoreResult>
  removeTrashEntry: (id: string) => Promise<void>
  clearHistory: () => Promise<void>
  clearTrash: () => Promise<void>
}

export interface BackupSlice {
  metadataSyncStatus: MetadataSyncStatus
  metadataSyncLog: MetadataSyncLogEntry[]
  metadataSyncPassphraseSet: boolean
  metadataSyncRecovery: MetadataSyncRecoveryEntry[]
  tasks: BackgroundTask[]

  exportBackup: () => string
  importBackup: (raw: string, strategy?: 'merge' | 'replace' | 'skip') => Promise<BackupImportResult>
  exportFullBackup: () => Promise<string>
  restoreFullBackup: (raw: string, onProgress?: (done: number, total: number) => void) => Promise<FullBackupRestoreResult>
  syncMetadataNow: () => Promise<void>
  restoreMetadataSyncRecovery: (id: string) => Promise<boolean>
  removeMetadataSyncRecovery: (id: string) => Promise<void>
  clearMetadataSyncRecovery: () => Promise<void>
  clearSupplementaryMetadata: () => Promise<void>
  beginTask: (task: Pick<BackgroundTask, 'id' | 'type' | 'label' | 'total'>) => void
  updateTask: (id: string, patch: Partial<Pick<BackgroundTask, 'completed' | 'total' | 'message'>>) => void
  finishTask: (id: string, state: 'success' | 'error', message?: LocalizedText) => void
  clearFinishedTasks: () => void
}

/** 初始化失敗狀態；`retryable` 只代表最後一個錯誤屬於已確認的暫態簽章。 */
export interface InitFailure {
  message: string
  retryable: boolean
}

export interface NavState extends SettingsSlice, BookmarkSlice, GroupSlice, BackupSlice, ThemePaletteSlice {
  settings: Settings
  /** 必要資料全部讀取並驗證成功後才會是 true。 */
  initialized: boolean
  /** 初始化失敗時保留失敗原因，不得據此顯示成空資料。 */
  initError: InitFailure | null
  trash: TrashEntry[]
  history: HistoryEntry[]

  init: () => Promise<void>
}
