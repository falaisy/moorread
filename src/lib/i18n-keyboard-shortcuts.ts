import type { Language } from './types'

export type KeyboardShortcutMessageKey = keyof typeof zhTW
type KeyboardShortcutMessages = Record<KeyboardShortcutMessageKey, string>

const zhTW = {
  keyboardShortcuts: '快速鍵',
  keyboardShortcutsDescription:
    '自訂首頁中的常用操作。方向鍵、Enter 與 Esc 保留為標準導覽鍵。',
  focusSearchShortcut: '聚焦搜尋',
  focusSearchShortcutDescription: '將焦點移至頂部搜尋框。',
  openCommandPaletteShortcut: '開啟命令面板',
  openCommandPaletteShortcutDescription: '搜尋書籤並快速執行常用操作。',
  addBookmarkShortcut: '新增書籤',
  addBookmarkShortcutDescription: '開啟新增書籤視窗。',
  recordShortcut: '修改',
  pressShortcut: '按下新快速鍵',
  recordingShortcutHint: '按下新快速鍵，按 Esc 取消。',
  resetShortcuts: '恢復預設',
  shortcutConflict: '此快速鍵已由「{action}」使用。',
  shortcutReserved: '此按鍵用於瀏覽器或頁面導覽，請改用其他按鍵。',
  shortcutUnsupported: '請按下包含字母、數字或符號的快速鍵。',
  browserManagedShortcuts: '瀏覽器快速鍵',
  browserManagedShortcutsDescription:
    '這些按鍵綁定由瀏覽器管理。全域命令面板需先啟用，快速收藏始終可用。',
  globalCommandPaletteEnabled: '啟用全域快速搜尋',
  globalCommandPaletteEnabledDescription:
    '啟用後，請在瀏覽器快速鍵設定中指派按鍵；首頁快速鍵不受影響。',
  globalCommandPaletteShortcut: '全域命令面板',
  quickSaveCurrentPageShortcut: '快速收藏目前頁面',
  shortcutLoading: '正在讀取…',
  shortcutNotAssigned: '未指派',
  shortcutUnavailable: '無法讀取',
  browserShortcutSettingsAddress: '瀏覽器快速鍵設定網址',
  openBrowserShortcutSettings: '前往瀏覽器修改',
  browserShortcutFindExtensionHint: '開啟後請在清單中找到「{name}」。',
  openBrowserShortcutSettingsFailed:
    '瀏覽器阻止了自動開啟，請複製網址後手動前往：{url}',
}

const en: KeyboardShortcutMessages = {
  keyboardShortcuts: 'Keyboard shortcuts',
  keyboardShortcutsDescription:
    'Customize common home-page actions. Arrow keys, Enter, and Esc remain standard navigation keys.',
  focusSearchShortcut: 'Focus search',
  focusSearchShortcutDescription: 'Move focus to the search field at the top.',
  openCommandPaletteShortcut: 'Open command palette',
  openCommandPaletteShortcutDescription:
    'Search bookmarks and run common actions quickly.',
  addBookmarkShortcut: 'Add bookmark',
  addBookmarkShortcutDescription: 'Open the add-bookmark dialog.',
  recordShortcut: 'Change',
  pressShortcut: 'Press a new shortcut',
  recordingShortcutHint: 'Press a new shortcut, or press Esc to cancel.',
  resetShortcuts: 'Restore defaults',
  shortcutConflict: 'This shortcut is already used by “{action}”.',
  shortcutReserved:
    'This key is reserved for browser or page navigation. Choose another.',
  shortcutUnsupported:
    'Press a shortcut containing a letter, number, or symbol.',
  browserManagedShortcuts: 'Browser shortcuts',
  browserManagedShortcutsDescription:
    'The browser manages these key bindings. Enable the global palette first; Quick Save is always available.',
  globalCommandPaletteEnabled: 'Enable global shortcut search',
  globalCommandPaletteEnabledDescription:
    'After enabling, assign a key in the browser shortcut settings. The home-page shortcut is unaffected.',
  globalCommandPaletteShortcut: 'Global command palette',
  quickSaveCurrentPageShortcut: 'Quick save current page',
  shortcutLoading: 'Loading…',
  shortcutNotAssigned: 'Not assigned',
  shortcutUnavailable: 'Unavailable',
  browserShortcutSettingsAddress: 'Browser shortcut settings address',
  openBrowserShortcutSettings: 'Change in browser',
  browserShortcutFindExtensionHint:
    'After opening the page, find “{name}” in the list.',
  openBrowserShortcutSettingsFailed:
    'The browser blocked automatic opening. Copy and open this address manually: {url}',
}

export const keyboardShortcutMessages: Record<
  Language,
  KeyboardShortcutMessages
> = {
  'zh-TW': zhTW,
  en,
}
