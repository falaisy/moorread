import type { Language } from './types'

const zhTW = {
  nativeSort: '瀏覽器書籤排序',
  nativeSortDescription:
    '打開後，瀏覽器裡所有書籤的順序會被照你設的規則自動排好。',
  nativeSortEnable: '開啟瀏覽器書籤排序',
  nativeSortEnableDescription:
    '關掉就不會再動你的書籤順序了，但之前排好的不會自動還原。',
  nativeSortAutoSort: '自動重排（每次新增/改名/移動後自動排一次）',
  nativeSortAutoSortDescription:
    '如果你平常會手動拖書籤調位置，建議關掉——不然每次動一下就會被重排。',
  nativeSortField: '排序依據',
  nativeSortFieldTitle: '標題',
  nativeSortFieldUrl: '網址',
  nativeSortFieldDateAdded: '新增時間',
  nativeSortFieldDateLastUsed: '最近使用時間',
  nativeSortCriteria: '怎麼排',
  nativeSortAddCriterion: '再加一項',
  nativeSortRemoveCriterion: '移除這個',
  nativeSortCriteriaHint:
    '兩本書籤第一項比不出結果時才用第二項。最多 {max} 個。',
  nativeSortDirection: '方向',
  nativeSortDirectionAsc: '升序',
  nativeSortDirectionDesc: '降序',

  // scope 三選一（取代舊的 includeSubfolders + targetMode）
  nativeSortScopeTitle: '排什麼',
  nativeSortScopeAll: '所有資料夾',
  nativeSortScopeAllHint: 'Chrome 內建的根節點（書籤列、其他書籤）自動跳過',
  nativeSortScopeSelectedWithSub: '我選的資料夾 + 它們裡面全部子資料夾',
  nativeSortScopeSelectedWithSubHint: '包括我選的資料夾本身也會被排',
  nativeSortScopeChildrenOnly: '只排我選的資料夾裡面的子資料夾',
  nativeSortScopeChildrenOnlyHint: '我選的資料夾本身不動',

  // sortSelf 獨立開關
  nativeSortSortSelf: '排序目標資料夾本身',
  nativeSortSortSelfDescription:
    '關掉時，頂層選的資料夾不動，但裡面子資料夾照排。',

  // 資料夾選擇
  nativeSortSelectFolders: '選資料夾',
  nativeSortSelectFoldersDescription:
    '展開樹狀結構勾選；Chrome 內建根節點無法寫入，會自動排除。',
  nativeSortSelectedCount: '已選 {count} 個資料夾',
  nativeSortExcludedCount: '已排除 {count} 個資料夾',
  nativeSortNoSelection: '還沒選資料夾',
  nativeSortExcludeFolders: '永不排序的資料夾',
  nativeSortExcludeFoldersDescription:
    '不管上面選哪個範圍，這些資料夾永遠不動。',
  nativeSortSelectAll: '全部展開',
  nativeSortCollapseAll: '全部收合',

  // 執行
  nativeSortRun: '立即執行排序',
  nativeSortRunning: '排序中…',
  nativeSortSuccess:
    '已處理 {folders} 個資料夾，移動 {bookmarks} 個書籤、{movedFolders} 個資料夾。',
  nativeSortPartial:
    '已處理 {folders} 個資料夾，移動 {bookmarks} 個書籤、{movedFolders} 個資料夾；有 {skipped} 個資料夾因無法讀取或寫入而跳過。',
  nativeSortVerifyFailed:
    '排序後重新核對原生順序失敗：有 {folders} 個資料夾的順序仍與目標不符，未完成排序。',
  nativeSortFailed: '排序失敗：{message}',
  nativeSortNoApi: '瀏覽器書籤 API 不可用。',
  nativeSortNothingToDo:
    '沒有符合條件的資料夾，或所有項目已在正確位置。',
  nativeSortWarning:
    '這會直接改變瀏覽器原生書籤的順序，無法復原。確認要執行嗎？',
}

type NativeSortMessages = Record<keyof typeof zhTW, string>

const en: NativeSortMessages = {
  nativeSort: 'Browser bookmark sort',
  nativeSortDescription:
    'When enabled, all bookmarks in your browser will be reordered by the rules you set.',
  nativeSortEnable: 'Enable browser bookmark sort',
  nativeSortEnableDescription:
    'Turning this off stops future sorting. Previously applied order is not reverted.',
  nativeSortAutoSort: 'Auto re-sort after add / rename / move',
  nativeSortAutoSortDescription:
    'Turn off if you manually drag bookmarks to adjust order—otherwise they get re-sorted every time you touch them.',
  nativeSortField: 'Sort by',
  nativeSortFieldTitle: 'Title',
  nativeSortFieldUrl: 'URL',
  nativeSortFieldDateAdded: 'Added date',
  nativeSortFieldDateLastUsed: 'Last used',
  nativeSortCriteria: 'How to sort',
  nativeSortAddCriterion: 'Add another',
  nativeSortRemoveCriterion: 'Remove',
  nativeSortCriteriaHint:
    'Only used when the previous criterion ties. Up to {max}.',
  nativeSortDirection: 'Order',
  nativeSortDirectionAsc: 'Ascending',
  nativeSortDirectionDesc: 'Descending',

  nativeSortScopeTitle: 'What to sort',
  nativeSortScopeAll: 'All folders',
  nativeSortScopeAllHint: 'Built-in Chrome roots (Bookmarks Bar, Other Bookmarks) are skipped automatically',
  nativeSortScopeSelectedWithSub: 'Folders I pick + all their subfolders',
  nativeSortScopeSelectedWithSubHint: 'Includes the folders I pick themselves',
  nativeSortScopeChildrenOnly: 'Only subfolders inside folders I pick',
  nativeSortScopeChildrenOnlyHint: 'The folders I pick themselves stay untouched',

  nativeSortSortSelf: 'Sort target folders themselves',
  nativeSortSortSelfDescription:
    'When off, the top-level folders stay untouched but their children still get sorted.',

  nativeSortSelectFolders: 'Pick folders',
  nativeSortSelectFoldersDescription:
    'Expand the tree and tick folders you want. Built-in Chrome roots are read-only and skipped automatically.',
  nativeSortSelectedCount: '{count} folder(s) selected',
  nativeSortExcludedCount: '{count} folder(s) excluded',
  nativeSortNoSelection: 'No folders selected yet',
  nativeSortExcludeFolders: 'Never-sort folders',
  nativeSortExcludeFoldersDescription:
    'These folders stay untouched no matter what scope you pick above.',
  nativeSortSelectAll: 'Expand all',
  nativeSortCollapseAll: 'Collapse all',

  nativeSortRun: 'Run sort now',
  nativeSortRunning: 'Sorting…',
  nativeSortSuccess:
    'Processed {folders} folders, moved {bookmarks} bookmarks and {movedFolders} folders.',
  nativeSortPartial:
    'Processed {folders} folders, moved {bookmarks} bookmarks and {movedFolders} folders; {skipped} folders were skipped because they could not be read or written.',
  nativeSortVerifyFailed:
    'Order verification failed after sorting: {folders} folders still do not match the target order.',
  nativeSortFailed: 'Sort failed: {message}',
  nativeSortNoApi: 'Browser bookmarks API is unavailable.',
  nativeSortNothingToDo:
    'No folders match, or every item is already in its correct position.',
  nativeSortWarning:
    'This directly reorders your browser’s native bookmarks and cannot be undone. Continue?',
}

export const nativeSortMessages: Record<Language, NativeSortMessages> = {
  'zh-TW': zhTW,
  en,
}
