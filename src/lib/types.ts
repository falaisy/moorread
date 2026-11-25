// 书签 —— 一个快捷网址入口
export interface Bookmark {
  id: string
  name: string
  url: string
  description?: string
  categoryId: string
  /** 可选自定义 emoji 或图片 URL；为空时自动使用站点 favicon */
  icon?: string
  /** 额外访问地址，打开时会和主 URL 一起探测并选择最快响应的地址 */
  alternateUrls?: string[]
  /** 本地置顶时间；浏览器原生书签不包含此字段 */
  pinnedAt?: number
  pinnedOrder?: number
  /** 本地标签；不改变浏览器原生目录结构 */
  tags?: string[]
  /** Added through a quick-capture flow and not organized yet. */
  inboxAt?: number
  dateAdded?: number
  index?: number
}

// 分类 —— 书签的分组维度
export interface Category {
  id: string
  name: string
  emoji: string
  parentId: string
  modifiable: boolean
}

// 浏览器目录没有图标字段，使用本地元数据补充
export interface CategoryMeta {
  emoji?: string
}

// 书签元数据：为浏览器书签（无描述/图标字段）补充的扩展信息，按 url 索引
export interface BookmarkMeta {
  description?: string
  icon?: string
  alternateUrls?: string[]
  pinnedAt?: number
  pinnedOrder?: number
  tags?: string[]
  inboxAt?: number
}

export interface BookmarkUsage {
  openCount: number
  lastOpenedAt: number
}

// 主题模式
export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'zh-TW' | 'en'
export type BookmarkSortMode = 'manual' | 'name' | 'recentlyAdded' | 'frequent'
export type BookmarkViewMode = 'grid' | 'compact'
export type NavLayout = 'sidebar' | 'top'
export type HomeLayout = 'workspace' | 'centered'
export type ContentWidth = 'standard' | 'wide' | 'full'
/** @deprecated 由 cardHeight + gridCols 替代；保留以遷移舊設定值 */
export type GridDensity = 'comfortable' | 'dense'
/** @deprecated 由 cardHeight + gridCols 替代；保留以遷移舊設定值 */
export type CardSize = 'compact' | 'comfortable' | 'spacious'
export type CardStyle = 'soft' | 'outline' | 'plain'
export type AppearanceSize = 'sm' | 'md' | 'lg' | 'xl'
export type AccentColor = 'neutral' | 'blue' | 'green' | 'orange' | 'rose'
export type ColorTheme
  = 'default' | 'graphite' | 'meadow' | 'dawn' | 'berry' | 'sky'
export type ActionVisibility = 'hover' | 'always'
export type BackgroundStyle = 'flat' | 'subtle' | 'panel'
export type AppearanceFontWeight = 'regular' | 'medium' | 'bold'
export type TitleLineCount = 1 | 2
export type DescriptionLineCount = 1 | 2 | 3
export type ShortcutAction
  = 'focusSearch' | 'openCommandPalette' | 'addBookmark'

export interface KeyboardShortcut {
  key: string
  primary: boolean
  alt: boolean
  shift: boolean
}

export type KeyboardShortcuts = Record<ShortcutAction, KeyboardShortcut>

export interface CardFieldSettings {
  /** Shared by bookmark, folder and group cards; keep the stored key for compatibility. */
  websiteIcon: boolean
  description: boolean
  tags: boolean
  categoryPath: boolean
  categoryCards: boolean
  actions: ActionVisibility
  titleLines: TitleLineCount
  descriptionLines: DescriptionLineCount
  maxVisibleTags: number
}

export interface NavItemSettings {
  icons: boolean
  counts: boolean
  smartCategories: boolean
  savedSearches: boolean
  categoryTree: boolean
}

export interface AppearanceSettings {
  navLayout: NavLayout
  homeLayout: HomeLayout
  contentWidth: ContentWidth
  /** @deprecated 由 cardHeight + gridCols 替代 */
  gridDensity: GridDensity
  /** @deprecated 由 cardHeight + gridCols 替代 */
  cardSize: CardSize
  /** 卡片 grid 模式最小高度（單位 px，60-140） */
  cardHeight: number
  /** @deprecated 由 bookmarkGridCols + folderGridCols 取代；保留以遷移舊設定值 */
  gridCols: number
  /** 螢幕夠寬時書籤卡片每列數（1-8）；0 = 自動跟隨螢幕 */
  bookmarkGridCols: number
  /** 螢幕夠寬時資料夾卡片每列數（1-8）；0 = 自動跟隨螢幕 */
  folderGridCols: number
  cardStyle: CardStyle
  /** 圖示容器尺寸（單位 px，32-72） */
  iconSize: number
  /** 圓角尺寸（單位 px，4-16） */
  radius: number
  accentColor: AccentColor
  colorTheme: ColorTheme
  /** 0 = 自動跟隨螢幕；負數縮小，正數放大，百分比 */
  fontSizeScale: number
  backgroundStyle: BackgroundStyle
  /** 空字串代表跟隨系統；其餘為本機字體家族名稱，不會打包任何字體檔。 */
  fontFamily: string
  fontWeight: AppearanceFontWeight
  navItems: NavItemSettings
  cardFields: CardFieldSettings
  /** Sidebar width in pixels; clamped 192-384. */
  sidebarWidth: number
  /** Whether the sidebar is collapsed to icon-only. */
  sidebarCollapsed: boolean
}

