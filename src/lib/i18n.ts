import type { Language } from './types'
import { activityMessages } from './i18n-activity'
import { aiMessages } from './i18n-ai'
import { appearanceMessages } from './i18n-appearance'
import { autoOrganizeMessages } from './i18n-auto-organize'
import { backupConsentMessages } from './i18n-backup-consent'
import { bookmarkGroupMessages } from './i18n-bookmark-groups'
import { bookmarkHealthMessages } from './i18n-bookmark-health'
import { bookmarkManagementMessages } from './i18n-bookmark-management'
import { chromeSyncMessages } from './i18n-chrome-bookmark-sync'
import { commandPaletteMessages } from './i18n-command-palette'
import { dragDropMessages } from './i18n-drag-drop'
import { gistMessages } from './i18n-gist-backup'
import { keyboardShortcutMessages } from './i18n-keyboard-shortcuts'
import { runtimeMessages } from './i18n-runtime'
import { searchEngineMessages } from './i18n-search-engine'
import { settingsDataMessages } from './i18n-settings-data'
import { settingsSyncMessages } from './i18n-settings-sync'
import { tabSessionsMessages } from './i18n-tab-sessions'
import { webdavMessages } from './i18n-webdav'

export {
  getBrowserLanguage,
  isLanguage,
  loadPreferredLanguage,
  resolveBrowserLanguage,
} from './language'

