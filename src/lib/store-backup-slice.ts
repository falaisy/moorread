import type { StateCreator } from 'zustand'
import type { MetadataChangeSummary, MetadataSyncRecoveryEntry } from './activity'
import type { MoorreadBackup } from './backup'
import type { LocalizedText } from './i18n'
import type { MetadataSyncResult } from './metadata-sync'
import type { BackupSlice, MetadataSyncLogEntry, NavState } from './store-types'
import type { BookmarkMeta, Category, CategoryMeta, MetadataSyncScope, Settings } from './types'

import {
  metadataSyncRecoveryRetentionMs,
  metadataSyncRecoveryStorageKey,
  pruneMetadataSyncRecovery,
  summarizeMetadataChanges,
} from './activity'
import {
  createFullBookmarkSnapshot,
  createMoorreadBackup,
  parseFullBookmarkSnapshot,
  parseMoorreadBackup,
} from './backup'
import { useBookmarkGroupsStore } from './bookmark-groups-store'
import { assertBookmarksApi, bookmarkApi } from './bookmark-repository'
import { normalizeAlternateBookmarkUrls } from './bookmark-urls'
import { findCategoryByPath } from './category-path'
import { isVirtualCategoryId } from './default-data'
import { reportDiagnostic } from './diagnostics'
import { localizedMessage } from './i18n'
import { LocalizedError, localizedErrorMessage } from './localized-error'
import {
  applyMaterializedBookmarkMetadata,
  clearMetadataSyncStorage,
  isMetadataSyncWriteQuotaError,
  synchronizeMetadata,
} from './metadata-sync'
import { mergeRestoredGistBackup } from './restore-settings'
import {
  applyCategoryMeta,
  applyMeta,
  countSnapshotNodes,
  DEFAULT_PARENT_ID,
  metadataAutoSyncDelayMs,
  restoreSnapshotNode,
  usagePersistence,
} from './store-helpers'
import {
  metaStorage,
  persist,
  settingsStorage,
  STORAGE_KEYS,
  updateBookmarkMetadata,
  updateCategoryMetadata,
  withBookmarkMetadataLock,
} from './store-persistence'
import { normalizeSettings } from './store-settings-state'

const METADATA_SYNC_QUOTA_BACKOFF_BASE_MS = 5 * 60_000
const METADATA_SYNC_QUOTA_BACKOFF_MAX_MS = 60 * 60_000

let metadataSyncTimer: ReturnType<typeof setTimeout> | undefined
let metadataSyncPromise: Promise<void> | undefined
let metadataSyncQuotaFailures = 0
let runScheduledMetadataSync: () => void = () => {}

export function scheduleMetadataSync(
  delayMs = metadataAutoSyncDelayMs,
  replaceExisting = false,
): void {
  if (metadataSyncTimer) {
    if (!replaceExisting)
      return
    clearTimeout(metadataSyncTimer)
  }
  metadataSyncTimer = setTimeout(() => {
    metadataSyncTimer = undefined
    runScheduledMetadataSync()
  }, delayMs)
}

export function setMetadataSyncRunner(runner: () => void): void {
  runScheduledMetadataSync = runner
}

const METADATA_SYNC_LOG_LIMIT = 20
const METADATA_RECOVERY_LIMIT = 20

async function resolveMetadataSyncPassphrase(
  settings: Settings,
): Promise<string | undefined> {
  if (!settings.metadataSyncEncryptionEnabled)
    return undefined
  const passphrase = (await metaStorage.get<string>(
    STORAGE_KEYS.metadataSyncPassphrase,
  ))?.trim()
  if (!passphrase)
    throw new LocalizedError('runtimeMetadataPassphraseRequired')
  return passphrase
}

interface DownloadedMetadataParts {
  meta: Record<string, BookmarkMeta>
  categoryMeta: Record<string, CategoryMeta>
  summary: MetadataChangeSummary
}