// 搜索引擎
export interface SearchEngine {
  id: string
  name: string
  /** 搜索 URL 模板，%s 为查询占位符 */
  url: string
  emoji: string
  /** 输入框中用于直接指定引擎的短关键字 */
  keyword: string
}

export interface SavedSearch {
  id: string
  name: string
  query: string
}

export interface MetadataSyncScope {
  description: boolean
  icon: boolean
  alternateUrls: boolean
  pinnedAt: boolean
  tags: boolean
  inboxAt: boolean
  categoryIcons: boolean
}

export type AutoOrganizeField
  = 'name' | 'url' | 'domain' | 'description' | 'tag'
export type AutoOrganizeOperator = 'contains' | 'equals' | 'startsWith'

export interface AutoOrganizeRule {
  id: string
  name: string
  enabled: boolean
  field: AutoOrganizeField
  operator: AutoOrganizeOperator
  value: string
  targetCategoryId?: string
  addTags: string[]
  clearInbox: boolean
}

// 用户设置
export interface WeatherLocation {
  name: string
  latitude: number
  longitude: number
}

export interface HeaderWidgetSettings {
  clockEnabled: boolean
  weatherEnabled: boolean
  showDate: boolean
  hour12: boolean
  temperatureUnit: 'celsius' | 'fahrenheit'
  location: WeatherLocation | null
  /** Animated hero background that follows the current weather (Clear Sky, centered home only). */
  weatherBackground: boolean
}

/** 原生書籤排序範圍：三選一，取代舊的 targetMode + includeSubfolders 兩個 boolean */
export type NativeSortScope
  = 'all' // 所有可寫資料夾（Chrome 內建根節點自動跳過）
    | 'selected-with-sub' // 我選的資料夾 + 它們裡面全部子資料夾
    | 'children-only' // 只排我選的資料夾裡面的子資料夾（本身不動）

export interface NativeBookmarkSortSettings {
  /** 是否在设置页显示入口；关闭后不再渲染排序 Tab */
  enabled: boolean
  /** 启用后，每次新建或改名书签自动把其所在文件夹重排 */
  autoSort: boolean
  /** 多欄位排序鏈；依序 fallback，最後用原始 index 當穩定排序 tiebreaker */
  sortCriteria: Array<{
    field: 'title' | 'url' | 'dateAdded' | 'dateLastUsed'
    direction: 'asc' | 'desc'
  }>
  /** 範圍三選一（讀舊版時從 targetMode + includeSubfolders 推導） */
  scope?: NativeSortScope
  /** 同時排序目標資料夾本身；false 時只遞迴子資料夾（獨立於 scope） */
  sortSelf: boolean
  /** 只排这些文件夹 id（scope !== 'all' 时生效） */
  targetFolderIds: string[]
  /** 永遠不排這些資料夾（黑名單，不管什麼 scope 都會排除） */
  ignoreFolderIds: string[]
  /** @deprecated 改用 scope；保留是為了舊版升級時不壞 */
  includeSubfolders?: boolean
  /** @deprecated 改用 scope；保留是為了舊版升級時不壞 */
  targetMode?: 'all' | 'selected'
}

export interface GistBackupSettings {
  /** GitHub personal access token（需有 gist 權限） */
  token: string
  /** 已建立的 gist 識別碼；首次上傳後填入 */
  gistId: string
  /** 上傳前是否先在本機加密 */
  encrypt: boolean
  /** 本機加密密碼；僅在 encrypt 為 true 時使用 */
  passphrase: string
}

export interface Settings {
  headerWidget: HeaderWidgetSettings
  bookmarkGroupsEnabled: boolean
  /** 界面语言 */
  language: Language
  theme: ThemeMode
  /** 打开主页时默认展示的分类目录 */
  defaultCategoryId: string
  /** 是否复用已打开的 Moorread 主页标签 */
  singleHomeTab: boolean
  /** 是否允许浏览器全局命令在任意页面打开书签搜索 */
  globalCommandPaletteEnabled: boolean
  /** 手动同步描述时禁止访问的域名，包含其所有子域名 */
  descriptionIgnoredDomains: string[]
  /** 用户自定义搜索引擎，随设置同步 */
  customSearchEngines: SearchEngine[]
  /** 是否隐藏首次整理入口 */
  onboardingDismissed?: boolean
  bookmarkSortMode: BookmarkSortMode
  bookmarkViewMode: BookmarkViewMode
  appearance: AppearanceSettings
  savedSearches: SavedSearch[]
  metadataSyncScope: MetadataSyncScope
  metadataSyncEncryptionEnabled: boolean
  autoOrganizeRules: AutoOrganizeRule[]
  /** 儲存書籤時是否自動套用整理規則（規則不為空時生效） */
  autoOrganizeOnSave: boolean
  keyboardShortcuts: KeyboardShortcuts
  /** Chrome 原生书签批量排序（功能設計受 Sortmark 啟發） */
  nativeBookmarkSort: NativeBookmarkSortSettings
  /** GitHub Gist 備份設定 */
  gistBackup: GistBackupSettings
}
