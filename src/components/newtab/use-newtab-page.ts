import type { AppearanceSettings, Bookmark, Category, Language } from '~/lib/types'

import { useCallback, useEffect, useRef, useState } from 'react'

import { subscribeToBookmarkChanges, subscribeToStorageChanges } from '~/components/newtab/newtab-chrome-sync'
import {
  accentColorVars,
  colorThemeVariableNames,
  colorThemeVars,
} from '~/lib/appearance'
import { useBookmarkGroupsStore } from '~/lib/bookmark-groups-store'
import { reportDiagnostic, reportExpectedFallback } from '~/lib/diagnostics'
import { FONT_WEIGHT_VALUES, resolveFontStack } from '~/lib/fonts'
import { globalPaletteHomeHash } from '~/lib/global-command-palette'
import { homeTabReadyMessage } from '~/lib/home-tabs'
import { languageTag, translate } from '~/lib/i18n'
import {
  canTriggerShortcutWhileEditing,
  shortcutMatchesEvent,
} from '~/lib/keyboard-shortcuts'
import { loadActiveLocalBackground, LOCAL_BACKGROUND_META_KEY } from '~/lib/local-background'
import { runNewtabStartup } from '~/lib/newtab-startup'
import { deriveThemePalette } from '~/lib/palette'
import { flushUsagePersistence, useNavStore } from '~/lib/store'
import { applyResolvedTheme } from '~/lib/theme-boot'
import { runThemeTransition } from '~/lib/theme-transition'
import { runWebdavBackup } from '~/lib/webdav-backup'

export interface NewtabPageController {
  appearance: AppearanceSettings
  language: Language
  weatherBackground: boolean
  backgroundUrl: string
  bookmarksReady: boolean
  startupError: boolean
  retryStartup: () => void
  groupsOpen: boolean
  groupsActive: boolean
  groupsEnabled: boolean
  pinnedGroupsOnly: boolean
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  editingBookmark: Bookmark | null
  editingCategory: Category | null
  closeCategoryDialog: () => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
  healthOpen: boolean
  onHealthOpenChange: (open: boolean) => void
  openHealthDialog: () => void
  searchDocked: boolean
  onDockedChange: (docked: boolean) => void
  openAddBookmark: () => void
  openEditBookmark: (bookmark: Bookmark) => void
  openCommandPalette: () => void
  openCategoryEditor: (category: Category) => void
  selectGroups: () => void
  selectCategoryView: () => void
}

