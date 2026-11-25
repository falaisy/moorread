import type { BookmarkSearchEntry } from './bookmark-search'
import type { Bookmark, Category } from './types'
import {
  bookmarkSearchEntryScoreCompiled,
  categorySearchScore,
  compileBookmarkSearchQuery,
} from './bookmark-search'

export interface SearchBarBookmarkResult {
  kind: 'bookmark'
  id: string
  score: number
  bookmark: Bookmark
  /** 書籤所在資料夾的完整路徑；資料夾不存在（missing folder）時為空字串。 */
  path: string
}

export interface SearchBarFolderResult {
  kind: 'folder'
  id: string
  score: number
  category: Category
  /** 由上而下的完整資料夾路徑，例如 ['A', 'B', 'C']。 */
  path: string[]
}

export type SearchBarResultItem = SearchBarBookmarkResult | SearchBarFolderResult

export interface SearchBarResults {
  /** 書籤區，已依分數排序並套用上限。 */
  bookmarks: SearchBarBookmarkResult[]
  /** 資料夾區，已依分數排序並套用上限。 */
  folders: SearchBarFolderResult[]
  /** 兩區合併後的扁平順序（書籤在前、資料夾在後），供鍵盤上下移動使用。 */
  items: SearchBarResultItem[]
}

export const SEARCH_BAR_BOOKMARK_LIMIT = 5
export const SEARCH_BAR_FOLDER_LIMIT = 5

export const EMPTY_SEARCH_BAR_RESULTS: SearchBarResults = {
  bookmarks: [],
  folders: [],
  items: [],
}

export interface SearchBarResultsInput {
  query: string
  /** 由 createBookmarkSearchEntry 建好的索引，呼叫端負責快取重用。 */
  entries: readonly BookmarkSearchEntry[]
  categories: readonly Category[]
  categoryPathMap: ReadonlyMap<string, string[]>
  bookmarkLimit?: number
  folderLimit?: number
}

/**
 * 同一份書籤索引同時產生「書籤」與「資料夾」兩區結果：
 * 沿用既有 compileBookmarkSearchQuery / bookmarkSearchEntryScoreCompiled /
 * categorySearchScore，不建立第二套搜尋引擎。
 */
export function buildSearchBarResults({
  query,
  entries,
  categories,
  categoryPathMap,
  bookmarkLimit = SEARCH_BAR_BOOKMARK_LIMIT,
  folderLimit = SEARCH_BAR_FOLDER_LIMIT,
}: SearchBarResultsInput): SearchBarResults {
  const trimmed = query.trim()
  if (!trimmed)
    return EMPTY_SEARCH_BAR_RESULTS

  const compiled = compileBookmarkSearchQuery(trimmed)
  const bookmarks: SearchBarBookmarkResult[] = []
  for (const entry of entries) {
    const score = bookmarkSearchEntryScoreCompiled(entry, compiled)
    if (score < 0)
      continue
    bookmarks.push({
      kind: 'bookmark',
      id: `bookmark:${entry.bookmark.id}`,
      score,
      bookmark: entry.bookmark,
      path: entry.categoryPathLabel,
    })
  }
  bookmarks.sort(
    (left, right) =>
      right.score - left.score
      || (right.bookmark.pinnedAt ?? 0) - (left.bookmark.pinnedAt ?? 0),
  )

  const folders: SearchBarFolderResult[] = []
  for (const category of categories) {
    const path = categoryPathMap.get(category.id) ?? [category.name]
    const score = categorySearchScore(category, trimmed, path)
    if (score < 0)
      continue
    folders.push({
      kind: 'folder',
      id: `folder:${category.id}`,
      score,
      category,
      path,
    })
  }
  folders.sort((left, right) => right.score - left.score)

  const limitedBookmarks = bookmarks.slice(0, bookmarkLimit)
  const limitedFolders = folders.slice(0, folderLimit)
  return {
    bookmarks: limitedBookmarks,
    folders: limitedFolders,
    items: [...limitedBookmarks, ...limitedFolders],
  }
}
