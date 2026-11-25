import type { Language } from './types'

export type CommandPaletteMessageKey = keyof typeof zhTW
type CommandPaletteMessages = Record<CommandPaletteMessageKey, string>

const zhTW = {
  commandGroupBookmarks: '書籤',
  commandGroupFolders: '資料夾',
  commandGroupActions: '操作',
  commandGroupTheme: '主題',
  clearCurrentSearch: '清除目前搜尋',
  switchToLightTheme: '切換到淺色主題',
  switchToDarkTheme: '切換到深色主題',
  followSystemTheme: '主題跟隨系統',
  currentTheme: '目前主題',
  commandAddBookmarkKeywords: '新增 加入 書籤 bookmark add new',
  commandHealthKeywords: '健康 檢查 重複 失效 重新導向 health duplicate broken redirect',
  commandClearSearchKeywords: '清除 搜尋 reset clear search',
  commandLightThemeKeywords: '淺色 亮色 light theme',
  commandDarkThemeKeywords: '深色 暗色 dark theme',
  commandSystemThemeKeywords: '系統 自動 system theme',
  commandPalette: '命令面板',
  commandPaletteDescription: '搜尋並執行 Moorread 操作。',
  commandPalettePlaceholder: '搜尋書籤、資料夾和操作，支援 tag: / site: / folder:',
  noMatchingCommands: '沒有相符的命令',
}

const en: CommandPaletteMessages = {
  commandGroupBookmarks: 'Bookmarks',
  commandGroupFolders: 'Folders',
  commandGroupActions: 'Actions',
  commandGroupTheme: 'Theme',
  clearCurrentSearch: 'Clear current search',
  switchToLightTheme: 'Switch to light theme',
  switchToDarkTheme: 'Switch to dark theme',
  followSystemTheme: 'Follow system theme',
  currentTheme: 'Current theme',
  commandAddBookmarkKeywords: 'add new bookmark',
  commandHealthKeywords: 'health check duplicate broken redirect',
  commandClearSearchKeywords: 'reset clear search',
  commandLightThemeKeywords: 'light bright theme',
  commandDarkThemeKeywords: 'dark theme',
  commandSystemThemeKeywords: 'system automatic theme',
  commandPalette: 'Command palette',
  commandPaletteDescription: 'Search for and run Moorread actions.',
  commandPalettePlaceholder: 'Search bookmarks, folders, and actions. Supports tag: / site: / folder:',
  noMatchingCommands: 'No matching commands',
}

export const commandPaletteMessages: Record<Language, CommandPaletteMessages> = {
  'zh-TW': zhTW,
  en,
}