function buildDownloadedMetadata(
  previousMeta: Record<string, BookmarkMeta>,
  previousCategoryMeta: Record<string, CategoryMeta>,
  result: MetadataSyncResult,
  baselineMeta: Record<string, BookmarkMeta>,
  baselineCategoryMeta: Record<string, CategoryMeta>,
  categories: Category[],
  scope: MetadataSyncScope,
): DownloadedMetadataParts {
  const categoryMeta = scope.categoryIcons
    ? mergeDownloadedCategoryMeta(
        previousCategoryMeta,
        baselineCategoryMeta,
        result,
        categories,
      )
    : { ...previousCategoryMeta }

  const meta = applyMaterializedBookmarkMetadata(
    previousMeta,
    result.document.bookmarkMeta,
    scope,
    { baseline: baselineMeta, omittedUrls: result.omittedBookmarkUrls },
  )

  return {
    meta,
    categoryMeta,
    summary: summarizeMetadataChanges(
      previousMeta,
      meta,
      previousCategoryMeta,
      categoryMeta,
    ),
  }
}

function mergeDownloadedCategoryMeta(
  previousCategoryMeta: Record<string, CategoryMeta>,
  baselineCategoryMeta: Record<string, CategoryMeta>,
  result: MetadataSyncResult,
  categories: Category[],
): Record<string, CategoryMeta> {
  const categoryMeta: Record<string, CategoryMeta> = {}
  for (const item of result.document.categoryMeta) {
    const category = findCategoryByPath(item.path, categories)
    if (category)
      categoryMeta[category.id] = { emoji: item.emoji }
  }

  // 同步期間本機改過的分類圖示優先，避免遠端覆蓋使用者剛做的調整。
  for (const id of new Set([
    ...Object.keys(baselineCategoryMeta),
    ...Object.keys(previousCategoryMeta),
  ])) {
    if (previousCategoryMeta[id]?.emoji === baselineCategoryMeta[id]?.emoji)
      continue
    if (previousCategoryMeta[id])
      categoryMeta[id] = previousCategoryMeta[id]
    else
      delete categoryMeta[id]
  }
  return categoryMeta
}

function createRecoveryEntry(
  summary: MetadataChangeSummary,
  direction: MetadataSyncRecoveryEntry['direction'],
  previousMeta: Record<string, BookmarkMeta>,
  previousCategoryMeta: Record<string, CategoryMeta>,
): MetadataSyncRecoveryEntry {
  const createdAt = Date.now()
  return {
    id: crypto.randomUUID(),
    label: localizedMessage('runtimeMetadataRecoveryLabel', {
      bookmarks: summary.changedBookmarkCount,
      categories: summary.changedCategoryCount,
      removed: summary.removedFieldCount,
    }),
    createdAt,
    expiresAt: createdAt + metadataSyncRecoveryRetentionMs,
    direction,
    bookmarkMeta: structuredClone(previousMeta),
    categoryMeta: structuredClone(previousCategoryMeta),
    ...summary,
  }
}

