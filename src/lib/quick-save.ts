import type { Bookmark, BookmarkMeta, Category, CategoryMeta } from './types'
import { loadBookmarkTreeData } from './bookmark-tree'
import { canonicalizeBookmarkUrl, normalizeBookmarkUrl } from './bookmark-urls'
import { LocalizedError } from './localized-error'
import { createStoragePort } from './storage-port'

export const quickSaveCategoryKey = 'moorread:quick-save-category'
export const quickSaveBookmarkMessage = 'moorread:quick-save-bookmark'

const categoryMetaStorageKey = 'moorread:category-meta'
const quickSaveStorage = createStoragePort('local')

export interface CurrentPage {
  title: string
  url: string
}

export interface QuickSaveBookmarkInput {
  name: string
  url: string
  categoryId: string
  tags: string[]
  inboxAt: number
}

export interface QuickSaveData {
  bookmarks: Bookmark[]
  categories: Category[]
}

export async function loadQuickSaveData(): Promise<QuickSaveData> {
  const [{ bookmarks, categories }, categoryMeta] = await Promise.all([
    loadBookmarkTreeData(),
    quickSaveStorage.get<Record<string, CategoryMeta>>(categoryMetaStorageKey),
  ])
  return {
    bookmarks,
    categories: categories.map(category => ({
      ...category,
      emoji: categoryMeta?.[category.id]?.emoji ?? category.emoji,
    })),
  }
}

export async function saveQuickBookmark(
  bookmark: QuickSaveBookmarkInput,
): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: quickSaveBookmarkMessage,
    bookmark,
  })
  if (!response?.ok) {
    throw new LocalizedError(
      response?.errorKey ?? 'runtimeQuickSaveFailed',
      response?.params,
    )
  }
}

export function getDuplicateBookmark<T extends Pick<Bookmark, 'url'>>(
  bookmarks: T[],
  url: string,
): T | undefined {
  const candidate = canonicalizeBookmarkUrl(url)
  if (!candidate)
    return undefined
  return bookmarks.find(bookmark => canonicalizeBookmarkUrl(bookmark.url) === candidate)
}

export function currentPageFromTab(
  tab: Pick<chrome.tabs.Tab, 'title' | 'url'> | undefined,
): CurrentPage | null {
  const url = normalizeBookmarkUrl(tab?.url ?? '')
  if (!url)
    return null
  return {
    title: tab?.title?.trim() || new URL(url).hostname,
    url,
  }
}

export interface SaveParentResolver {
  getNode: (nodeId: string) => Promise<Pick<chrome.bookmarks.BookmarkTreeNode, 'id' | 'url'> | undefined>
  /** 未指定分類或選「全部書籤」時的儲存位置（呼叫端決定：記住的資料夾或 Inbox）。 */
  fallbackParentId: () => Promise<string>
  reportFallback?: (cause: unknown) => void
}

/**
 * 把命令面板／快速儲存送來的分類 ID 解析成 chrome.bookmarks 可用的實際資料夾 ID。
 * - `cat-<nativeId>`：正式分類，去掉前綴後仍必須存在且是資料夾。
 * - `all`（全部書籤）與空值：虛擬檢視不是資料夾，改用呼叫端的預設儲存位置。
 * - 不存在的分類：回退 Inbox（'1'）並回報，虛擬 ID 絕不傳給 Chrome API。
 */
export async function resolveSaveParentId(
  categoryId: unknown,
  resolver: SaveParentResolver,
): Promise<string> {
  if (typeof categoryId !== 'string' || !categoryId || categoryId === 'all')
    return resolver.fallbackParentId()
  const nodeId = categoryId.replace(/^cat-/, '')
  try {
    const node = await resolver.getNode(nodeId)
    if (node && !node.url)
      return nodeId
  }
  catch (cause) {
    resolver.reportFallback?.(cause)
  }
  return '1'
}

/** 書籤列的原生節點 ID：Inbox 的實體落點，但「在不在 Inbox」只看 `inboxAt`，不看 parentId。 */
export const inboxParentId = '1'

export interface ResolvedSaveTarget {
  parentId: string
  isInbox: boolean
}

export interface NewBookmarkParentResolver {
  getNode: (nodeId: string) => Promise<Pick<chrome.bookmarks.BookmarkTreeNode, 'id' | 'url'> | undefined>
  /** `all`（未指定）時要向後端讀取正式預設分類並解析。 */
  resolveDefaultTarget: () => Promise<ResolvedSaveTarget>
  reportFallback?: (cause: unknown) => void
}

/**
 * 三值分類語意（`all`／`inbox`／`cat-X`）先分派再解析，且**各自獨立分支**，
 * 不得把 `'inbox'` 與 `'all'` 併成同一支（否則收件匣會跟著預設分類跑掉）。
 * - `inbox`：明確選收件匣 → 落點書籤列並標記 Inbox。
 * - `all`：未指定 → 跟隨 `settings.defaultCategoryId`。
 * - `cat-X`：明確選資料夾 → 只進該資料夾，不算 Inbox（`cat-1` 也是普通資料夾）。
 * - 其他虛擬 ID／缺值／解析失敗：安全回退 Inbox 並回報。
 */
export async function resolveSaveTarget(
  categoryId: unknown,
  resolver: NewBookmarkParentResolver,
): Promise<ResolvedSaveTarget> {
  if (categoryId === 'inbox')
    return { parentId: inboxParentId, isInbox: true }
  if (categoryId === 'all')
    return resolver.resolveDefaultTarget()
  if (typeof categoryId !== 'string' || !categoryId)
    return { parentId: inboxParentId, isInbox: true }
  const nodeId = categoryId.replace(/^cat-/, '')
  try {
    const node = await resolver.getNode(nodeId)
    if (node && !node.url)
      return { parentId: nodeId, isInbox: false }
  }
  catch (cause) {
    resolver.reportFallback?.(cause)
  }
  return { parentId: inboxParentId, isInbox: true }
}

