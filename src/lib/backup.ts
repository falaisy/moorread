import type { BookmarkGroup } from './bookmark-groups'
import type {
  BookmarkMeta,
  BookmarkUsage,
  Category,
  CategoryMeta,
  Settings,
} from './types'
import { normalizeAppearanceSettings } from './appearance'
import { normalizeAutoOrganizeRules } from './auto-organize'
import { parseBookmarkGroup } from './bookmark-groups'
import { getCategoryPath } from './category-path'
import { getBrowserLanguage, isLanguage } from './i18n'
import { normalizeKeyboardShortcuts } from './keyboard-shortcuts'
import { normalizeMetadataSyncScope } from './metadata-sync'
import { normalizeCustomSearchEngines } from './search-engines'
import { normalizeHeaderWidget } from './weather'

const BACKUP_SCHEMA_VERSION = 1
const FULL_SNAPSHOT_KIND = 'moorread-full-bookmark-snapshot'
// 0.1.5／0.1.6（改名前的 yunji-tab）寫出的完整快照。外殼鍵是 `yunjiTab`，內容與現行 `moorread` 同構。
const LEGACY_FULL_SNAPSHOT_KIND = 'yunji-tab-full-bookmark-snapshot'
const LEGACY_FULL_SNAPSHOT_KEY = 'yunjiTab'

interface CategoryMetaBackup {
  path: string[]
  emoji: string
}

export interface MoorreadBackup {
  schemaVersion: 1
  exportedAt: string
  settings: Settings
  defaultCategoryPath?: string[]
  bookmarkMeta: Record<string, BookmarkMeta>
  bookmarkGroups?: BookmarkGroup[]
  categoryMeta: CategoryMetaBackup[]
  usage: Record<string, BookmarkUsage>
  /**
   * 解析結果專用，不會寫進備份檔。記錄備份檔實際提供的 settings 欄位，
   * 讓還原能區分「這個版本根本沒有此欄位」與「明確存了預設值」。
   */
  presentSettings?: string[]
  /** 解析結果專用：備份檔是否明確提供 `bookmarkGroups`（含明確空陣列）。 */
  bookmarkGroupsProvided?: boolean
  /**
   * 解析結果專用：備份檔以 `null` 明確要求清除的 Gist 憑證欄位。
   * 匯出永遠寫空字串；`null` 只可能來自使用者明確要求清除的備份。
   */
  gistBackupCleared?: Array<'token' | 'passphrase' | 'gistId'>
}

export interface NativeBookmarkSnapshotNode {
  title: string
  url?: string
  children?: NativeBookmarkSnapshotNode[]
}

export interface FullBookmarkSnapshot {
  kind: typeof FULL_SNAPSHOT_KIND
  schemaVersion: 1
  exportedAt: string
  moorread: MoorreadBackup
  roots: NativeBookmarkSnapshotNode[]
  /** 由舊版 `yunji-tab` 快照轉換而來；UI 據此顯示「舊版備份」並要求二次確認。 */
  legacy?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 從 Settings 中移除不應進入備份的敏感欄位。
 * 這是唯一的淨化點；所有備份路徑（匯出、Gist 上傳、WebDAV）都經過 createMoorreadBackup。
 */
function sanitizeBackupSettings(settings: Settings): Settings {
  return {
    ...settings,
    gistBackup: {
      ...settings.gistBackup,
      token: '',
      passphrase: '',
    },
  }
}

export function createMoorreadBackup(input: {
  settings: Settings
  meta: Record<string, BookmarkMeta>
  bookmarkGroups?: BookmarkGroup[]
  categoryMeta: Record<string, CategoryMeta>
  usage: Record<string, BookmarkUsage>
  categories: Category[]
}): MoorreadBackup {
  const categoryMeta = Object.entries(input.categoryMeta).flatMap(
    ([categoryId, meta]) => {
      const path = getCategoryPath(categoryId, input.categories)
      return path && meta.emoji ? [{ path, emoji: meta.emoji }] : []
    },
  )

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: sanitizeBackupSettings(input.settings),
    defaultCategoryPath: getCategoryPath(
      input.settings.defaultCategoryId,
      input.categories,
    ),
    bookmarkMeta: input.meta,
    bookmarkGroups: input.bookmarkGroups ?? [],
    categoryMeta,
    usage: input.usage,
  }
}

function toNativeSnapshotNode(
  node: chrome.bookmarks.BookmarkTreeNode,
): NativeBookmarkSnapshotNode {
  return {
    title: node.title,
    url: node.url,
    children: node.children?.map(toNativeSnapshotNode),
  }
}

