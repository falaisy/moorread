import type { BookmarkTreeNode } from './bookmark-tree'

/** Chrome 根節點 id（不可寫，只能在其子節點下建立） */
const ROOT_IDS = new Set(['0', '1', '2'])

/** 匯出目標資料夾的預設名稱（Chrome 原生書籤資料夾名稱，非 UI copy） */
export const EXPORT_FOLDER_TITLE = 'Moorread Export'

/** 暫存 Moorread 書籤最小必要欄位（僅匯入/匯出所需） */
export interface MinimalBookmarkRef {
  url: string
  name: string
}

/** 匯入後的候選項目（不含 id，由呼叫端決定如何新增到 store） */
export interface ChromeBookmarkCandidate {
  url: string
  name: string
  dateAdded?: number
}

/** 產生比對用的 canonical key（url 忽略 trailing slash、title trim 後小寫） */
function canonicalKey(url: string, title: string): string {
  const trimmed = url.trim().replace(/\/+$/, '').toLowerCase()
  return `${trimmed}||${title.trim().toLowerCase()}`
}

/** 遞迴扁平化書籤樹，僅收集有 url 的真正書籤節點 */
function flattenBookmarks(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  const result: BookmarkTreeNode[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.url)
      result.push(node)
    if (node.children?.length)
      stack.push(...node.children)
  }
  return result
}

/** 遞迴在樹中找符合 title 的第一個資料夾（從根節點開始） */
function findFolderByTitle(
  nodes: BookmarkTreeNode[],
  title: string,
): BookmarkTreeNode | undefined {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (!node.url && node.title.trim() === title.trim())
      return node
    if (node.children?.length)
      stack.push(...node.children)
  }
  return undefined
}

/**
 * 從 Chrome 原生書籤匯入到 Moorread。
 *
 * 比對維度：url（忽略 trailing slash + 小寫化）+ title（trim + 小寫化）。
 * 已存在的項目會被跳過，不寫入重複資料。
 *
 * 回傳候選項目清單與統計；實際寫入 store 由呼叫端決定。
 */
export async function importFromChromeBookmarks(
  existingBookmarks: MinimalBookmarkRef[],
): Promise<{
  items: ChromeBookmarkCandidate[]
  added: number
  skipped: number
}> {
  const tree = await chrome.bookmarks.getTree()
  const chromeBookmarks = flattenBookmarks(tree)

  const existingKeys = new Set(
    existingBookmarks.map(b => canonicalKey(b.url, b.name)),
  )

  const items: ChromeBookmarkCandidate[] = []
  let skipped = 0
  for (const node of chromeBookmarks) {
    const title = node.title ?? ''
    const key = canonicalKey(node.url, title)
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    existingKeys.add(key) // 同一批次內也去重
    items.push({
      url: node.url,
      name: title,
      dateAdded: node.dateAdded,
    })
  }

  return { items, added: items.length, skipped }
}

/** 找既有匯出資料夾，不存在則在 Other bookmarks 下建立 */
async function resolveExportFolder(title: string): Promise<BookmarkTreeNode> {
  const tree = await chrome.bookmarks.getTree()
  const existing = findFolderByTitle(tree, title)
  if (existing)
    return existing

  // 不可在根節點本身建立子資料夾，只能在可寫的根節點（id='1' Other bookmarks）下建
  const otherRoot = tree[0]?.children?.find(node => node.id === '1')
  const parentId = otherRoot?.id ?? '1'

  return await chrome.bookmarks.create({
    parentId,
    title,
  }) as BookmarkTreeNode
}

/**
 * 將 Moorread 書籤匯出到 Chrome 原生書籤的一個子資料夾。
 *
 * - 會在 Other bookmarks 下建立（或重用）「Moorread 匯出」資料夾
 * - 資料夾內既有書籤以 url 為 key 去重，不會重複建立
 */
export async function exportToChromeBookmarks(
  bookmarks: MinimalBookmarkRef[],
  folderTitle: string = EXPORT_FOLDER_TITLE,
): Promise<{ created: number }> {
  if (ROOT_IDS.has(folderTitle)) {
    // 預防：不要讓呼叫端把資料夾建到根節點 id
    throw new Error(`invalid folder id: ${folderTitle}`)
  }

  const folder = await resolveExportFolder(folderTitle)

  // 讀取資料夾現有書籤的 url set 以去重
  const children = await chrome.bookmarks.getChildren(folder.id)
  const existingUrls = new Set(
    children
      .filter(child => Boolean(child.url))
      .map(child => child.url!.trim().replace(/\/+$/, '').toLowerCase()),
  )

  let created = 0
  for (const bookmark of bookmarks) {
    const normalizedUrl = bookmark.url.trim().replace(/\/+$/, '').toLowerCase()
    if (!normalizedUrl || existingUrls.has(normalizedUrl))
      continue

    try {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: bookmark.name || bookmark.url,
        url: bookmark.url,
      })
      existingUrls.add(normalizedUrl)
      created++
    }
    catch {
      // 單一失敗不影響整批；延後再處理
    }
  }

  return { created }
}
