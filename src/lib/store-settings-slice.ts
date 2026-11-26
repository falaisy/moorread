import type { StateCreator } from 'zustand'
import type { SettingsSlice } from './store-settings-state'
import type { NavState } from './store-types'
import type { Settings } from './types'
import { normalizeAppearanceSettings } from './appearance'
import {
  normalizeAutoOrganizeRules,
  previewAutoOrganizeRules,
} from './auto-organize'
import { normalizeIgnoredDomains } from './description-sync'
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  SHORTCUT_ACTIONS,
  shortcutsEqual,
  validateShortcut,
} from './keyboard-shortcuts'
import {
  markLocalMetadataChanged,
  normalizeMetadataSyncScope,
} from './metadata-sync'
import { validateCustomSearchEngine } from './search-engines'
import {
  metaStorage,
  persist,
  settingsStorage,
  STORAGE_KEYS,
  withSettingsLock,
} from './store-persistence'
import { DEFAULT_SETTINGS, normalizeSettings, resolveAvailableCategoryId } from './store-settings-state'
import { normalizeHeaderWidget } from './weather'

// setLanguage 短時間連續呼叫時（使用者快速切換）最後只落一次。
let languageDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingLanguage: import('./types').Language | null = null
const pendingLanguageResolvers: Array<() => void> = []

// 多页面共同持有同一份设置时，任何写入都必须基于存储里的最新值，
// 否则旧页面会把默认文件夹等字段覆盖回旧值。
async function commitSettings(
  set: (partial: { settings: Settings }) => void,
  patch: (latest: Settings) => Settings,
): Promise<Settings> {
  const next = await withSettingsLock(async () => {
    const stored = await settingsStorage.get<Partial<Settings>>(
      STORAGE_KEYS.settings,
    )
    const merged = normalizeSettings(patch(normalizeSettings(stored)))
    await persist(settingsStorage, STORAGE_KEYS.settings, merged)
    return merged
  })
  set({ settings: next })
  return next
}