function parseNativeSnapshotNode(
  value: unknown,
): NativeBookmarkSnapshotNode | undefined {
  if (!isRecord(value) || typeof value.title !== 'string') {
    return undefined
  }

  const children = Array.isArray(value.children)
    ? value.children.flatMap((child) => {
        const parsed = parseNativeSnapshotNode(child)
        return parsed ? [parsed] : []
      })
    : undefined

  return {
    title: value.title,
    url: typeof value.url === 'string' ? value.url : undefined,
    children,
  }
}

export function createFullBookmarkSnapshot(input: {
  moorread: MoorreadBackup
  nativeRoots: chrome.bookmarks.BookmarkTreeNode[]
}): FullBookmarkSnapshot {
  return {
    kind: FULL_SNAPSHOT_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    moorread: input.moorread,
    roots: input.nativeRoots.map(toNativeSnapshotNode),
  }
}

export function parseMoorreadBackup(raw: string): MoorreadBackup {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch {
    throw new Error('backup.invalid_json')
  }
  if (!isRecord(value) || value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('backup.unsupported_version')
  }
  if (
    !isRecord(value.settings)
    || !isRecord(value.bookmarkMeta)
    || !Array.isArray(value.categoryMeta)
    || !isRecord(value.usage)
  ) {
    throw new Error('backup.missing_data')
  }
  // 缺欄位（舊版備份）可以接受，但型別錯誤代表資料損壞，不可當成空陣列處理。
  if (Object.hasOwn(value, 'bookmarkGroups') && !Array.isArray(value.bookmarkGroups))
    throw new Error('backup.missing_data')

  const bookmarkMeta: Record<string, BookmarkMeta> = {}
  for (const [url, candidate] of Object.entries(value.bookmarkMeta)) {
    if (!isRecord(candidate) || url === '__proto__')
      continue
    bookmarkMeta[url] = {
      description:
        typeof candidate.description === 'string'
          ? candidate.description
          : undefined,
      icon: typeof candidate.icon === 'string' ? candidate.icon : undefined,
      alternateUrls: Array.isArray(candidate.alternateUrls)
        ? candidate.alternateUrls.filter(
            (url): url is string => typeof url === 'string',
          )
        : undefined,
      pinnedAt:
        typeof candidate.pinnedAt === 'number' && candidate.pinnedAt > 0
          ? candidate.pinnedAt
          : undefined,
      pinnedOrder: typeof candidate.pinnedOrder === 'number' && Number.isFinite(candidate.pinnedOrder)
        ? candidate.pinnedOrder
        : undefined,
      tags: Array.isArray(candidate.tags)
        ? candidate.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined,
      inboxAt:
        typeof candidate.inboxAt === 'number' && candidate.inboxAt > 0
          ? candidate.inboxAt
          : undefined,
    }
  }

  const usage: Record<string, BookmarkUsage> = {}
  for (const [url, candidate] of Object.entries(value.usage)) {
    if (
      !isRecord(candidate)
      || typeof candidate.openCount !== 'number'
      || typeof candidate.lastOpenedAt !== 'number'
      || url === '__proto__'
    ) {
      continue
    }
    usage[url] = {
      openCount: Math.max(0, Math.floor(candidate.openCount)),
      lastOpenedAt: Math.max(0, candidate.lastOpenedAt),
    }
  }

  const categoryMeta = value.categoryMeta.flatMap((candidate) => {
    if (
      !isRecord(candidate)
      || !Array.isArray(candidate.path)
      || !candidate.path.every(part => typeof part === 'string')
      || typeof candidate.emoji !== 'string'
    ) {
      return []
    }
    return [{ path: candidate.path as string[], emoji: candidate.emoji }]
  })

  const settings = value.settings
  const rawGistBackup = isRecord(settings.gistBackup) ? settings.gistBackup : undefined
  const gistBackupCleared = rawGistBackup
    ? (['token', 'passphrase', 'gistId'] as const).filter(
        key => Object.hasOwn(rawGistBackup, key) && rawGistBackup[key] === null,
      )
    : []
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    settings: {
      headerWidget: normalizeHeaderWidget(isRecord(settings.headerWidget) ? settings.headerWidget : undefined),
      bookmarkGroupsEnabled: settings.bookmarkGroupsEnabled !== false,
      language: isLanguage(settings.language)
        ? settings.language
        : getBrowserLanguage(),
      theme:
        settings.theme === 'light'
        || settings.theme === 'dark'
        || settings.theme === 'system'
          ? settings.theme
          : 'system',
      defaultCategoryId:
        typeof settings.defaultCategoryId === 'string'
          ? settings.defaultCategoryId
          : 'all',
      singleHomeTab: settings.singleHomeTab === true,
      globalCommandPaletteEnabled:
        settings.globalCommandPaletteEnabled === true,
      descriptionIgnoredDomains: Array.isArray(
        settings.descriptionIgnoredDomains,
      )
        ? settings.descriptionIgnoredDomains.filter(
            (domain): domain is string => typeof domain === 'string',
          )
        : [],
      customSearchEngines: normalizeCustomSearchEngines(
        settings.customSearchEngines,
      ),
      onboardingDismissed:
        typeof settings.onboardingDismissed === 'boolean'
          ? settings.onboardingDismissed
          : undefined,
      bookmarkSortMode:
        settings.bookmarkSortMode === 'name'
        || settings.bookmarkSortMode === 'recentlyAdded'
        || settings.bookmarkSortMode === 'frequent'
          ? settings.bookmarkSortMode
          : 'manual',
      bookmarkViewMode:
        settings.bookmarkViewMode === 'compact' ? 'compact' : 'grid',
      appearance: normalizeAppearanceSettings(
        isRecord(settings.appearance) ? settings.appearance : undefined,
      ),
      savedSearches: Array.isArray(settings.savedSearches)
        ? settings.savedSearches.flatMap((item) => {
            if (!isRecord(item) || typeof item.id !== 'string'
              || typeof item.name !== 'string' || typeof item.query !== 'string') {
              return []
            }
            return [{ id: item.id, name: item.name, query: item.query }]
          }).slice(0, 20)
        : [],
      metadataSyncScope: normalizeMetadataSyncScope(
        isRecord(settings.metadataSyncScope)
          ? settings.metadataSyncScope
          : undefined,
      ),
      metadataSyncEncryptionEnabled: settings.metadataSyncEncryptionEnabled === true,
      autoOrganizeRules: normalizeAutoOrganizeRules(settings.autoOrganizeRules),
      autoOrganizeOnSave: settings.autoOrganizeOnSave !== false,
      keyboardShortcuts: normalizeKeyboardShortcuts(settings.keyboardShortcuts),
      gistBackup: (() => {
        const raw = isRecord(settings.gistBackup) ? settings.gistBackup : undefined
        return {
          token: typeof raw?.token === 'string' ? raw.token : '',
          gistId: typeof raw?.gistId === 'string' ? raw.gistId : '',
          encrypt: raw?.encrypt === true,
          passphrase: typeof raw?.passphrase === 'string' ? raw.passphrase : '',
        }
      })(),
    },
    defaultCategoryPath: Array.isArray(value.defaultCategoryPath)
      ? value.defaultCategoryPath.filter(
          (part): part is string => typeof part === 'string',
        )
      : undefined,
    bookmarkMeta,
    bookmarkGroups: Array.isArray(value.bookmarkGroups)
      ? value.bookmarkGroups.flatMap((item) => {
          const group = parseBookmarkGroup(item)
          return group ? [group] : []
        })
      : [],
    categoryMeta,
    usage,
    presentSettings: Object.keys(settings),
    bookmarkGroupsProvided: Object.hasOwn(value, 'bookmarkGroups'),
    ...(gistBackupCleared.length ? { gistBackupCleared } : {}),
  }
}