/**
 * 解析 `settings.defaultCategoryId`。
 * 不重用 `resolveSaveParentId`：它把「有效 `cat-1`」與「無效分類回退 `'1'`」都回成 `'1'`，
 * 無法區分 `cat-1` 與 Inbox，因此這裡自己查節點。
 */
export async function resolveDefaultTargetFromSetting(
  defaultCategoryId: unknown,
  resolver: Pick<NewBookmarkParentResolver, 'getNode' | 'reportFallback'>,
): Promise<ResolvedSaveTarget> {
  if (
    typeof defaultCategoryId !== 'string'
    || !defaultCategoryId
    || defaultCategoryId === 'inbox'
    || defaultCategoryId === 'all'
  ) {
    return { parentId: inboxParentId, isInbox: true }
  }
  const nodeId = defaultCategoryId.replace(/^cat-/, '')
  try {
    const node = await resolver.getNode(nodeId)
    if (node && !node.url)
      return { parentId: nodeId, isInbox: false }
  }
  catch (cause) {
    resolver.reportFallback?.(cause)
  }
  return { parentId: inboxParentId, isInbox: true }
}

/**
 * 命令面板「切換預設分類」要寫回的正式值。
 * 舊版以空字串代表收件匣（`'' || 'all'` 是 bug 來源），這裡改寫成正式值 `'inbox'`；
 * 非字串才視為未指定 `'all'`。UI 記憶分類不得經此寫入正式設定。
 */
export function resolveDefaultCategoryForSwitch(raw: unknown): string {
  if (typeof raw !== 'string')
    return 'all'
  if (!raw)
    return 'inbox'
  return raw
}

const savedMetaTagLimit = 12

export interface SavedBookmarkMetaInput {
  tags?: string[]
  requestedInboxAt?: number
}

/** 與既有 `setBookmarkMeta` 相同的空 entry 判定，避免留下只有空物件的 URL 記錄。 */
function hasBookmarkMetaContent(meta: BookmarkMeta): boolean {
  return Boolean(
    meta.description
    || meta.icon
    || meta.alternateUrls?.length
    || meta.pinnedAt
    || meta.tags?.length
    || meta.inboxAt,
  )
}

function normalizeSavedTags(tags: string[] | undefined): string[] | undefined {
  if (!tags?.length)
    return undefined
  const normalized = [...new Set(
    tags.flatMap((tag) => {
      const trimmed = tag.trim()
      return trimmed ? [trimmed] : []
    }),
  )].slice(0, savedMetaTagLimit)
  return normalized.length > 0 ? normalized : undefined
}

/**
 * 儲存後的 metadata：**只有實際落在 Inbox 才寫 `inboxAt`**，
 * 明確指定分類時必須刪除，否則會同時出現在分類與收件匣（重複書籤／重複收件匣項目的根因）。
 */
export function nextBookmarkMetaAfterSave(
  existing: BookmarkMeta | undefined,
  isInbox: boolean,
  input: SavedBookmarkMetaInput,
  now: number = Date.now(),
): BookmarkMeta | undefined {
  const next: BookmarkMeta = { ...(existing ?? {}) }
  if (isInbox) {
    next.inboxAt = input.requestedInboxAt !== undefined && input.requestedInboxAt > 0
      ? input.requestedInboxAt
      : now
  }
  else {
    delete next.inboxAt
  }
  if (input.tags !== undefined) {
    const tags = normalizeSavedTags(input.tags)
    if (tags)
      next.tags = tags
    else
      delete next.tags
  }
  return hasBookmarkMetaContent(next) ? next : undefined
}

export interface SaveBookmarkWithInboxSemanticsInput {
  url: string
  parentId: string
  isInbox: boolean
  tags?: string[]
  requestedInboxAt?: number
}

export interface SaveBookmarkWithInboxSemanticsDeps {
  /** 只需 `id`：`BookmarkTreeNode.parentId` 是否可靠不屬本流程的假設。 */
  createBookmark: (parentId: string) => Promise<{ id: string }>
  persistMeta: (
    update: (latest: Record<string, BookmarkMeta>) => Record<string, BookmarkMeta>,
  ) => Promise<{ written: boolean }>
  now?: () => number
}

export interface SaveBookmarkWithInboxSemanticsResult {
  id: string
  parentId: string
  inboxMarked: boolean
  metaWritten: boolean
}

/**
 * 先建立書籤、再於 metadata 鎖內套用 Inbox 語意。
 * 建立失敗時直接拋出，**不會**留下只有 metadata 的孤兒記錄。
 */
export async function saveBookmarkWithInboxSemantics(
  input: SaveBookmarkWithInboxSemanticsInput,
  deps: SaveBookmarkWithInboxSemanticsDeps,
): Promise<SaveBookmarkWithInboxSemanticsResult> {
  const created = await deps.createBookmark(input.parentId)
  const now = deps.now?.() ?? Date.now()
  const result = await deps.persistMeta((latest) => {
    const next = nextBookmarkMetaAfterSave(
      latest[input.url],
      input.isInbox,
      { tags: input.tags, requestedInboxAt: input.requestedInboxAt },
      now,
    )
    const meta = { ...latest }
    if (next)
      meta[input.url] = next
    else
      delete meta[input.url]
    return meta
  })
  return {
    id: created.id,
    parentId: input.parentId,
    inboxMarked: input.isInbox,
    metaWritten: result.written,
  }
}