const zhTW = {
  ...aiMessages['zh-TW'],
  brandName: '書野 Moorread',
  language: '語言',
  languageDescription: '選擇書野 Moorread 的介面語言，變更後立即生效。',
  chinese: '中文',
  english: 'English',
  settings: '設定',
  openSettings: '開啟設定',
  settingsDescription: '調整首頁體驗、搜尋、內容補全與資料管理。',
  close: '關閉',
  general: '一般',
  appearance: '外觀',
  layoutAppearance: '版面',
  bookmarkAppearance: '書籤外觀',
  visualAppearance: '視覺',
  search: '搜尋',
  contentEnhancement: '內容補全',
  dataAndPrivacy: '資料與隱私',
  about: '關於',
  aboutDescription: '書野 Moorread 是基於 kiwi 的開源專案（MIT）的個人自用版本；程式修改由 AI 協助，本人並非專業開發者。原創 © KIWI。',
  projectRepository: '查看專案原始碼',
  releaseNotes: '更新紀錄',
  followKiwi: '在 X 上追蹤 kiwi',
  settingsCategories: '設定分類',
  defaultFolder: '預設資料夾',
  defaultFolderDescription: '開啟首頁時預設顯示的書籤資料夾。',
  navigationAndCategories: '導覽與分類',
  navigationAndCategoriesDescription:
    '調整分類入口的位置和首頁中需要顯示的導覽內容。',
  sidebar: '左側分類列',
  topbar: '頂部分類列',
  categoryBarPosition: '分類列位置',
  showCounts: '顯示數量',
  smartCategories: '智慧分類',
  savedFilters: '儲存的篩選',
  categoryTree: '樹狀資料夾',
  categoryTreeHint: '樹狀資料夾僅在左側分類列生效，子資料夾可展開或收合。',
  singleHomeTab: '只保留一個書野 Moorread 首頁',
  singleHomeTabDescription:
    '開啟後，再次開啟首頁會切換到現有分頁；關閉時允許同時開啟多個首頁。',
  autoOrganizeRules: '進階：自動整理規則',
  sidebarExpand: '展開側欄',
  sidebarCollapse: '收合側欄',
  sidebarResize: '調整側欄寬度',
  sidebarManage: '管理分類',
  sidebarAppearance: '側欄',
  sidebarAppearanceDescription: '調整側欄的寬度與收合行為。',
  sidebarWidth: '側欄寬度',
  sidebarCollapsedLabel: '收合側欄',
  bookmarkCount: '{count} 個書籤',
  addBookmark: '新增書籤',
  moreActions: '更多操作',
  managementTools: '管理工具',
  bookmarkHealth: '書籤健康檢查',
  openBookmarkHealth: '開啟書籤健康檢查',
  trashAndHistory: '垃圾桶與歷史記錄',
  openTrashAndHistory: '開啟垃圾桶與歷史記錄',
  taskCenter: '工作中心',
  openTaskCenter: '開啟工作中心',
  tabSessions: '分頁工作階段',
  manageTabSessions: '管理分頁工作階段',
  preferences: '偏好設定',
  searchOrEnterUrl: '搜尋或輸入網址',
  searchScope: '搜尋範圍',
  bookmarks: '書籤',
  web: '網頁',
  searchBookmarks: '搜尋書籤',
  searchWeb: '搜尋網頁',
  selectSearchEngine: '選擇網頁搜尋引擎',
  searchBookmarksAndFolders: '搜尋書籤和資料夾',
  searchResultsList: '搜尋結果清單',
  searchWebOrEnterUrl: '搜尋網頁或輸入網址',
  enterUrlOrKeyword: '輸入網址或 {keyword} 關鍵字',
  clearSearch: '清除搜尋內容',
  openCommandPalette: '開啟命令面板',
  openFirstBookmarkResult: '開啟第一個書籤結果',
  openFirstResult: '開啟第一個結果',
  searchWithEngine: '使用 {engine} 搜尋',
  all: '全部',
  inbox: '收件匣',
  pinned: '置頂',
  frequent: '常用',
  recent: '最近',
  untagged: '無標籤',
  undescribed: '無描述',
  allBookmarks: '全部書籤',
  searchResults: '「{query}」的搜尋結果',
  itemCount: '{count} 個項目',
  bookmarkSort: '書籤排序',
  nativeOrder: '瀏覽器順序',
  byName: '依名稱',
  recentlyAdded: '最近新增',
  byFrequency: '依常用程度',
  bookmarkView: '書籤檢視',
  cardView: '卡片檢視',
  compactView: '精簡檢視',
  bulkManage: '批次管理',
  noMatches: '沒有相符的內容',
  emptyLibrary: '瀏覽器書籤是空的',
  smartViewEmpty: '開啟過的書籤會顯示在這裡',
  categoryEmpty: '此分類下沒有內容',
  emptyLibraryDescription: '新增第一個書籤，開始建立你的個人導覽空間。',
  noMatchesDescription: '試試更短的關鍵字，或切換到其他資料夾。',
  quietDescription: '這裡暫時很安靜，稍後再回來看看。',
  quickSave: '快速收藏',
  openHome: '開啟書野 Moorread 首頁',
  pageCannotBeSaved: '目前頁面無法儲存為書籤',
  pageSaved: '已收藏目前頁面',
  viewOnHome: '前往首頁查看',
  pageAlreadySaved: '這個頁面已經收藏',
  urlAlreadySaved: '這個網址已經收藏',
  locatedIn: '位於',
  existingFolder: '現有資料夾',
  openYunjiTab: '開啟書野 Moorread',
  name: '名稱',
  folder: '資料夾',
  optionalTags: '標籤（選填）',
  tagsPlaceholder: '工作, 稍後閱讀',
  saveCurrentPage: '收藏目前頁面',
  paletteSaveLocation: '存到',
  paletteInbox: '收件箱',
  paletteSwitchGroup: '切換預設組',
  paletteGroupSwitched: '預設書籤組已更新',
  paletteSwitchGroupInbox: '切換到收件箱',
  paletteSwitchAll: '未指定（跟隨預設）',
  cannotReadCurrentPage: '無法讀取目前頁面',
  saveFailed: '收藏失敗，請確認書籤權限可用',
  editBookmark: '編輯書籤',
  editBookmarkDescription: '修改書籤資訊',
  addBookmarkDescription: '將常用網址收藏到導覽頁',
  url: '網址',
  fetchSiteMetadata: '取得網站名稱、描述和圖示',
  fetchSiteInfo: '取得網站資訊',
  mergeExistingBookmark: '合併到現有書籤',
  namePlaceholder: '例如：GitHub',
  category: '分類',
  typeOrSelect: '輸入或選擇',
  categoryWillSaveTo: '將存入：{path}',
  categoryUsesExistingFolder: '使用既有資料夾',
  categoryCreatesNewFolder: '將建立新資料夾',
  moreOptions: '更多選項',
  completedFieldCount: '已填寫 {count} 項',
  optionalAlternateUrls: '備用 URL（選填）',
  optionalDescription: '描述（選填）',
  descriptionPlaceholder: '一句話簡介',
  optionalIcon: '圖示（選填）',
  iconPlaceholder: '🐙 或圖示 URL',
  cancel: '取消',
  save: '儲存',
  addAnyway: '仍要新增',
  add: '新增',
  enterUrlFirst: '請先填寫網址',
  sitePermissionRequired: '需要授權存取網站後才能取得網站資訊',
  noSiteMetadata: '此網頁沒有可辨識的名稱、描述或圖示',
  unknownError: '未知錯誤',
  fetchSiteMetadataFailed: '取得網站資訊失敗：{message}',
  enterNameAndUrl: '請填寫名稱和網址',
  duplicateNeedsChoice: '這個網址已存在，請選擇合併或仍要新增',
  invalidAlternateUrl: '備用 URL 僅支援 http:// 或 https://',
  openFolder: '開啟資料夾 {name}',
  dragFolder: '拖曳資料夾',
  dragNamedFolder: '拖曳資料夾 {name}',
  editFolder: '編輯資料夾',
  editNamedFolder: '編輯資料夾 {name}',
  expandFolder: '展開資料夾 {name}',
  collapseFolder: '收合資料夾 {name}',
  bookmarkCategories: '書籤分類',
  folderBookmarkCount: '{count} 個書籤',
  subfolderCount: '{count} 個子資料夾',
  deleteFailed: '刪除失敗',
  selectNamed: '選取 {name}',
  deselectNamed: '取消選取 {name}',
  locateIn: '前往 {path}',
  pinNamed: '置頂 {name}',
  unpinNamed: '取消置頂 {name}',
  pinBookmark: '置頂書籤',
  unpin: '取消置頂',
  dragToReorderOrMove: '拖曳以排序或移動資料夾',
  dragToFolder: '拖曳到資料夾',
  dragBookmark: '拖曳書籤 {name}',
  moreActionsFor: '{name} 的更多操作',
  editBookmarkAction: '編輯書籤',
  deleteBookmark: '刪除書籤',
  ...activityMessages['zh-TW'],
  ...appearanceMessages['zh-TW'],
  ...autoOrganizeMessages['zh-TW'],
  ...bookmarkHealthMessages['zh-TW'],
  ...bookmarkManagementMessages['zh-TW'],
  ...commandPaletteMessages['zh-TW'],
  ...dragDropMessages['zh-TW'],
  ...keyboardShortcutMessages['zh-TW'],
  ...runtimeMessages['zh-TW'],
  ...searchEngineMessages['zh-TW'],
  ...settingsDataMessages['zh-TW'],
  ...settingsSyncMessages['zh-TW'],
  ...tabSessionsMessages['zh-TW'],
  ...bookmarkGroupMessages['zh-TW'],
  ...webdavMessages['zh-TW'],
  ...backupConsentMessages['zh-TW'],
  ...gistMessages['zh-TW'],
  ...chromeSyncMessages['zh-TW'],
} as const