export const createSettingsSlice: StateCreator<
  NavState,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  setHeaderWidget: async (patch) => {
    try {
      // 先落盤再更新畫面：畫面若比儲存更早反映新值，使用者在寫入完成前重新載入頁面
      // 就會看到設定回退（時間天氣小工具重新出現）。鎖內合併仍保留其他分頁的最新值。
      await commitSettings(set, latest => ({
        ...latest,
        headerWidget: normalizeHeaderWidget({ ...latest.headerWidget, ...patch }),
      }))
    }
    catch (error) {
      // 寫入失敗仍保留使用者剛選的值（樂觀更新），錯誤交由呼叫方顯示。
      const optimistic = normalizeHeaderWidget({ ...get().settings.headerWidget, ...patch })
      set({ settings: { ...get().settings, headerWidget: optimistic } })
      throw error
    }
  },

  resetGeneralSettings: async () => {
    await commitSettings(set, latest => ({
      ...latest,
      language: DEFAULT_SETTINGS.language,
      headerWidget: structuredClone(DEFAULT_SETTINGS.headerWidget),
      defaultCategoryId: DEFAULT_SETTINGS.defaultCategoryId,
      singleHomeTab: DEFAULT_SETTINGS.singleHomeTab,
      bookmarkGroupsEnabled: DEFAULT_SETTINGS.bookmarkGroupsEnabled,
      appearance: {
        ...latest.appearance,
        navLayout: DEFAULT_SETTINGS.appearance.navLayout,
        homeLayout: DEFAULT_SETTINGS.appearance.homeLayout,
        navItems: {
          ...DEFAULT_SETTINGS.appearance.navItems,
          icons: latest.appearance.navItems.icons,
        },
      },
    }))
  },

  resetAppearanceSettings: async () => {
    await commitSettings(set, latest => ({
      ...latest,
      theme: DEFAULT_SETTINGS.theme,
      appearance: {
        ...structuredClone(DEFAULT_SETTINGS.appearance),
        navLayout: latest.appearance.navLayout,
        homeLayout: latest.appearance.homeLayout,
        contentWidth: latest.appearance.contentWidth,
        sidebarWidth: latest.appearance.sidebarWidth,
        sidebarCollapsed: latest.appearance.sidebarCollapsed,
        navItems: {
          ...latest.appearance.navItems,
          icons: DEFAULT_SETTINGS.appearance.navItems.icons,
        },
      },
    }))
    // 自訂配色存在 local；恢復外觀預設時必須一併清除，否則預設主題會被覆蓋。
    await get().resetThemePalette()
  },

  setBookmarkGroupsEnabled: async (bookmarkGroupsEnabled) => {
    if (get().settings.bookmarkGroupsEnabled === bookmarkGroupsEnabled)
      return
    await commitSettings(set, latest => ({ ...latest, bookmarkGroupsEnabled }))
  },

  setLanguage: (language) => {
    // 樂觀更新（立即反映到畫面）
    set({ settings: { ...get().settings, language } })
    // debounce：300ms 內最後一次才真的寫入 storage
    pendingLanguage = language
    if (languageDebounceTimer) {
      clearTimeout(languageDebounceTimer)
    }
    return new Promise<void>((resolve) => {
      pendingLanguageResolvers.push(resolve)
      languageDebounceTimer = setTimeout(() => {
        const final = pendingLanguage
        const resolvers = pendingLanguageResolvers.splice(0)
        languageDebounceTimer = null
        pendingLanguage = null
        if (final) {
          void commitSettings(set, latest => ({ ...latest, language: final })).finally(() => {
            resolvers.forEach(r => r())
          })
        }
        else {
          resolvers.forEach(r => r())
        }
      }, 300)
    })
  },

  addCustomSearchEngine: async (engine) => {
    if (get().settings.customSearchEngines.length >= 20)
      throw new Error('search_engine.limit_reached')
    const normalized = validateCustomSearchEngine(
      engine,
      get().settings.customSearchEngines,
    )
    const entry = { id: `custom-${crypto.randomUUID()}`, ...normalized }
    await commitSettings(set, latest => ({
      ...latest,
      customSearchEngines: [...latest.customSearchEngines, entry],
    }))
  },

  updateCustomSearchEngine: async (id, engine) => {
    if (!get().settings.customSearchEngines.some(item => item.id === id))
      throw new Error('search_engine.not_found')
    const normalized = validateCustomSearchEngine(
      engine,
      get().settings.customSearchEngines,
      id,
    )
    await commitSettings(set, latest => ({
      ...latest,
      customSearchEngines: latest.customSearchEngines.map(item =>
        item.id === id ? { id, ...normalized } : item,
      ),
    }))
  },

  removeCustomSearchEngine: async (id) => {
    await commitSettings(set, latest => ({
      ...latest,
      customSearchEngines: latest.customSearchEngines.filter(
        engine => engine.id !== id,
      ),
    }))
  },

  setTheme: (theme) => {
    // 樂觀更新
    set({ settings: { ...get().settings, theme } })
    return commitSettings(set, latest => ({ ...latest, theme })).then(() => {})
  },

  // 不再按当前已加载的分类做降级：分类尚未加载时写入 'all' 正是默认文件夹被重置的原因。
  setDefaultCategory: async (id) => {
    await commitSettings(set, latest => ({
      ...latest,
      defaultCategoryId: id,
    }))
  },

  setSingleHomeTab: async (singleHomeTab) => {
    await commitSettings(set, latest => ({ ...latest, singleHomeTab }))
  },

  setGlobalCommandPaletteEnabled: async (globalCommandPaletteEnabled) => {
    await commitSettings(set, latest => ({
      ...latest,
      globalCommandPaletteEnabled,
    }))
  },

  applyDefaultCategory: () => {
    // 使用者在載入完成前（側欄在骨架屏期間仍可點）已主動選過分類時保留其選擇；
    // 只有從未互動的分頁才落到設定的預設分類。
    if (get().categorySelectionTouched)
      return
    set({
      activeCategoryId: resolveAvailableCategoryId(
        get().settings.defaultCategoryId,
        get().categories,
      ),
    })
  },

  setDescriptionIgnoredDomains: async (domains) => {
    await commitSettings(set, latest => ({
      ...latest,
      descriptionIgnoredDomains: normalizeIgnoredDomains(domains),
    }))
  },

  setOnboardingDismissed: async (dismissed) => {
    await commitSettings(set, latest => ({
      ...latest,
      onboardingDismissed: dismissed,
    }))
  },

  setBookmarkSortMode: async (bookmarkSortMode) => {
    await commitSettings(set, latest => ({ ...latest, bookmarkSortMode }))
  },

  setBookmarkViewMode: async (bookmarkViewMode) => {
    await commitSettings(set, latest => ({ ...latest, bookmarkViewMode }))
  },

  setAppearance: async (patch) => {
    // 樂觀更新：先同步反映到畫面（storage I/O 在後台做）
    const current = get().settings.appearance
    const optimistic = normalizeAppearanceSettings({
      ...current,
      ...patch,
      cardFields: patch.cardFields
        ? { ...current.cardFields, ...patch.cardFields }
        : current.cardFields,
      navItems: patch.navItems
        ? { ...current.navItems, ...patch.navItems }
        : current.navItems,
    })
    set({ settings: { ...get().settings, appearance: optimistic } })
    // 後台持久化（commitSettings 會再 set 一次相同值，zustand 會跳過重渲染）
    void commitSettings(set, latest => ({
      ...latest,
      appearance: normalizeAppearanceSettings({
        ...latest.appearance,
        ...patch,
        cardFields: patch.cardFields
          ? { ...latest.appearance.cardFields, ...patch.cardFields }
          : latest.appearance.cardFields,
        navItems: patch.navItems
          ? { ...latest.appearance.navItems, ...patch.navItems }
          : latest.appearance.navItems,
      }),
    }))
  },

  setKeyboardShortcut: async (action, shortcut) => {
    if (validateShortcut(shortcut))
      throw new Error('shortcut.invalid')
    if (
      SHORTCUT_ACTIONS.some(
        candidate =>
          candidate !== action
          && shortcutsEqual(get().settings.keyboardShortcuts[candidate], shortcut),
      )
    ) {
      throw new Error('shortcut.conflict')
    }
    await commitSettings(set, latest => ({
      ...latest,
      keyboardShortcuts: {
        ...latest.keyboardShortcuts,
        [action]: shortcut,
      },
    }))
  },

  resetKeyboardShortcuts: async () => {
    await commitSettings(set, latest => ({
      ...latest,
      keyboardShortcuts: structuredClone(DEFAULT_KEYBOARD_SHORTCUTS),
    }))
  },

  addSavedSearch: async (query) => {
    const normalized = query.trim()
    if (
      !normalized
      || get().settings.savedSearches.some(item => item.query === normalized)
    ) {
      return
    }
    const entry = {
      id: crypto.randomUUID(),
      name: normalized.slice(0, 40),
      query: normalized,
    }
    await commitSettings(set, latest => ({
      ...latest,
      savedSearches: [...latest.savedSearches, entry].slice(-20),
    }))
  },

  removeSavedSearch: async (id) => {
    await commitSettings(set, latest => ({
      ...latest,
      savedSearches: latest.savedSearches.filter(item => item.id !== id),
    }))
  },

  addAutoOrganizeRule: async (rule) => {
    const entry = { id: crypto.randomUUID(), ...rule }
    await commitSettings(set, latest => ({
      ...latest,
      autoOrganizeRules: normalizeAutoOrganizeRules([
        ...latest.autoOrganizeRules,
        entry,
      ]),
    }))
  },

  updateAutoOrganizeRule: async (id, patch) => {
    await commitSettings(set, latest => ({
      ...latest,
      autoOrganizeRules: normalizeAutoOrganizeRules(
        latest.autoOrganizeRules.map(rule =>
          rule.id === id ? { ...rule, ...patch } : rule,
        ),
      ),
    }))
  },

  removeAutoOrganizeRule: async (id) => {
    await commitSettings(set, latest => ({
      ...latest,
      autoOrganizeRules: latest.autoOrganizeRules.filter(
        rule => rule.id !== id,
      ),
    }))
  },

  runAutoOrganizeRules: async () => {
    const preview = previewAutoOrganizeRules(
      get().bookmarks,
      get().settings.autoOrganizeRules,
      get().categories,
    )
    for (const item of preview) {
      // Each update reloads store state; preserve rule order and avoid lost updates.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await get().updateBookmark(item.bookmark.id, item.patch)
    }
    return preview.length
  },

  setAutoOrganizeOnSave: async (enabled) => {
    if (get().settings.autoOrganizeOnSave === enabled)
      return
    await commitSettings(set, latest => ({ ...latest, autoOrganizeOnSave: enabled }))
  },

  setMetadataSyncScope: async (scope) => {
    await commitSettings(set, latest => ({
      ...latest,
      metadataSyncScope: normalizeMetadataSyncScope({
        ...latest.metadataSyncScope,
        ...scope,
      }),
    }))
    await markLocalMetadataChanged()
  },

  setMetadataSyncEncryption: async (enabled, passphrase) => {
    const normalizedPassphrase = passphrase?.trim()
    if (enabled && !normalizedPassphrase && !get().metadataSyncPassphraseSet)
      throw new Error('metadata_sync.passphrase_required')
    if (normalizedPassphrase) {
      await metaStorage.set(
        STORAGE_KEYS.metadataSyncPassphrase,
        normalizedPassphrase,
      )
    }
    if (!enabled)
      await metaStorage.remove(STORAGE_KEYS.metadataSyncPassphrase)
    await commitSettings(set, latest => ({
      ...latest,
      metadataSyncEncryptionEnabled: enabled,
    }))
    set({
      metadataSyncPassphraseSet:
        enabled
        && (Boolean(normalizedPassphrase) || get().metadataSyncPassphraseSet),
    })
    await markLocalMetadataChanged()
  },

  setGistBackup: (patch) => {
    // 樂觀更新：輸入或貼上 Token 後立刻操作時，處理函式必須讀到最新值，
    // 不能等到 storage 寫入完成才反映到畫面。
    set({
      settings: {
        ...get().settings,
        gistBackup: { ...get().settings.gistBackup, ...patch },
      },
    })
    return commitSettings(set, latest => ({
      ...latest,
      gistBackup: {
        ...latest.gistBackup,
        ...patch,
      },
    })).then(() => {})
  },
})
