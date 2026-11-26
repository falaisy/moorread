import type { BackgroundTask, MetadataSyncLogEntry, NavState } from './store-types'
import type {
  Bookmark,
  BookmarkMeta,
  BookmarkUsage,
  Category,
  CategoryMeta,
  Settings,
} from './types'

import { create } from 'zustand'
import {
  historyStorageKey,
  metadataSyncRecoveryStorageKey,
  pruneHistory,
  pruneMetadataSyncRecovery,
  pruneTrash,
  trashStorageKey,
} from './activity'
import { markLocalMetadataChanged } from './metadata-sync'
import { runSidebarLsMigration } from './migrate-sidebar-ls'
import { runLegacyStorageMigration } from './migrate-yunji-storage'
import { EMPTY_THEME_PALETTE } from './palette'
import { createBackupSlice, scheduleMetadataSync, setMetadataSyncRunner } from './store-backup-slice'
import { createBookmarkSlice } from './store-bookmark-slice'
import { createGroupSlice } from './store-group-slice'
import { removeLegacyFaviconMeta, setUsagePublisher } from './store-helpers'
import {
  metaStorage,
  persist,
  registerSupplementaryPersisted,
  settingsStorage,
  STORAGE_KEYS,
  updateBookmarkMetadata,
  withSettingsLock,
} from './store-persistence'
import { createSettingsSlice } from './store-settings-slice'
import { DEFAULT_SETTINGS, normalizeSettings } from './store-settings-state'
import { createThemePaletteSlice } from './store-theme-palette-slice'
import { writeCachedPaletteBaseColor } from './theme-boot'
import { readThemePalette } from './theme-palette-storage'

export {
  flushUsagePersistence,
  mergeAlternateUrlsForDuplicate,
  metadataAutoSyncDelayMs,
  usagePersistDelayMs,
} from './store-helpers'
export type {
  BackgroundTask,
  BackupImportResult,
  DescriptionSyncResult,
  FullBackupRestoreResult,
  MetadataSyncLogEntry,
  MetadataSyncStatus,
  NavState,
  PendingDeletion,
  TrashRestoreResult,
} from './store-types'

/**
 * 與 `e2e/support/storage-ready.ts` 相同的已確認簽章：只有這個 LevelDB
 * NewSequentialFile/MANIFEST 讀取錯誤可重試，其他錯誤一律立即失敗。
 */
const TRANSIENT_STORAGE_READ_ERROR = /IO error: .*MANIFEST|NewSequentialFile/
const INIT_READ_ATTEMPTS = 5
const INIT_RETRY_BASE_DELAY_MS = 150

/** 進行中的初始化；並發呼叫共用同一輪讀取。 */
let initPromise: Promise<void> | null = null

async function readInitialValue<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < INIT_READ_ATTEMPTS; attempt += 1) {
    try {
      return await read()
    }
    catch (cause) {
      if (!TRANSIENT_STORAGE_READ_ERROR.test(String(cause)))
        throw cause
      lastError = cause
      await new Promise(resolve => setTimeout(
        resolve,
        INIT_RETRY_BASE_DELAY_MS * (attempt + 1),
      ))
    }
  }
  throw lastError
}

/** 必要資料必須是「沒有值」或純物件；陣列、字串等異常形狀不可當成空記錄。 */
function assertStoredRecord(value: unknown, field: string): void {
  if (value === undefined)
    return
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`init.invalid.${field}`)
}