async function applyDownloadedMetadataToStore(
  result: MetadataSyncResult,
  baselineMeta: Record<string, BookmarkMeta>,
  baselineCategoryMeta: Record<string, CategoryMeta>,
  get: () => NavState,
  set: (partial: Partial<NavState>) => void,
): Promise<number> {
  let totalChanges = 0
  await withBookmarkMetadataLock(async () => {
    const previousMeta
      = await metaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta)
        ?? get().meta
    const previousCategoryMeta
      = await metaStorage.get<Record<string, CategoryMeta>>(
        STORAGE_KEYS.categoryMeta,
      ) ?? get().categoryMeta
    const { meta, categoryMeta, summary } = buildDownloadedMetadata(
      previousMeta,
      previousCategoryMeta,
      result,
      baselineMeta,
      baselineCategoryMeta,
      get().categories,
      get().settings.metadataSyncScope,
    )
    totalChanges
      = summary.changedBookmarkCount + summary.changedCategoryCount

    let metadataSyncRecovery = get().metadataSyncRecovery
    if (totalChanges > 0) {
      const recoveryDirection = result.direction === 'merged' ? 'merged' : 'downloaded'
      metadataSyncRecovery = [
        createRecoveryEntry(
          summary,
          recoveryDirection,
          previousMeta,
          previousCategoryMeta,
        ),
        ...pruneMetadataSyncRecovery(metadataSyncRecovery),
      ].slice(0, METADATA_RECOVERY_LIMIT)
      // 先把復原點寫入儲存，遠端資料才會覆蓋本機內容。
      await metaStorage.set(metadataSyncRecoveryStorageKey, metadataSyncRecovery)
    }

    await Promise.all([
      metaStorage.set(STORAGE_KEYS.meta, meta),
      metaStorage.set(STORAGE_KEYS.categoryMeta, categoryMeta),
    ])
    set({
      meta,
      categoryMeta,
      metadataSyncRecovery,
      bookmarks: applyMeta(get().bookmarks, meta),
      categories: applyCategoryMeta(get().categories, categoryMeta),
    })
  })

  if (totalChanges > 0) {
    await get().recordActivity(
      'sync',
      localizedMessage('runtimeMetadataSyncUpdated', { count: totalChanges }),
    )
  }
  return totalChanges
}

function createSyncLogEntry(
  result: MetadataSyncResult,
): MetadataSyncLogEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    state: 'success',
    direction: result.direction,
    retryCount: result.retryCount,
    message: result.direction === 'merged'
      ? localizedMessage('runtimeMetadataSyncMerged')
      : localizedMessage('runtimeMetadataSyncComplete'),
  }
}

function computeMetadataSyncBackoffMs(failureCount: number): number {
  return Math.min(
    METADATA_SYNC_QUOTA_BACKOFF_BASE_MS * 2 ** (failureCount - 1),
    METADATA_SYNC_QUOTA_BACKOFF_MAX_MS,
  )
}

/**
 * 只採用備份檔實際提供的 settings 欄位：舊版備份沒有的欄位（例如 nativeBookmarkSort、
 * gistBackup）保持目前設定，不會被 parser 補上的預設值蓋掉。
 *
 * `gistBackup` 例外：備份檔中的憑證一律是淨化後的空字串，整包覆蓋會清空使用者
 * 目前有效的憑證，因此改由 `mergeRestoredGistBackup` 逐欄位合併。
 */
function importedSettingsPatch(
  backup: MoorreadBackup,
): Partial<Settings> {
  const provided = backup.presentSettings ?? Object.keys(backup.settings)
  const settings = backup.settings as unknown as Record<string, unknown>
  return Object.fromEntries(
    provided
      .filter(key => key !== 'gistBackup' && Object.hasOwn(settings, key))
      .map(key => [key, settings[key]]),
  ) as Partial<Settings>
}

/** 備份檔是否實際寫了 `gistBackup`（舊版備份沒有這個欄位）。 */
function backupProvidesGistSettings(backup: MoorreadBackup): boolean {
  const provided = backup.presentSettings ?? Object.keys(backup.settings)
  return provided.includes('gistBackup')
}

export const createBackupSlice: StateCreator<
  NavState,
  [],
  [],
  BackupSlice