export function parseFullBookmarkSnapshot(raw: string): FullBookmarkSnapshot {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch {
    throw new Error('snapshot.invalid_json')
  }

  // 舊格式 adapter：只在共用解析層辨識已確認的 `yunji-tab` 外殼，轉成現行格式後
  // 仍走下面同一套嚴格驗證。未知 kind 一律拒絕，不靠 schemaVersion 猜新舊。
  const legacy = isRecord(value) && value.kind === LEGACY_FULL_SNAPSHOT_KIND
  if (legacy)
    value = convertLegacyFullSnapshot(value as Record<string, unknown>)

  if (
    !isRecord(value)
    || value.kind !== FULL_SNAPSHOT_KIND
    || value.schemaVersion !== BACKUP_SCHEMA_VERSION
    || !isRecord(value.moorread)
    || !Array.isArray(value.roots)
  ) {
    throw new Error('snapshot.unsupported_version')
  }

  const roots = value.roots.flatMap((root) => {
    const parsed = parseNativeSnapshotNode(root)
    return parsed ? [parsed] : []
  })

  return {
    kind: FULL_SNAPSHOT_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    moorread: parseMoorreadBackup(JSON.stringify(value.moorread)),
    roots,
    ...(legacy ? { legacy: true } : {}),
  }
}

/**
 * 把 0.1.5／0.1.6 的 `yunji-tab` 完整快照轉成現行外殼。
 * 只搬移已由 Git 歷史確認的欄位；缺少 `yunjiTab` 或 `roots` 代表快照不完整，直接拒絕。
 */
function convertLegacyFullSnapshot(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (
    value.schemaVersion !== BACKUP_SCHEMA_VERSION
    || !isRecord(value[LEGACY_FULL_SNAPSHOT_KEY])
    || !Array.isArray(value.roots)
  ) {
    throw new Error('snapshot.unsupported_version')
  }
  return {
    kind: FULL_SNAPSHOT_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    moorread: value[LEGACY_FULL_SNAPSHOT_KEY],
    roots: value.roots,
  }
}