/** Owns every piece of new-tab state, effects and store subscription in one place. */
export function useNewtabPage(): NewtabPageController {
  const init = useNavStore(s => s.init)
  const theme = useNavStore(s => s.settings.theme)
  // 設定（含主題）尚未載入完成前，不得用預設值覆蓋啟動階段依快取套用的 class。
  const settingsReady = useNavStore(s => s.initialized || Boolean(s.initError))
  const appearance = useNavStore(s => s.settings.appearance)
  const themeBaseColor = useNavStore(s => s.themePalette.baseColor)
  const language = useNavStore(s => s.settings.language)
  const keyboardShortcuts = useNavStore(s => s.settings.keyboardShortcuts)
  const weatherBackground = useNavStore(s => s.settings.headerWidget.weatherBackground)

  const activeCategoryId = useNavStore(state => state.activeCategoryId)
  const groupsEnabled = useNavStore(state => state.settings.bookmarkGroupsEnabled)
  const pinnedGroupsOnly = activeCategoryId === 'pinned'

  const [groupsOpen, setGroupsOpen] = useState(false)
  const groupsActive = groupsEnabled && groupsOpen
  const [dialogOpen, setDialogOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(
    () => window.location.hash === globalPaletteHomeHash,
  )
  const [healthOpen, setHealthOpen] = useState(false)
  const [searchDocked, setSearchDocked] = useState(false)
  const handleDockedChange = useCallback((docked: boolean) => setSearchDocked(docked), [])
  const [bookmarksReady, setBookmarksReady] = useState(false)
  const [startupError, setStartupError] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [startupAttempt, setStartupAttempt] = useState(0)
  const [editing, setEditing] = useState<Bookmark | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)

  useEffect(() => {
    document.documentElement.lang = languageTag(language)
    document.title = translate(language, 'brandName')
  }, [language])

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: homeTabReadyMessage })
      .catch(cause => reportExpectedFallback('home-tab.announce', cause))
  }, [])

  useEffect(() => {
    const openPaletteFromHash = () => {
      if (window.location.hash !== globalPaletteHomeHash)
        return
      setCommandOpen(true)
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}`,
      )
    }
    openPaletteFromHash()
    window.addEventListener('hashchange', openPaletteFromHash)
    return () => window.removeEventListener('hashchange', openPaletteFromHash)
  }, [])

  useEffect(() => {
    const flushUsage = () =>
      void flushUsagePersistence()
        .catch(cause => reportExpectedFallback('usage.flush', cause))
    window.addEventListener('pagehide', flushUsage)
    return () => window.removeEventListener('pagehide', flushUsage)
  }, [])

  // 先恢复设置和书签组，再加载浏览器书签；加载结束立即应用默认分类并收起骨架屏，
  // 元数据同步放到后台，避免首屏被同步阻塞。
  useEffect(() => {
    let active = true
    let loaded = false
    // 只補診斷資訊：標記失敗階段後原樣拋出，不改變啟動流程或錯誤處理結果。
    const stage = async (label: string, run: Promise<unknown>) => {
      try {
        await run
      }
      catch (cause) {
        reportDiagnostic(`newtab.startup.${label}`, cause)
        throw cause
      }
    }
    void runNewtabStartup({
      isActive: () => active,
      load: async () => {
        // 先恢复设置和书签组，再加载浏览器书签，避免初始化竞态。
        await Promise.all([
          stage('init', init()),
          stage('groups', useBookmarkGroupsStore.getState().load()),
        ])
        await stage('bookmarks', useNavStore.getState().loadBookmarks())
        loaded = true
      },
      applyDefaultCategory: () => useNavStore.getState().applyDefaultCategory(),
      // 初始化失敗時不得用空狀態跑中繼資料同步，避免反向覆蓋既有資料。
      syncMetadataNow: () => useNavStore.getState().initialized
        ? useNavStore.getState().syncMetadataNow()
        : Promise.resolve(),
      onError: (cause) => {
        // 背景同步失敗不影響首屏；只有載入失敗才顯示錯誤與重試入口。
        if (active && !loaded) {
          reportDiagnostic('newtab.startup', cause)
          setStartupError(true)
        }
      },
      onLoaded: () => {
        // 只有載入成功才收起骨架屏；失敗時保留失敗狀態，不得顯示成空書籤。
        if (!loaded)
          return
        setBookmarksReady(true)
        // webdav-backup 已被 migrate-yunji-storage 靜態匯入而併入主 bundle，
        // 動態 import() 會被 Parcel 改寫成同步 require（回傳模組而非 Promise），
        // 因此這裡直接靜態呼叫，避免 `.then is not a function`。
        // 遷移順序由 runWebdavBackup 內的共用 gate 保證（自動與手動同一入口）；
        // gate 未就緒會拋出 webdav.migration，由下列 catch 明確回報。
        void runWebdavBackup(() => useNavStore.getState().exportFullBackup())
          .catch(cause => reportExpectedFallback('webdav.backup', cause))
      },
    })
    return () => {
      active = false
    }
  }, [init, startupAttempt])

  const retryStartup = useCallback(() => {
    setStartupError(false)
    setStartupAttempt(attempt => attempt + 1)
  }, [])

  // 实时反映浏览器侧的书签变化。
  // Every Chrome listener and the debounce timer are released in the teardown.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => subscribeToBookmarkChanges(), [])

  // The Chrome storage listener is removed with the same callback reference.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => subscribeToStorageChanges(), [])

  // 本機背景：預設不載入；啟用時只讀一次，設定變更時才重新讀取並釋放舊 object URL。
  useEffect(() => {
    let active = true
    let objectUrl = ''
    const apply = async () => {
      const blob = await loadActiveLocalBackground()
      if (!active)
        return
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = ''
      }
      if (blob) {
        objectUrl = URL.createObjectURL(blob)
        setBackgroundUrl(objectUrl)
        return
      }
      setBackgroundUrl('')
    }
    void apply()
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return () => {
        active = false
        if (objectUrl)
          URL.revokeObjectURL(objectUrl)
      }
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes[LOCAL_BACKGROUND_META_KEY])
        void apply()
    }
    chrome.storage.onChanged.addListener(listener)
    return () => {
      active = false
      chrome.storage.onChanged.removeListener(listener)
      if (objectUrl)
        URL.revokeObjectURL(objectUrl)
    }
  }, [])

  // 应用主题：light / dark / 跟随系统，以及成套配色变量。首次直接生效，之后的切换以过渡动画呈现。
  const themeAppliedRef = useRef(false)
  useEffect(() => {
    // 設定尚未載入完成時保留啟動階段依快取套用的主題，避免預設值造成閃爍。
    if (!settingsReady)
      return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    // A transition still waiting for its snapshot must not repaint settings that have since changed.
    let stale = false
    const apply = () => {
      if (stale)
        return
      const root = document.documentElement
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      // 同步 dark class、color-scheme 與下次啟動用的同步快取。
      applyResolvedTheme(dark ? 'dark' : 'light')

      // 圓角以 px 數字保存，直接輸出帶單位的 CSS 變數。
      root.style.setProperty('--radius', `${appearance.radius}px`)

      // 主題配色引擎：自訂 Base Color 優先，涵蓋全部 Token，不再疊加既有主題或強調色。
      const customPalette = themeBaseColor
        ? deriveThemePalette(themeBaseColor, dark ? 'dark' : 'light')
        : null

      if (customPalette) {
        Object.entries(customPalette).forEach(([key, value]) =>
          root.style.setProperty(key, value),
        )
      }
      else if (appearance.colorTheme === 'default') {
        colorThemeVariableNames.forEach(key =>
          root.style.removeProperty(key),
        )
      }
      else {
        const themeVars
          = colorThemeVars[appearance.colorTheme][dark ? 'dark' : 'light']
        Object.entries(themeVars).forEach(([key, value]) =>
          root.style.setProperty(key, value),
        )
      }

      if (!customPalette && appearance.accentColor !== 'neutral') {
        const colorVars = accentColorVars[appearance.accentColor]
        for (const key of ['--primary', '--primary-foreground', '--ring', '--brand']) {
          root.style.removeProperty(key)
          root.style.setProperty(key, colorVars[key])
        }
      }
    }
    if (themeAppliedRef.current)
      runThemeTransition(apply)
    else
      apply()
    themeAppliedRef.current = true
    if (theme === 'system') {
      const onSchemeChange = () => runThemeTransition(apply)
      mq.addEventListener('change', onSchemeChange)
      return () => {
        stale = true
        mq.removeEventListener('change', onSchemeChange)
      }
    }
    return () => {
      stale = true
    }
  }, [appearance.accentColor, appearance.colorTheme, appearance.radius, settingsReady, theme, themeBaseColor])

  // 字體只影響本機顯示：套用已安裝的家族與基準字重，不載入任何字體檔。
  useEffect(() => {
    const root = document.documentElement
    const stack = resolveFontStack(appearance.fontFamily)
    if (stack)
      root.style.setProperty('--app-font-family', stack)
    else
      root.style.removeProperty('--app-font-family')
    root.style.setProperty(
      '--app-font-weight',
      String(FONT_WEIGHT_VALUES[appearance.fontWeight]),
    )
    // 字體縮放：用 JS 算好比例設 CSS var（CSS attr() 在 calc 裡瀏覽器支援不完整）
    if (appearance.fontSizeScale === 0) {
      root.removeAttribute('data-font-scale')
      root.style.removeProperty('--font-scale-ratio')
    }
    else {
      root.setAttribute('data-font-scale', String(appearance.fontSizeScale))
      root.style.setProperty('--font-scale-ratio', String(1 + appearance.fontSizeScale / 100))
    }
  }, [appearance.fontFamily, appearance.fontWeight, appearance.fontSizeScale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editingText
        = target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target?.isContentEditable
      // While the centered hero is scrolled away, the header's docked copy is the visible search box.
      const searchInput = document.getElementById('moorread-search-docked') ?? document.getElementById('moorread-search')
      if (
        event.defaultPrevented
        || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
      ) {
        return
      }

      const canRun = (shortcut: typeof keyboardShortcuts.focusSearch) =>
        !editingText || canTriggerShortcutWhileEditing(shortcut)

      if (
        shortcutMatchesEvent(keyboardShortcuts.openCommandPalette, event)
        && canRun(keyboardShortcuts.openCommandPalette)
      ) {
        event.preventDefault()
        setCommandOpen(true)
        return
      }
      if (
        shortcutMatchesEvent(keyboardShortcuts.focusSearch, event)
        && canRun(keyboardShortcuts.focusSearch)
      ) {
        event.preventDefault()
        searchInput?.focus()
        return
      }
      if (
        shortcutMatchesEvent(keyboardShortcuts.addBookmark, event)
        && canRun(keyboardShortcuts.addBookmark)
      ) {
        event.preventDefault()
        setEditing(null)
        setDialogOpen(true)
        return
      }
      if (event.key === 'Escape') {
        const query = useNavStore.getState().bookmarkSearchQuery
        if (query) {
          event.preventDefault()
          useNavStore.getState().setBookmarkSearchQuery('')
          searchInput?.focus()
        }
        return
      }
      if (
        !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(
          event.key,
        )
        || (editingText && !['ArrowDown', 'ArrowUp'].includes(event.key))
      ) {
        return
      }

      const items = Array.from(
        document.querySelectorAll<HTMLElement>('[data-nav-item]'),
      ).filter(item => item.offsetParent !== null)
      if (items.length === 0)
        return
      const currentIndex = items.indexOf(document.activeElement as HTMLElement)
      const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
      const nextIndex
        = currentIndex < 0
          ? backwards
            ? items.length - 1
            : 0
          : (currentIndex + (backwards ? -1 : 1) + items.length) % items.length
      event.preventDefault()
      items[nextIndex]?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboardShortcuts])

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (bookmark: Bookmark) => {
    setEditing(bookmark)
    setDialogOpen(true)
  }

  return {
    appearance,
    language,
    weatherBackground,
    backgroundUrl,
    bookmarksReady,
    startupError,
    retryStartup,
    groupsOpen,
    groupsActive,
    groupsEnabled,
    pinnedGroupsOnly,
    dialogOpen,
    onDialogOpenChange: setDialogOpen,
    editingBookmark: editing,
    editingCategory,
    closeCategoryDialog: () => setEditingCategory(null),
    commandOpen,
    onCommandOpenChange: setCommandOpen,
    healthOpen,
    onHealthOpenChange: setHealthOpen,
    openHealthDialog: () => setHealthOpen(true),
    searchDocked,
    onDockedChange: handleDockedChange,
    openAddBookmark: openAdd,
    openEditBookmark: openEdit,
    openCommandPalette: () => setCommandOpen(true),
    openCategoryEditor: setEditingCategory,
    selectGroups: () => setGroupsOpen(true),
    selectCategoryView: () => setGroupsOpen(false),
  }
}