> = (set, get) => ({
  metadataSyncStatus: { state: 'idle' },
  metadataSyncLog: [],
  metadataSyncPassphraseSet: false,
  metadataSyncRecovery: [],
  tasks: [],

  syncMetadataNow: () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync)
      return Promise.resolve()
    if (metadataSyncPromise)
      return metadataSyncPromise
    if (metadataSyncTimer) {
      clearTimeout(metadataSyncTimer)
      metadataSyncTimer = undefined
    }

    metadataSyncPromise = (async () => {
      get().beginTask({
        id: 'metadata-sync',
        type: 'metadata-sync',
        label: localizedMessage('runtimeMetadataSyncTask'),
      })
      set({ metadataSyncStatus: { state: 'syncing' } })
      try {
        const settingsAtSyncStart = get().settings
        const encryptionPassphrase = await resolveMetadataSyncPassphrase(
          settingsAtSyncStart,
        )
        const metadataAtSyncStart = get().meta
        const categoryMetadataAtSyncStart = get().categoryMeta
        const result = await synchronizeMetadata({
          meta: metadataAtSyncStart,
          categoryMeta: categoryMetadataAtSyncStart,
          categories: get().categories,
          scope: settingsAtSyncStart.metadataSyncScope,
          encryptionPassphrase,
        })
        if (result.direction === 'downloaded' || result.direction === 'merged') {
          await applyDownloadedMetadataToStore(
            result,
            metadataAtSyncStart,
            categoryMetadataAtSyncStart,
            get,
            set,
          )
        }
        metadataSyncQuotaFailures = 0
        const log = createSyncLogEntry(result)
        const metadataSyncLog = [log, ...get().metadataSyncLog]
          .slice(0, METADATA_SYNC_LOG_LIMIT)
        set({
          metadataSyncStatus: {
            state: 'success',
            direction: result.direction,
            syncedAt: result.syncedAt,
            byteCount: result.byteCount,
            omittedBookmarkCount: result.omittedBookmarkCount,
            retryCount: result.retryCount,
          },
          metadataSyncLog,
        })
        await metaStorage.set(STORAGE_KEYS.metadataSyncLog, metadataSyncLog)
        get().finishTask('metadata-sync', 'success', log.message)
      }
      catch (cause) {
        const quotaLimited = isMetadataSyncWriteQuotaError(cause)
        let message: LocalizedText = localizedErrorMessage(
          cause,
          'runtimeMetadataSyncFailed',
        )
        if (quotaLimited) {
          metadataSyncQuotaFailures += 1
          const backoffMs = computeMetadataSyncBackoffMs(metadataSyncQuotaFailures)
          scheduleMetadataSync(backoffMs, true)
          message = localizedMessage(
            'runtimeMetadataSyncPaused',
            {
              minutes: Math.ceil(backoffMs / 60_000),
            },
          )
        }
        const retryCount = quotaLimited ? 0 : 2
        const failureLog: MetadataSyncLogEntry = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          state: 'error',
          retryCount,
          message,
        }
        const metadataSyncLog = [failureLog, ...get().metadataSyncLog]
          .slice(0, METADATA_SYNC_LOG_LIMIT)
        set({
          metadataSyncStatus: { state: 'error', retryCount, error: message },
          metadataSyncLog,
        })
        await metaStorage.set(STORAGE_KEYS.metadataSyncLog, metadataSyncLog)
        get().finishTask('metadata-sync', 'error', message)
        reportDiagnostic('metadata-sync.failed', cause)
      }
    })().finally(() => {
      metadataSyncPromise = undefined
    })

    return metadataSyncPromise
  },

  restoreMetadataSyncRecovery: async (id) => {
    const recovery = get().metadataSyncRecovery.find(item => item.id === id)
    if (!recovery)
      return false
    await withBookmarkMetadataLock(async () => {
      const meta = structuredClone(recovery.bookmarkMeta)
      const categoryMeta = structuredClone(recovery.categoryMeta)
      await Promise.all([
        persist(metaStorage, STORAGE_KEYS.meta, meta),
        persist(metaStorage, STORAGE_KEYS.categoryMeta, categoryMeta),
      ])
      const metadataSyncRecovery = get().metadataSyncRecovery.filter(item => item.id !== id)
      await metaStorage.set(metadataSyncRecoveryStorageKey, metadataSyncRecovery)
      set({
        meta,
        categoryMeta,
        metadataSyncRecovery,
        bookmarks: applyMeta(get().bookmarks, meta),
        categories: applyCategoryMeta(get().categories, categoryMeta),
      })
    })
    await get().recordActivity(
      'restore',
      localizedMessage('runtimeMetadataRestoreActivity'),
    )
    return true
  },

  removeMetadataSyncRecovery: async (id) => {
    const metadataSyncRecovery = get().metadataSyncRecovery.filter(item => item.id !== id)
    set({ metadataSyncRecovery })
    await metaStorage.set(metadataSyncRecoveryStorageKey, metadataSyncRecovery)
  },

  clearMetadataSyncRecovery: async () => {
    set({ metadataSyncRecovery: [] })
    await metaStorage.set(metadataSyncRecoveryStorageKey, [])
  },

  clearSupplementaryMetadata: async () => {
    await withBookmarkMetadataLock(async () => {
      await Promise.all([
        metaStorage.set(STORAGE_KEYS.meta, {}),
        metaStorage.set(STORAGE_KEYS.categoryMeta, {}),
        metaStorage.set(metadataSyncRecoveryStorageKey, []),
        clearMetadataSyncStorage(),
      ])
      set({ meta: {}, categoryMeta: {}, metadataSyncRecovery: [] })
    })
    await get().loadBookmarks()
  },

  beginTask: (task) => {
    const next = {
      ...task,
      state: 'running' as const,
      completed: 0,
      startedAt: Date.now(),
    }
    const tasks = [next, ...get().tasks.filter(item => item.id !== task.id)].slice(0, 50)
    set({ tasks })
    void metaStorage.set(STORAGE_KEYS.tasks, tasks)
  },

  updateTask: (id, patch) => {
    const tasks = get().tasks.map(task => task.id === id ? { ...task, ...patch } : task)
    set({ tasks })
    void metaStorage.set(STORAGE_KEYS.tasks, tasks)
  },

  finishTask: (id, state, message) => {
    const tasks = get().tasks.map(task => task.id === id
      ? {
          ...task,
          state,
          completed: state === 'success' ? (task.total ?? task.completed) : task.completed,
          message,
          finishedAt: Date.now(),
        }
      : task)
    set({ tasks })
    void metaStorage.set(STORAGE_KEYS.tasks, tasks)
  },

  clearFinishedTasks: () => {
    const tasks = get().tasks.filter(task => task.state === 'running')
    set({ tasks })
    void metaStorage.set(STORAGE_KEYS.tasks, tasks)
  },

  exportBackup: () =>
    JSON.stringify(
      createMoorreadBackup({
        settings: get().settings,
        meta: get().meta,
        categoryMeta: get().categoryMeta,
        usage: get().usage,
        categories: get().categories,
        bookmarkGroups: useBookmarkGroupsStore.getState().groups,
      }),
      null,
      2,
    ),

  importBackup: async (raw, strategy = 'merge') => {
    const backup = parseMoorreadBackup(raw)
    await useBookmarkGroupsStore.getState().restore(backup.bookmarkGroups ?? [], strategy)
    const meta = await updateBookmarkMetadata((latest) => {
      const meta = { ...latest }
      for (const [url, importedMeta] of Object.entries(backup.bookmarkMeta)) {
        const existing = meta[url]
        if (existing && strategy === 'skip')
          continue
        const normalizedImported = {
          ...importedMeta,
          alternateUrls: normalizeAlternateBookmarkUrls(
            importedMeta.alternateUrls ?? [],
            url,
          ),
          tags: importedMeta.tags?.flatMap((tag) => {
            const normalized = tag.trim()
            return normalized ? [normalized] : []
          }),
        }
        meta[url] = existing && strategy === 'merge'
          ? {
              ...normalizedImported,
              ...existing,
              tags: [...new Set([...(existing.tags ?? []), ...(normalizedImported.tags ?? [])])],
            }
          : normalizedImported
        if (!meta[url].alternateUrls?.length) {
          meta[url].alternateUrls = undefined
        }
        if (!meta[url].tags?.length) {
          meta[url].tags = undefined
        }
      }
      return meta
    }, () => get().meta)
    const importedCategoryMeta: Record<string, CategoryMeta> = {}
    let restoredCategoryMetaCount = 0
    for (const item of backup.categoryMeta) {
      const category = findCategoryByPath(item.path, get().categories)
      if (!category)
        continue
      importedCategoryMeta[category.id] = { emoji: item.emoji }
      restoredCategoryMetaCount += 1
    }
    const defaultCategory = findCategoryByPath(
      backup.defaultCategoryPath,
      get().categories,
    )
    const importedSettings = importedSettingsPatch(backup)
    delete importedSettings.defaultCategoryId
    const settings = normalizeSettings({
      ...get().settings,
      ...importedSettings,
      gistBackup: mergeRestoredGistBackup(
        get().settings.gistBackup,
        backupProvidesGistSettings(backup) ? backup.settings.gistBackup : undefined,
        backup.gistBackupCleared ?? [],
      ),
      ...(Object.hasOwn(backup.settings, 'defaultCategoryId')
        ? {
            defaultCategoryId:
              defaultCategory?.id
              ?? (isVirtualCategoryId(backup.settings.defaultCategoryId)
                ? backup.settings.defaultCategoryId
                : 'all'),
          }
        : {}),
    })

    const categoryMeta = await updateCategoryMetadata(
      latest => ({ ...latest, ...importedCategoryMeta }),
      () => get().categoryMeta,
    )
    set({ meta, categoryMeta, settings })
    await Promise.all([
      usagePersistence.update(latest => ({ ...latest, ...backup.usage })),
      persist(settingsStorage, STORAGE_KEYS.settings, settings),
    ])
    await get().loadBookmarks()
    return {
      bookmarkMetaCount: Object.keys(backup.bookmarkMeta).length,
      categoryMetaCount: restoredCategoryMetaCount,
      usageCount: Object.keys(backup.usage).length,
    }
  },

  exportFullBackup: async () => {
    assertBookmarksApi()
    const [tree] = await bookmarkApi.getTree()
    return JSON.stringify(
      createFullBookmarkSnapshot({
        moorread: createMoorreadBackup({
          settings: get().settings,
          meta: get().meta,
          categoryMeta: get().categoryMeta,
          usage: get().usage,
          categories: get().categories,
          bookmarkGroups: useBookmarkGroupsStore.getState().groups,
        }),
        nativeRoots: tree.children ?? [],
      }),
      null,
      2,
    )
  },

  restoreFullBackup: async (raw, onProgress) => {
    assertBookmarksApi()
    const snapshot = parseFullBookmarkSnapshot(raw)
    const restoredFolderName = `Moorread Restore ${new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ')}`
    const root = await bookmarkApi.create({
      parentId: DEFAULT_PARENT_ID,
      title: restoredFolderName,
    })
    const categoryIdByPath = new Map<string, string>()
    let restoredNodeCount = 1
    const totalNodeCount = countSnapshotNodes(snapshot.roots)
    onProgress?.(1, totalNodeCount)
    try {
      for (const node of snapshot.roots) {
        // Root creation order must match the exported bookmark snapshot.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        restoredNodeCount += await restoreSnapshotNode(
          node,
          root.id,
          [],
          categoryIdByPath,
          () => onProgress?.(restoredNodeCount, totalNodeCount),
        )
      }
    }
    catch (error) {
      // A half-built restore folder is worse than none; drop it so nobody has to clean up by hand.
      await bookmarkApi.removeTree(root.id).catch(() => undefined)
      throw error
    }

    const restoredCategoryMeta: Record<string, CategoryMeta> = {}
    let restoredCategoryMetaCount = 0
    for (const item of snapshot.moorread.categoryMeta) {
      const restoredId = categoryIdByPath.get(JSON.stringify(item.path))
      if (!restoredId)
        continue
      restoredCategoryMeta[restoredId] = { emoji: item.emoji }
      restoredCategoryMetaCount += 1
    }

    const restoredDefaultCategoryId = categoryIdByPath.get(
      JSON.stringify(snapshot.moorread.defaultCategoryPath ?? []),
    )
    const importedGroups = snapshot.moorread.bookmarkGroups ?? []
    const settingsProvided = snapshot.moorread.presentSettings
      ?? Object.keys(snapshot.moorread.settings)
    const previous = {
      settings: get().settings,
      meta: get().meta,
      categoryMeta: get().categoryMeta,
      usage: get().usage,
      groups: useBookmarkGroupsStore.getState().groups,
    }
    try {
      const meta = await updateBookmarkMetadata((latest) => {
        const meta = { ...latest }
        for (const [url, importedMeta] of Object.entries(
          snapshot.moorread.bookmarkMeta,
        )) {
          meta[url] = {
            ...importedMeta,
            alternateUrls: normalizeAlternateBookmarkUrls(
              importedMeta.alternateUrls ?? [],
              url,
            ),
            tags: importedMeta.tags?.flatMap((tag) => {
              const normalized = tag.trim()
              return normalized ? [normalized] : []
            }),
          }
          if (!meta[url].alternateUrls?.length) {
            meta[url].alternateUrls = undefined
          }
          if (!meta[url].tags?.length) {
            meta[url].tags = undefined
          }
        }
        return meta
      }, () => get().meta)
      // 舊版備份沒有 bookmarkGroups 欄位時保留目前分組；明確提供（含空陣列）才依原語義還原。
      if (snapshot.moorread.bookmarkGroupsProvided)
        await useBookmarkGroupsStore.getState().restore(importedGroups, 'replace')
      const importedSettings = importedSettingsPatch(snapshot.moorread)
      delete importedSettings.defaultCategoryId
      const settings = normalizeSettings({
        ...previous.settings,
        ...importedSettings,
        gistBackup: mergeRestoredGistBackup(
          previous.settings.gistBackup,
          settingsProvided.includes('gistBackup')
            ? snapshot.moorread.settings.gistBackup
            : undefined,
          snapshot.moorread.gistBackupCleared ?? [],
        ),
        ...(settingsProvided.includes('defaultCategoryId')
          ? {
              defaultCategoryId:
                restoredDefaultCategoryId
                ?? (isVirtualCategoryId(snapshot.moorread.settings.defaultCategoryId)
                  ? snapshot.moorread.settings.defaultCategoryId
                  : 'all'),
            }
          : {}),
      })
      const categoryMeta = await updateCategoryMetadata(
        latest => ({ ...latest, ...restoredCategoryMeta }),
        () => get().categoryMeta,
      )
      set({ meta, categoryMeta, settings })
      await Promise.all([
        usagePersistence.update(latest => ({ ...latest, ...snapshot.moorread.usage })),
        persist(settingsStorage, STORAGE_KEYS.settings, settings),
      ])
      await get().loadBookmarks()
      return {
        restoredFolderName,
        restoredNodeCount,
        bookmarkMetaCount: Object.keys(snapshot.moorread.bookmarkMeta).length,
        categoryMetaCount: restoredCategoryMetaCount,
        usageCount: Object.keys(snapshot.moorread.usage).length,
      }
    }
    catch (error) {
      // 還原是一次性大量寫入；任何一步失敗都要連同已建立的資料夾一起退回，不留下半套資料。
      await bookmarkApi.removeTree(root.id).catch(() => undefined)
      const previousGroupIds = new Set(previous.groups.map(group => group.id))
      for (const group of importedGroups) {
        if (!previousGroupIds.has(group.id))
          await useBookmarkGroupsStore.getState().remove(group.id).catch(() => undefined)
      }
      await useBookmarkGroupsStore.getState().restore(previous.groups, 'replace').catch(() => undefined)
      await updateBookmarkMetadata(() => previous.meta, () => get().meta).catch(() => undefined)
      await updateCategoryMetadata(() => previous.categoryMeta, () => get().categoryMeta).catch(() => undefined)
      await usagePersistence.update(() => previous.usage).catch(() => undefined)
      set({
        meta: previous.meta,
        categoryMeta: previous.categoryMeta,
        settings: previous.settings,
      })
      await persist(settingsStorage, STORAGE_KEYS.settings, previous.settings).catch(() => undefined)
      throw error
    }
  },
})
