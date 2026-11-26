import type { NativeFolderRule, NativeSortMode, NativeSortScope } from './sort-types'
import type {
  AppearanceSettings,
  AutoOrganizeRule,
  BookmarkSortMode,
  BookmarkViewMode,
  CardFieldSettings,
  Category,
  Language,
  MetadataSyncScope,
  NavItemSettings,
  SavedSearch,
  SearchEngine,
  Settings,
  ShortcutAction,
  ThemeMode,
} from './types'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
} from './appearance'
import { normalizeAutoOrganizeRules } from './auto-organize'
import {
  DEFAULT_SORT_CRITERIA,
  deriveScopeFromLegacy,
  normalizeSortCriteria,
  normalizeSortRule,
} from './bookmark-native-sort'
import { isVirtualCategoryId } from './default-data'
import { normalizeIgnoredDomains } from './description-sync'
import { getBrowserLanguage, isLanguage } from './i18n'
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  normalizeKeyboardShortcuts,
} from './keyboard-shortcuts'
import { normalizeMetadataSyncScope } from './metadata-sync'
import { normalizeCustomSearchEngines } from './search-engines'
import { DEFAULT_HEADER_WIDGET, normalizeHeaderWidget } from './weather'

export type AppearanceSettingsPatch = Partial<
  Omit<AppearanceSettings, 'cardFields' | 'navItems'>
> & {
  cardFields?: Partial<CardFieldSettings>
  navItems?: Partial<NavItemSettings>
}

export interface SettingsSlice {
  setHeaderWidget: (patch: Partial<Settings['headerWidget']>) => Promise<void>
  resetGeneralSettings: () => Promise<void>
  resetAppearanceSettings: () => Promise<void>
  setBookmarkGroupsEnabled: (enabled: boolean) => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  addCustomSearchEngine: (engine: Omit<SearchEngine, 'id'>) => Promise<void>
  updateCustomSearchEngine: (
    id: string,
    engine: Omit<SearchEngine, 'id'>,
  ) => Promise<void>
  removeCustomSearchEngine: (id: string) => Promise<void>
  setTheme: (theme: ThemeMode) => Promise<void>
  setDefaultCategory: (id: string) => Promise<void>
  setSingleHomeTab: (enabled: boolean) => Promise<void>
  setGlobalCommandPaletteEnabled: (enabled: boolean) => Promise<void>
  applyDefaultCategory: () => void
  setDescriptionIgnoredDomains: (domains: string[]) => Promise<void>
  setOnboardingDismissed: (dismissed: boolean) => Promise<void>
  setBookmarkSortMode: (mode: BookmarkSortMode) => Promise<void>
  setBookmarkViewMode: (mode: BookmarkViewMode) => Promise<void>
  setAppearance: (patch: AppearanceSettingsPatch) => Promise<void>
  setKeyboardShortcut: (
    action: ShortcutAction,
    shortcut: Settings['keyboardShortcuts'][ShortcutAction],
  ) => Promise<void>
  resetKeyboardShortcuts: () => Promise<void>
  addSavedSearch: (query: string) => Promise<void>
  removeSavedSearch: (id: string) => Promise<void>
  addAutoOrganizeRule: (rule: Omit<AutoOrganizeRule, 'id'>) => Promise<void>
  updateAutoOrganizeRule: (
    id: string,
    patch: Partial<Omit<AutoOrganizeRule, 'id'>>,
  ) => Promise<void>
  removeAutoOrganizeRule: (id: string) => Promise<void>
  runAutoOrganizeRules: () => Promise<number>
  setAutoOrganizeOnSave: (enabled: boolean) => Promise<void>
  setMetadataSyncScope: (scope: Partial<MetadataSyncScope>) => Promise<void>
  setMetadataSyncEncryption: (
    enabled: boolean,
    passphrase?: string,
  ) => Promise<void>
  setNativeBookmarkSort: (
    patch: Partial<Settings['nativeBookmarkSort']>,
  ) => Promise<void>
  setGistBackup: (
    patch: Partial<Settings['gistBackup']>,
  ) => Promise<void>
}