export const useNavStore = create<NavState>()((set, get, store) => ({
  ...createBookmarkSlice(set, get, store),
  ...createGroupSlice(set, get, store),
  ...createBackupSlice(set, get, store),

  settings: DEFAULT_SETTINGS,
  initialized: false,
  initError: null,
  trash: [],
  history: [],

  init: async () => {
    if (get().initialized)
      return
    // 單飛：並發的初始化共用同一輪讀取，避免重複讀寫或互相覆蓋。
    if (!initPromise) {
      initPromise = (async () => {
        try {
          // 舊版 `yunji-tab:*` 資料需在讀取前搬過來，否則使用者會看到資料遺失。
          await runLegacyStorageMigration()
          const [
            meta,
            categoryMeta,
            storedSettings,
            usage,
            trash,
            history,
            metadataSyncLog,
            metadataSyncPassphrase,
            metadataSyncRecovery,
            tasks,
            themePalette,
          ] = await Promise.all([
            readInitialValue(() => metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta)),
            readInitialValue(() => metaStorage.get<Record<string, CategoryMeta>>(
              STORAGE_KEYS.categoryMeta,
            )),
            readInitialValue(() => settingsStorage.get<Settings>(STORAGE_KEYS.settings)),
            readInitialValue(() => metaStorage.get<Record<string, BookmarkUsage>>(STORAGE_KEYS.usage)),
            readInitialValue(() => metaStorage.get<unknown>(trashStorageKey)),
            readInitialValue(() => metaStorage.get<unknown>(historyStorageKey)),
            readInitialValue(() => metaStorage.get<MetadataSyncLogEntry[]>(STORAGE_KEYS.metadataSyncLog)),
            readInitialValue(() => metaStorage.get<string>(STORAGE_KEYS.metadataSyncPassphrase)),
            readInitialValue(() => metaStorage.get<unknown>(metadataSyncRecoveryStorageKey)),
            readInitialValue(() => metaStorage.get<BackgroundTask[]>(STORAGE_KEYS.tasks)),
            readThemePalette(),
          ])
          // 讀到但形狀錯誤的資料不可當成空資料套用，否則會用空狀態覆蓋既有書籤。
          assertStoredRecord(meta, 'meta')
          assertStoredRecord(categoryMeta, 'categoryMeta')
          assertStoredRecord(storedSettings, 'settings')
          assertStoredRecord(usage, 'usage')
          const normalizedMeta = removeLegacyFaviconMeta(meta ?? {})
          // One-shot V7 migration: backfill sidebar width/collapsed from the
          // old localStorage keys into synced storage before normalization.
          await runSidebarLsMigration(settingsStorage)
          // Re-read after migration so normalizeSettings sees the merged values.
          const settingsAfterMigration = await readInitialValue(
            () => settingsStorage.get<Settings>(STORAGE_KEYS.settings),
          )
          assertStoredRecord(settingsAfterMigration, 'settings')
          // 原生書籤排序功能已移除：舊版 storage 可能殘留 nativeBookmarkSort。
          // 只清掉這一個欄位，其他設定原樣保留；引擎與入口已不存在，不會再被執行。
          if (
            settingsAfterMigration
            && Object.hasOwn(
              settingsAfterMigration as unknown as Record<string, unknown>,
              'nativeBookmarkSort',
            )
          ) {
            void withSettingsLock(async () => {
              const latest = await settingsStorage.get<Record<string, unknown>>(
                STORAGE_KEYS.settings,
              )
              if (!latest || !Object.hasOwn(latest, 'nativeBookmarkSort'))
                return
              const rest = Object.fromEntries(
                Object.entries(latest).filter(([key]) => key !== 'nativeBookmarkSort'),
              )
              await persist(settingsStorage, STORAGE_KEYS.settings, rest)
            }).catch(() => undefined)
          }
          set({
            meta: normalizedMeta.meta,
            categoryMeta: categoryMeta ?? {},
            usage: usage ?? {},
            settings: normalizeSettings(settingsAfterMigration),
            trash: pruneTrash(trash),
            history: pruneHistory(history),
            metadataSyncLog: Array.isArray(metadataSyncLog)
              ? metadataSyncLog.slice(0, 20)
              : [],
            metadataSyncPassphraseSet: typeof metadataSyncPassphrase === 'string'
              && metadataSyncPassphrase.length > 0,
            metadataSyncRecovery: pruneMetadataSyncRecovery(metadataSyncRecovery),
            tasks: Array.isArray(tasks)
              ? tasks.filter(task => task?.state !== 'running').slice(0, 50)
              : [],
            initialized: true,
            initError: null,
            themePalette,
          })
          // 讓首繪快取與正式儲存保持一致（含外部清除或還原預設）。
          writeCachedPaletteBaseColor(themePalette.savedBaseColor)
          if (normalizedMeta.changed) {
            void updateBookmarkMetadata((latest) => {
              const normalized = removeLegacyFaviconMeta(latest)
              return normalized.changed ? normalized.meta : latest
            }, () => get().meta)
          }
        }
        catch (cause) {
          // 保留失敗狀態，讓 UI 顯示錯誤與重試入口；絕不以空資料宣告初始化完成。
          set({
            initError: {
              message: cause instanceof Error ? cause.message : String(cause),
              retryable: TRANSIENT_STORAGE_READ_ERROR.test(String(cause)),
            },
          })
          throw cause
        }
      })()
      const attempt = initPromise
      const release = () => {
        if (initPromise === attempt)
          initPromise = null
      }
      void attempt.then(release, release)
    }
    return initPromise
  },

  ...createSettingsSlice(set, get, store),
  ...createThemePaletteSlice(set, get, store),
  themePalette: EMPTY_THEME_PALETTE,
}))

setUsagePublisher(usage => useNavStore.setState({ usage }))

setMetadataSyncRunner(() => {
  void useNavStore.getState().syncMetadataNow()
})

registerSupplementaryPersisted(async () => {
  await markLocalMetadataChanged()
  scheduleMetadataSync()
})

// === 派生 selector hooks ===

export const useCategories = (): Category[] => useNavStore(s => s.categories)

export const useBookmarks = (): Bookmark[] => useNavStore(s => s.bookmarks)
