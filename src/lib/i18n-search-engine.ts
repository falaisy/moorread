import type { Language } from './types'

export type SearchEngineMessageKey = keyof typeof zhTW
type SearchEngineMessages = Record<SearchEngineMessageKey, string>

const zhTW = {
  saveSearchEngineFailed: '儲存搜尋引擎失敗',
  deleteSearchEngineFailed: '刪除搜尋引擎失敗',
  searchEngines: '搜尋引擎',
  browserDefaultSearchEngine: '瀏覽器預設',
  editNamed: '編輯 {name}',
  editNamedSearchEngine: '編輯搜尋引擎 {name}',
  deleteNamed: '刪除 {name}',
  deleteNamedSearchEngine: '刪除搜尋引擎 {name}',
  searchEngineName: '搜尋引擎名稱',
  searchEngineKeyword: '搜尋引擎關鍵字',
  searchEngineIcon: '搜尋引擎圖示',
  keyword: '關鍵字',
  icon: '圖示',
  searchUrlTemplate: '搜尋網址範本',
  saving: '儲存中',
  deleteSearchEngineTitle: '刪除「{name}」？',
  deleteSearchEngineDescription: '此搜尋引擎及其關鍵字將從同步設定中刪除。',
  confirmDelete: '確認刪除',
}

const en: SearchEngineMessages = {
  saveSearchEngineFailed: 'Could not save the search engine',
  deleteSearchEngineFailed: 'Could not delete the search engine',
  searchEngines: 'Search engines',
  browserDefaultSearchEngine: 'Browser default',
  editNamed: 'Edit {name}',
  editNamedSearchEngine: 'Edit search engine {name}',
  deleteNamed: 'Delete {name}',
  deleteNamedSearchEngine: 'Delete search engine {name}',
  searchEngineName: 'Search engine name',
  searchEngineKeyword: 'Search engine keyword',
  searchEngineIcon: 'Search engine icon',
  keyword: 'Keyword',
  icon: 'Icon',
  searchUrlTemplate: 'Search address template',
  saving: 'Saving',
  deleteSearchEngineTitle: 'Delete “{name}”?',
  deleteSearchEngineDescription: 'This search engine and its keyword will be removed from synced settings.',
  confirmDelete: 'Confirm delete',
}

export const searchEngineMessages: Record<Language, SearchEngineMessages> = {
  'zh-TW': zhTW,
  en,
}