export const DEFAULT_SETTINGS: Settings = {
  headerWidget: DEFAULT_HEADER_WIDGET,
  bookmarkGroupsEnabled: true,
  language: getBrowserLanguage(),
  theme: 'system',
  defaultCategoryId: 'all',
  singleHomeTab: false,
  globalCommandPaletteEnabled: false,
  descriptionIgnoredDomains: [],
  customSearchEngines: [],
  onboardingDismissed: false,
  bookmarkSortMode: 'manual',
  bookmarkViewMode: 'grid',
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  savedSearches: [],
  metadataSyncScope: normalizeMetadataSyncScope(),
  metadataSyncEncryptionEnabled: false,
  autoOrganizeRules: [],
  autoOrganizeOnSave: true,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  nativeBookmarkSort: {
    enabled: false,
    autoSort: false,
    sortCriteria: [...DEFAULT_SORT_CRITERIA],
    sortMode: 'criteria',
    scope: 'all',
    sortSelf: true,
    targetFolderIds: [],
    ignoreFolderIds: [],
    foldersFirst: true,
  },
  gistBackup: {
    token: '',
    gistId: '',
    encrypt: false,
    passphrase: '',
  },
}

export function resolveAvailableCategoryId(
  categoryId: string | undefined,
  categories: Category[],
): string {
  if (!categoryId)
    return 'all'
  if (isVirtualCategoryId(categoryId))
    return categoryId
  return categories.some(category => category.id === categoryId)
    ? categoryId
    : 'all'
}