const en: Record<keyof typeof zhTW, string> = {
  ...aiMessages.en,
  brandName: 'Moorread',
  language: 'Language',
  languageDescription:
    'Choose the Moorread interface language. Changes apply immediately.',
  chinese: '中文',
  english: 'English',
  settings: 'Settings',
  openSettings: 'Open settings',
  settingsDescription:
    'Customize the home page, search, content enhancement, and data management.',
  close: 'Close',
  general: 'General',
  appearance: 'Appearance',
  layoutAppearance: 'Layout',
  bookmarkAppearance: 'Bookmark Style',
  visualAppearance: 'Visual',
  search: 'Search',
  contentEnhancement: 'Content',
  dataAndPrivacy: 'Data & Privacy',
  about: 'About',
  aboutDescription:
    'Moorread is a personal build of kiwi\'s open-source project (MIT). Changes were made with AI assistance; the maintainer is not a professional developer. Original work © KIWI.',
  projectRepository: 'View source code',
  releaseNotes: 'Release notes',
  followKiwi: 'Follow kiwi on X',
  settingsCategories: 'Settings categories',
  defaultFolder: 'Default folder',
  defaultFolderDescription:
    'The bookmark folder shown when you open the home page.',
  navigationAndCategories: 'Navigation & categories',
  navigationAndCategoriesDescription:
    'Choose where categories appear and what navigation items are shown.',
  sidebar: 'Sidebar',
  topbar: 'Top bar',
  categoryBarPosition: 'Category bar position',
  showCounts: 'Show counts',
  smartCategories: 'Smart categories',
  savedFilters: 'Saved filters',
  categoryTree: 'Folder tree',
  categoryTreeHint:
    'The folder tree is available in the sidebar. Subfolders can be expanded or collapsed.',
  singleHomeTab: 'Keep one Moorread home tab',
  singleHomeTabDescription:
    'When enabled, opening Moorread again focuses the existing tab. Disable it to allow multiple home tabs.',
  autoOrganizeRules: 'Advanced: auto-organize rules',
  sidebarExpand: 'Expand sidebar',
  sidebarCollapse: 'Collapse sidebar',
  sidebarResize: 'Resize sidebar',
  sidebarManage: 'Manage categories',
  sidebarAppearance: 'Sidebar',
  sidebarAppearanceDescription: 'Adjust the sidebar width and collapse behavior.',
  sidebarWidth: 'Sidebar width',
  sidebarCollapsedLabel: 'Collapse sidebar',
  bookmarkCount: '{count} bookmarks',
  addBookmark: 'Add bookmark',
  moreActions: 'More actions',
  managementTools: 'Management tools',
  bookmarkHealth: 'Bookmark health',
  openBookmarkHealth: 'Open bookmark health',
  trashAndHistory: 'Trash & history',
  openTrashAndHistory: 'Open trash and history',
  taskCenter: 'Task center',
  openTaskCenter: 'Open task center',
  tabSessions: 'Tab sessions',
  manageTabSessions: 'Manage tab sessions',
  preferences: 'Preferences',
  searchOrEnterUrl: 'Search or enter an address',
  searchScope: 'Search scope',
  bookmarks: 'Bookmarks',
  web: 'Web',
  searchBookmarks: 'Search bookmarks',
  searchWeb: 'Search the web',
  selectSearchEngine: 'Choose a web search engine',
  searchBookmarksAndFolders: 'Search bookmarks and folders',
  searchResultsList: 'Search results list',
  searchWebOrEnterUrl: 'Search the web or enter an address',
  enterUrlOrKeyword: 'Enter an address or {keyword} keywords',
  clearSearch: 'Clear search',
  openCommandPalette: 'Open command palette',
  openFirstBookmarkResult: 'Open the first bookmark result',
  openFirstResult: 'Open the first result',
  searchWithEngine: 'Search with {engine}',
  all: 'All',
  inbox: 'Inbox',
  pinned: 'Pinned',
  frequent: 'Frequent',
  recent: 'Recent',
  untagged: 'Untagged',
  undescribed: 'No description',
  allBookmarks: 'All bookmarks',
  searchResults: 'Results for “{query}”',
  itemCount: '{count} items',
  bookmarkSort: 'Bookmark sorting',
  nativeOrder: 'Browser order',
  byName: 'Name',
  recentlyAdded: 'Recently added',
  byFrequency: 'Most used',
  bookmarkView: 'Bookmark view',
  cardView: 'Card view',
  compactView: 'Compact view',
  bulkManage: 'Bulk manage',
  noMatches: 'No matches found',
  emptyLibrary: 'Your browser bookmarks are empty',
  smartViewEmpty: 'Opened bookmarks will appear here',
  categoryEmpty: 'There is nothing in this category',
  emptyLibraryDescription:
    'Add your first bookmark to start building your personal home page.',
  noMatchesDescription: 'Try a shorter keyword or switch to another folder.',
  quietDescription: 'It is quiet here. Check back later.',
  quickSave: 'Quick save',
  openHome: 'Open Moorread home',
  pageCannotBeSaved: 'This page cannot be saved as a bookmark',
  pageSaved: 'Page saved',
  viewOnHome: 'View on home page',
  pageAlreadySaved: 'This page is already saved',
  urlAlreadySaved: 'This URL is already saved',
  locatedIn: 'In',
  existingFolder: 'Existing folder',
  openYunjiTab: 'Open Moorread',
  name: 'Name',
  folder: 'Folder',
  optionalTags: 'Tags (optional)',
  tagsPlaceholder: 'work, read later',
  saveCurrentPage: 'Save current page',
  paletteSaveLocation: 'Save to',
  paletteInbox: 'Inbox',
  paletteSwitchGroup: 'Switch default',
  paletteGroupSwitched: 'Default bookmark group updated',
  paletteSwitchGroupInbox: 'Switch to Inbox',
  paletteSwitchAll: 'Use default',
  cannotReadCurrentPage: 'Unable to read the current page',
  saveFailed: 'Could not save the page. Check the bookmark permission.',
  editBookmark: 'Edit bookmark',
  editBookmarkDescription: 'Update bookmark details.',
  addBookmarkDescription: 'Save a frequently used site to your home page.',
  url: 'URL',
  fetchSiteMetadata: 'Fetch the site name, description, and icon',
  fetchSiteInfo: 'Fetch site information',
  mergeExistingBookmark: 'Merge into existing bookmark',
  namePlaceholder: 'e.g. GitHub',
  category: 'Category',
  typeOrSelect: 'Type or select',
  categoryWillSaveTo: 'Will be saved to: {path}',
  categoryUsesExistingFolder: 'existing folder',
  categoryCreatesNewFolder: 'new folder will be created',
  moreOptions: 'More options',
  completedFieldCount: '{count} completed',
  optionalAlternateUrls: 'Alternate URLs (optional)',
  optionalDescription: 'Description (optional)',
  descriptionPlaceholder: 'A short description',
  optionalIcon: 'Icon (optional)',
  iconPlaceholder: '🐙 or an icon URL',
  cancel: 'Cancel',
  save: 'Save',
  addAnyway: 'Add anyway',
  add: 'Add',
  enterUrlFirst: 'Enter a URL first.',
  sitePermissionRequired: 'Allow site access to fetch site information.',
  noSiteMetadata: 'No recognizable name, description, or icon was found.',
  unknownError: 'Unknown error',
  fetchSiteMetadataFailed: 'Could not fetch site information: {message}',
  enterNameAndUrl: 'Enter a name and URL.',
  duplicateNeedsChoice:
    'This URL already exists. Merge it or add another copy.',
  invalidAlternateUrl: 'Alternate URLs must use http:// or https://.',
  openFolder: 'Open folder {name}',
  dragFolder: 'Drag folder',
  dragNamedFolder: 'Drag folder {name}',
  editFolder: 'Edit folder',
  editNamedFolder: 'Edit folder {name}',
  expandFolder: 'Expand folder {name}',
  collapseFolder: 'Collapse folder {name}',
  bookmarkCategories: 'Bookmark categories',
  folderBookmarkCount: '{count} bookmarks',
  subfolderCount: '{count} subfolders',
  deleteFailed: 'Delete failed',
  selectNamed: 'Select {name}',
  deselectNamed: 'Deselect {name}',
  locateIn: 'Go to {path}',
  pinNamed: 'Pin {name}',
  unpinNamed: 'Unpin {name}',
  pinBookmark: 'Pin bookmark',
  unpin: 'Unpin',
  dragToReorderOrMove: 'Drag to reorder or move to a folder',
  dragToFolder: 'Drag to a folder',
  dragBookmark: 'Drag bookmark {name}',
  moreActionsFor: 'More actions for {name}',
  editBookmarkAction: 'Edit bookmark',
  deleteBookmark: 'Delete bookmark',
  ...activityMessages.en,
  ...appearanceMessages.en,
  ...autoOrganizeMessages.en,
  ...bookmarkHealthMessages.en,
  ...bookmarkManagementMessages.en,
  ...commandPaletteMessages.en,
  ...dragDropMessages.en,
  ...keyboardShortcutMessages.en,
  ...runtimeMessages.en,
  ...searchEngineMessages.en,
  ...settingsDataMessages.en,
  ...settingsSyncMessages.en,
  ...tabSessionsMessages.en,
  ...bookmarkGroupMessages.en,
  ...webdavMessages.en,
  ...backupConsentMessages.en,
  ...gistMessages.en,
  ...chromeSyncMessages.en,
}

