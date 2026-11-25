import type { Language } from './types'

const zhTW = {
  chromeSyncTitle: 'Chrome 書籤同步',
  chromeSyncImport: '從 Chrome 書籤匯入',
  chromeSyncExport: '匯出到 Chrome 書籤',
  chromeSyncImporting: '正在讀取 Chrome 書籤…',
  chromeSyncExporting: '正在寫入 Chrome 書籤…',
  chromeSyncImportedCount: '已匯入 {added} 個書籤（跳過 {skipped} 個已存在）',
  chromeSyncExportedCount: '已在 Chrome 建立 {created} 個書籤',
  chromeSyncExportFolderHint: '匯出目標資料夾：「Moorread 匯出」',
  chromeSyncErrorPermission: '無法存取 Chrome 書籤 API。',
}

type ChromeSyncMessages = Record<keyof typeof zhTW, string>

const en: ChromeSyncMessages = {
  chromeSyncTitle: 'Chrome bookmark sync',
  chromeSyncImport: 'Import from Chrome bookmarks',
  chromeSyncExport: 'Export to Chrome bookmarks',
  chromeSyncImporting: 'Reading Chrome bookmarks…',
  chromeSyncExporting: 'Writing Chrome bookmarks…',
  chromeSyncImportedCount: 'Imported {added} bookmarks ({skipped} already existed)',
  chromeSyncExportedCount: 'Created {created} bookmarks in Chrome',
  chromeSyncExportFolderHint: 'Export target folder: “Moorread Export”',
  chromeSyncErrorPermission: 'Cannot access the Chrome bookmarks API.',
}

export const chromeSyncMessages: Record<Language, ChromeSyncMessages> = {
  'zh-TW': zhTW,
  en,
}
