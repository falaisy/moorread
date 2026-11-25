import type { Language } from './types'

export type TabSessionsMessageKey = keyof typeof zhTW
type TabSessionsMessages = Record<TabSessionsMessageKey, string>

const zhTW = {
  tabSessionsDescription: '儲存目前視窗，並在需要時還原選取的網頁。',
  noSavableTabs: '目前視窗沒有可儲存的網頁分頁',
  defaultSessionName: '工作階段 {date}',
  savedTabCount: '已儲存 {count} 個去重分頁',
  saveSessionFailed: '儲存工作階段失敗，請確認分頁權限可用',
  noTabsForUpdate: '目前視窗沒有可用於更新的網頁分頁',
  updatedNamedSession: '已更新「{name}」',
  selectAtLeastOneTab: '請至少選擇一個分頁',
  restoredTabCount: '已還原 {count} 個分頁',
  someTabsRestoreFailed: '部分分頁無法還原',
  optionalSessionName: '工作階段名稱（選填）',
  saveWindow: '儲存視窗',
  excludePinnedTabs: '排除固定分頁',
  restoreToNewWindow: '還原到新視窗',
  noSavedSessions: '尚未儲存工作階段',
  collapseNamedSession: '收合工作階段 {name}',
  expandNamedSession: '展開工作階段 {name}',
  sessionTabCountAndDate: '{count} 個分頁 · {date}',
  updateFromCurrentWindow: '使用目前視窗更新',
  updateNamedSession: '更新工作階段 {name}',
  restoreSession: '還原工作階段',
  restoreNamedSession: '還原工作階段 {name}',
  deleteSession: '刪除工作階段',
  deleteNamedSession: '刪除工作階段 {name}',
}

const en: TabSessionsMessages = {
  tabSessionsDescription: 'Save the current window and restore selected pages when needed.',
  noSavableTabs: 'The current window has no web tabs to save',
  defaultSessionName: 'Session {date}',
  savedTabCount: 'Saved {count} unique tabs',
  saveSessionFailed: 'Could not save the session. Check the tab permission.',
  noTabsForUpdate: 'The current window has no web tabs to use for this update',
  updatedNamedSession: 'Updated “{name}”',
  selectAtLeastOneTab: 'Select at least one tab',
  restoredTabCount: 'Restored {count} tabs',
  someTabsRestoreFailed: 'Some tabs could not be restored',
  optionalSessionName: 'Session name (optional)',
  saveWindow: 'Save window',
  excludePinnedTabs: 'Exclude pinned tabs',
  restoreToNewWindow: 'Restore in a new window',
  noSavedSessions: 'No saved sessions yet',
  collapseNamedSession: 'Collapse session {name}',
  expandNamedSession: 'Expand session {name}',
  sessionTabCountAndDate: '{count} tabs · {date}',
  updateFromCurrentWindow: 'Update from current window',
  updateNamedSession: 'Update session {name}',
  restoreSession: 'Restore session',
  restoreNamedSession: 'Restore session {name}',
  deleteSession: 'Delete session',
  deleteNamedSession: 'Delete session {name}',
}

export const tabSessionsMessages: Record<Language, TabSessionsMessages> = {
  'zh-TW': zhTW,
  en,
}