export type MessageKey = keyof typeof zhTW
export type TranslationParams = Record<string, number | string>
export interface LocalizedMessage {
  key: MessageKey
  params?: TranslationParams
}
export type LocalizedText = LocalizedMessage | string
export const messageKeys = Object.keys(zhTW) as MessageKey[]
const messageKeySet = new Set<string>(messageKeys)

export function localizedMessage(
  key: MessageKey,
  params?: TranslationParams,
): LocalizedMessage {
  return params ? { key, params } : { key }
}

export function isLocalizedMessage(value: unknown): value is LocalizedMessage {
  if (typeof value !== 'object' || value === null)
    return false
  const candidate = value as Partial<LocalizedMessage>
  if (typeof candidate.key !== 'string' || !messageKeySet.has(candidate.key))
    return false
  return (
    candidate.params === undefined
    || (typeof candidate.params === 'object'
      && candidate.params !== null
      && Object.values(candidate.params).every(
        param => typeof param === 'string' || typeof param === 'number',
      ))
  )
}

export function isLocalizedText(value: unknown): value is LocalizedText {
  return typeof value === 'string' || isLocalizedMessage(value)
}

export const languageOptions: ReadonlyArray<{
  value: Language
  label: string
}> = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
]

export function translate(
  language: Language,
  key: MessageKey,
  params: TranslationParams = {},
): string {
  const template = language === 'zh-TW'
    ? zhTW[key]
    : en[key]
  if (typeof template !== 'string')
    return ''
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]))
}

export function translateText(
  language: Language,
  value: LocalizedText,
): string {
  return typeof value === 'string'
    ? value
    : translate(language, value.key, value.params)
}

export function languageTag(language: Language): string {
  return language
}

const virtualCategoryKeys: Record<string, MessageKey> = {
  all: 'all',
  inbox: 'inbox',
  pinned: 'pinned',
  frequent: 'frequent',
  recent: 'recent',
  untagged: 'untagged',
  undescribed: 'undescribed',
}

export function translateCategoryName(
  language: Language,
  category: { id: string, name: string },
): string {
  const key = virtualCategoryKeys[category.id]
  if (key)
    return translate(language, key)
  return category.name || translate(language, 'runtimeUnnamedFolder')
}