export function normalizeSettings(settings?: Partial<Settings>): Settings {
  const customSearchEngines = normalizeCustomSearchEngines(
    settings?.customSearchEngines,
  )
  return {
    headerWidget: normalizeHeaderWidget(settings?.headerWidget),
    bookmarkGroupsEnabled: settings?.bookmarkGroupsEnabled !== false,
    language: isLanguage(settings?.language)
      ? settings.language
      : DEFAULT_SETTINGS.language,
    theme:
      settings?.theme === 'light'
      || settings?.theme === 'dark'
      || settings?.theme === 'system'
        ? settings.theme
        : DEFAULT_SETTINGS.theme,
    defaultCategoryId:
      (() => {
        const raw = settings?.defaultCategoryId
        if (typeof raw !== 'string' || !raw.trim())
          return DEFAULT_SETTINGS.defaultCategoryId
        // Migrate legacy raw native ids: "5" → "cat-5" (bookmark-tree.ts uses cat-{nativeId})
        if (/^\d+$/.test(raw) && !raw.startsWith('cat-'))
          return `cat-${raw}`
        return raw
      })(),
    singleHomeTab: settings?.singleHomeTab === true,
    globalCommandPaletteEnabled:
      settings?.globalCommandPaletteEnabled === true,
    descriptionIgnoredDomains: normalizeIgnoredDomains(
      settings?.descriptionIgnoredDomains ?? [],
    ),
    customSearchEngines,
    onboardingDismissed: settings?.onboardingDismissed === true,
    bookmarkSortMode:
      settings?.bookmarkSortMode === 'name'
      || settings?.bookmarkSortMode === 'recentlyAdded'
      || settings?.bookmarkSortMode === 'frequent'
        ? settings.bookmarkSortMode
        : 'manual',
    bookmarkViewMode:
      settings?.bookmarkViewMode === 'compact' ? 'compact' : 'grid',
    appearance: normalizeAppearanceSettings(settings?.appearance),
    savedSearches: Array.isArray(settings?.savedSearches)
      ? settings.savedSearches
          .filter(
            (item): item is SavedSearch =>
              typeof item?.id === 'string'
              && typeof item.name === 'string'
              && typeof item.query === 'string'
              && Boolean(item.query.trim()),
          )
          .slice(0, 20)
      : [],
    metadataSyncScope: normalizeMetadataSyncScope(settings?.metadataSyncScope),
    metadataSyncEncryptionEnabled:
      settings?.metadataSyncEncryptionEnabled === true,
    autoOrganizeRules: normalizeAutoOrganizeRules(settings?.autoOrganizeRules),
    autoOrganizeOnSave: settings?.autoOrganizeOnSave !== false,
    keyboardShortcuts: normalizeKeyboardShortcuts(settings?.keyboardShortcuts),
    nativeBookmarkSort: (() => {
      const raw = settings?.nativeBookmarkSort
      // 舊設定 fallback：從 storage 讀到的可能是舊格式（field + direction），
      // 轉成新格式（sortCriteria）；新格式直接用
      const rawUnknown = raw as unknown
      let criteria: unknown = raw?.sortCriteria
      if (criteria == null && rawUnknown != null && typeof rawUnknown === 'object') {
        const obj = rawUnknown as Record<string, unknown>
        const field = obj.field
        const direction = obj.direction
        if (typeof field === 'string' && typeof direction === 'string') {
          criteria = [{ field, direction }]
        }
      }

      const sortSelf = raw?.sortSelf !== false

      // scope 遷移：新設直接用（四選一），舊設從 targetMode + includeSubfolders 推導。
      // 推導只縮小、不擴大範圍：selected + includeSubfolders=false → selected-only。
      const validScopes = new Set<NativeSortScope>(['all', 'selected-only', 'selected-with-sub', 'children-only'])
      let scope: NativeSortScope
      if (raw?.scope && validScopes.has(raw.scope as NativeSortScope)) {
        scope = raw.scope as NativeSortScope
      }
      else {
        const legacyMode = raw?.targetMode === 'selected' ? 'selected' : 'all'
        const legacySubs = raw?.includeSubfolders === true
        scope = deriveScopeFromLegacy(legacyMode, legacySubs)
      }
      // sortSelf=false 且 scope 含自己 → 退為 children-only（縮小，不擴大）
      if (scope === 'selected-with-sub' && !sortSelf)
        scope = 'children-only'

      // 新模式/置頂置底/種子/資料夾獨立規則：無效值採安全 fallback，不擴大範圍
      const mode: NativeSortMode
        = raw?.sortMode === 'manual' || raw?.sortMode === 'random' ? raw.sortMode : 'criteria'
      const seed = typeof raw?.randomSeed === 'number' && Number.isFinite(raw.randomSeed) ? raw.randomSeed : undefined
      const pinFilter = (v: unknown): string[] => Array.isArray(v)
        ? v.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      const rawRules: unknown = raw?.folderRules
      const folderRules: NativeFolderRule[] = Array.isArray(rawRules)
        ? rawRules
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => {
              const folderId = r.folderId
              return typeof folderId === 'string' && folderId.length > 0
                ? { folderId, rule: normalizeSortRule(r.rule) }
                : null
            })
            .filter((r): r is NativeFolderRule => r !== null)
        : []

      return {
        enabled: raw?.enabled === true,
        autoSort: raw?.autoSort === true,
        sortCriteria: normalizeSortCriteria(criteria),
        sortMode: mode,
        scope,
        sortSelf,
        targetFolderIds: Array.isArray(raw?.targetFolderIds)
          ? raw.targetFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [],
        ignoreFolderIds: Array.isArray(raw?.ignoreFolderIds)
          ? raw.ignoreFolderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [],
        ...(seed !== undefined ? { randomSeed: seed } : {}),
        ...(raw?.pinnedTop != null ? { pinnedTop: pinFilter(raw.pinnedTop) } : {}),
        ...(raw?.pinnedBottom != null ? { pinnedBottom: pinFilter(raw.pinnedBottom) } : {}),
        foldersFirst: raw?.foldersFirst !== false,
        ...(folderRules.length > 0 ? { folderRules } : {}),
        // 保留舊欄位（deprecated），雙寫確保降版不壞
        ...(raw?.targetMode != null ? { targetMode: raw.targetMode } : {}),
        ...(raw?.includeSubfolders != null ? { includeSubfolders: raw.includeSubfolders } : {}),
      }
    })(),
    gistBackup: (() => {
      const raw = settings?.gistBackup
      return {
        token: typeof raw?.token === 'string' ? raw.token : '',
        gistId: typeof raw?.gistId === 'string' ? raw.gistId : '',
        encrypt: raw?.encrypt === true,
        passphrase: typeof raw?.passphrase === 'string' ? raw.passphrase : '',
      }
    })(),
  }
}
