import type {
  AutoOrganizePatch,
} from '~/lib/auto-organize'
import type { RemoteFaviconResponse } from '~/lib/favicon-messages'
import type {
  Bookmark,
  BookmarkMeta,
  BookmarkUsage,
  Category,
  Language,
  Settings,
} from '~/lib/types'
import {
  autoOrganizeRuleMatches,
  createAutoOrganizePatch,
  readAutoOrganizeSettings,
} from '~/lib/auto-organize'
import { registerBookmarkEvents } from '~/lib/bookmark-events'
import { toNodeId } from '~/lib/bookmark-tree'
import {
  normalizeBookmarkUrl,
  resolveFastestBookmarkUrl,
} from '~/lib/bookmark-urls'
import { reportDiagnostic, reportExpectedFallback } from '~/lib/diagnostics'
import {
  fetchRemoteFaviconMessage,
  isRemoteFaviconUrl,
} from '~/lib/favicon-messages'
import {
  globalPaletteCloseMessage,
  globalPaletteHomeHash,
  globalPaletteOpenBookmarkMessage,
  globalPaletteOpenForTabMessage,
  globalPaletteOpenHomeMessage,
  globalPaletteSavePageMessage,
  globalPaletteSessionKey,
  globalPaletteSessionPrefix,
  globalPaletteSessionTtlMs,
  globalPaletteSwitchCategoryMessage,
  globalPaletteValidateMessage,
  isGlobalPaletteSessionValid,
  openGlobalCommandPaletteCommand,
  toggleGlobalCommandPalette,
} from '~/lib/global-command-palette'
import {
  homeTabReadyMessage,
  homeTabStorageKey,
  openHomeTabMessage,
} from '~/lib/home-tabs'
import { translateRuntime } from '~/lib/i18n-runtime'
import { loadPreferredLanguage } from '~/lib/language'
import { LocalizedError } from '~/lib/localized-error'
import { markLocalMetadataChanged } from '~/lib/metadata-sync'
import { registerNativeSortAutoListener } from '~/lib/native-sort-auto'
import {
  currentPageFromTab,
  getDuplicateBookmark,
  loadQuickSaveData,
  quickSaveBookmarkMessage,
  quickSaveCategoryKey,
  resolveDefaultCategoryForSwitch,
  resolveDefaultTargetFromSetting,
  resolveSaveTarget,
  saveBookmarkWithInboxSemantics,
} from '~/lib/quick-save'
import { createStoragePort, parseStoredRecord } from '~/lib/storage-port'
import {
  persist,
  STORAGE_KEYS,
  updateBookmarkMetadataGuarded,
  withBookmarkUsageLock,
  withSettingsLock,
} from '~/lib/store-persistence'
import { normalizeSettings } from '~/lib/store-settings-state'

const MENU_ID = 'moorread-save-page'
const LEGACY_MENU_ID = 'yunji-tab-save-page'
const HOME_URL = chrome.runtime.getURL('newtab.html')
const FAVICON_FETCH_TIMEOUT_MS = 8_000
const localAreaStorage = createStoragePort('local')
const settingsStorage = createStoragePort('sync')
let homeTabQueue = Promise.resolve()

async function getSelectedLanguage(): Promise<Language> {
  return loadPreferredLanguage(
    () => settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings),
  )
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    )
  }
  return btoa(binary)
}

async function fetchRemoteFavicon(url: unknown): Promise<RemoteFaviconResponse> {
  if (!isRemoteFaviconUrl(url))
    return { ok: false }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    FAVICON_FETCH_TIMEOUT_MS,
  )
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok)
      return { ok: false }
    const blob = await response.blob()
    const validType
      = blob.type.startsWith('image/')
        || blob.type === 'application/octet-stream'
    if (!blob.size || !validType)
      return { ok: false }
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    return {
      ok: true,
      base64: uint8ArrayToBase64(bytes),
      type: blob.type,
    }
  }
  catch (cause) {
    reportExpectedFallback('favicon.fetch', cause)
    return { ok: false }
  }
  finally {
    globalThis.clearTimeout(timeout)
  }
}

function isExtensionHomeUrl(url?: string): boolean {
  if (!url)
    return false

  try {
    const currentUrl = new URL(url)
    const homeUrl = new URL(HOME_URL)
    return currentUrl.origin === homeUrl.origin
      && currentUrl.pathname === homeUrl.pathname
  }
  catch (cause) {
    reportExpectedFallback('home-tab.parse-url', cause)
    return false
  }
}

function isBrowserNewTabUrl(url?: string): boolean {
  return url === 'chrome://newtab/' || url === 'chrome://newtab'
}

function isHomeTab(tab: chrome.tabs.Tab, includeBrowserNewTab: boolean): boolean {
  return isExtensionHomeUrl(tab.url)
    || isExtensionHomeUrl(tab.pendingUrl)
    || (includeBrowserNewTab && (isBrowserNewTabUrl(tab.url) || isBrowserNewTabUrl(tab.pendingUrl)))
}

async function focusHomeTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined)
    return
  await chrome.windows.update(tab.windowId, { focused: true })
  await chrome.tabs.update(tab.id, { active: true })
}

async function registerHomeTab(openedTab?: chrome.tabs.Tab): Promise<void> {
  if (openedTab?.id === undefined)
    return

  const settings = await settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings)
  if (settings?.singleHomeTab !== true) {
    await chrome.storage.session.remove(homeTabStorageKey)
    return
  }

  // Chrome exposes an overridden New Tab page as chrome://newtab/ in real
  // browser windows. Only include those tabs after Moorread itself reports
  // that its page loaded, so another enabled New Tab extension is untouched.
  const includeBrowserNewTab = isBrowserNewTabUrl(openedTab.url)
    || isBrowserNewTabUrl(openedTab.pendingUrl)
  const tabs = await chrome.tabs.query({})
  const homeTabs = tabs
    .filter(tab => isHomeTab(tab, includeBrowserNewTab))
    .sort((left, right) => (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER))

  const existingTab = homeTabs[0] ?? openedTab
  if (existingTab.id === undefined)
    return

  await chrome.storage.session.set({ [homeTabStorageKey]: existingTab.id })
  if (homeTabs.length === 1)
    return

  const duplicateTabIds = homeTabs
    .slice(1)
    .flatMap(tab => tab.id === undefined ? [] : [tab.id])
  await chrome.tabs.remove(duplicateTabIds).catch((cause) => {
    reportExpectedFallback('home-tab.remove-duplicates', cause)
  })
  await focusHomeTab(existingTab).catch((cause) => {
    reportExpectedFallback('home-tab.focus', cause)
  })
}

async function getRegisteredHomeTab(): Promise<chrome.tabs.Tab | undefined> {
  const stored = await chrome.storage.session.get(homeTabStorageKey)
  const tabId = stored[homeTabStorageKey]
  if (typeof tabId !== 'number')
    return undefined

  const tab = await chrome.tabs.get(tabId).catch((cause) => {
    reportExpectedFallback('home-tab.read-registered', cause)
    return undefined
  })
  if (tab && isHomeTab(tab, true))
    return tab

  await chrome.storage.session.remove(homeTabStorageKey)
  return undefined
}

async function openOrFocusHomeTab(openCommandPalette = false): Promise<void> {
  const targetUrl = openCommandPalette
    ? `${HOME_URL}${globalPaletteHomeHash}`
    : HOME_URL
  const settings = await settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings)
  if (settings?.singleHomeTab !== true) {
    await chrome.tabs.create({ url: targetUrl })
    return
  }

  const homeTab = await getRegisteredHomeTab()
  if (homeTab) {
    await focusHomeTab(homeTab)
    if (openCommandPalette && homeTab.id !== undefined)
      await chrome.tabs.update(homeTab.id, { url: targetUrl })
    return
  }
  await chrome.tabs.create({ url: targetUrl })
}

function queueHomeTabTask(task: () => Promise<void>): Promise<void> {
  const result = homeTabQueue.then(task)
  homeTabQueue = result.catch(() => undefined)
  return result
}

function setBadge(text: string, color: string): void {
  void chrome.action.setBadgeBackgroundColor({ color })
  void chrome.action.setBadgeText({ text })
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 1800)
}

/**
 * 剛存完書籤後，用 auto-organize 規則自動整理。
 * 失敗不影響原本的 save；規則為空或開關關閉時直接 return。
 */
async function applyAutoOrganizeToSavedBookmark(
  savedUrl: string,
  nativeNodeId: string,
): Promise<void> {
  try {
    // settings 由 @plasmohq/storage 以 JSON 字串寫入，必須先解析；
    // 直接把它當物件讀會讓規則永遠為空（自動整理靜默失效）。
    const storedSettings = await chrome.storage.sync.get(STORAGE_KEYS.settings)
    const { enabled, rules } = readAutoOrganizeSettings(storedSettings[STORAGE_KEYS.settings])
    if (!enabled)
      return
    if (rules.length === 0)
      return

    // metadata 同樣是 JSON 字串。這裡只用於規則比對；寫入一律走
    // updateBookmarkMetadataGuarded，壞資料在鎖內被拒絕，不會被 `{}` 覆寫。
    const storedMeta = await chrome.storage.local.get(STORAGE_KEYS.meta)
    const rawMeta = storedMeta[STORAGE_KEYS.meta]
    const metaMap = parseStoredRecord<BookmarkMeta>(rawMeta)
    const meta = metaMap?.[savedUrl] ?? {}

    const [nativeNode] = await chrome.bookmarks.get(nativeNodeId)
    if (!nativeNode?.url)
      return

    const bookmark: Bookmark = {
      id: nativeNode.id,
      name: nativeNode.title,
      url: savedUrl,
      description: meta.description,
      categoryId: nativeNode.parentId,
      tags: meta.tags,
      inboxAt: meta.inboxAt,
    }

    const [root] = await chrome.bookmarks.getTree()
    // Map app-level "cat-X" id → native "X" id (rule.targetCategoryId stores cat-prefixed).
    const catToNativeId = new Map<string, string>()
    const folders: Category[] = []
    const collectFolders = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
      for (const node of nodes) {
        if (!node.url) {
          folders.push({
            id: node.id,
            name: node.title,
            emoji: '',
            parentId: node.parentId ?? '0',
            modifiable: true,
          })
          catToNativeId.set(`cat-${node.id}`, node.id)
        }
        if (node.children)
          collectFolders(node.children)
      }
    }
    if (root)
      collectFolders([root])

    const patch: AutoOrganizePatch = {}
    for (const rule of rules) {
      if (!autoOrganizeRuleMatches(bookmark, rule))
        continue
      // Resolve rule.targetCategoryId (cat-prefixed) to native id if possible
      const resolvedRule = rule.targetCategoryId
        ? { ...rule, targetCategoryId: catToNativeId.get(rule.targetCategoryId) }
        : rule
      Object.assign(patch, createAutoOrganizePatch(
        { ...bookmark, ...patch },
        resolvedRule,
        folders,
      ))
    }
    if (Object.keys(patch).length === 0)
      return

    if (patch.categoryId && patch.categoryId !== nativeNode.parentId) {
      await chrome.bookmarks.move(nativeNode.id, { parentId: patch.categoryId })
    }
    if (patch.tags !== undefined || patch.inboxAt !== undefined) {
      const result = await updateBookmarkMetadataGuarded((latestMeta) => {
        const existing = latestMeta[savedUrl]
        const base
          = existing && typeof existing === 'object' && !Array.isArray(existing)
            ? existing
            : {}
        return {
          ...latestMeta,
          [savedUrl]: {
            ...base,
            ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
            ...(patch.inboxAt !== undefined ? { inboxAt: patch.inboxAt } : {}),
          },
        }
      })
      if (!result.written)
        reportExpectedFallback('auto-organize.meta-corrupt', undefined)
    }
  }
  catch (cause) {
    reportExpectedFallback('auto-organize.on-save', cause)
  }
}

async function getAllBookmarks(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const [root] = await chrome.bookmarks.getTree()
  const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = []
  const visit = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of nodes) {
      if (node.url)
        bookmarks.push(node)
      if (node.children)
        visit(node.children)
    }
  }
  visit(root.children ?? [])
  return bookmarks
}

// 依 spec D11 保留本體（避免擴大 R-01 凍結範圍），但 R7 修正後生產程式碼已無引用。
// eslint-disable-next-line unused-imports/no-unused-vars
async function resolveQuickSaveParent(): Promise<string> {
  const stored = await chrome.storage.local.get(quickSaveCategoryKey)
  const categoryId = stored[quickSaveCategoryKey]
  if (typeof categoryId === 'string') {
    const nodeId = categoryId.replace(/^cat-/, '')
    try {
      const [node] = await chrome.bookmarks.get(nodeId)
      if (node && !node.url)
        return nodeId
    }
    catch (cause) {
      reportExpectedFallback('quick-save.remembered-folder', cause)
    }
  }
  return '1'
}

const saveParentResolver = {
  getNode: async (nodeId: string) => {
    const [node] = await chrome.bookmarks.get(nodeId)
    return node
  },
  reportFallback: (cause: unknown) => reportExpectedFallback('quick-save.requested-folder', cause),
}

/**
 * 解析正式預設分類（`settings.defaultCategoryId`）。
 * `all` 只能走這裡，不得以 popup 記住的分類代替；讀取或節點解析失敗一律安全回退 Inbox。
 */
async function resolveDefaultSaveTarget() {
  try {
    const stored = await settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings)
    const settings = normalizeSettings(stored)
    return await resolveDefaultTargetFromSetting(
      settings.defaultCategoryId,
      saveParentResolver,
    )
  }
  catch (cause) {
    reportExpectedFallback('quick-save.default-category', cause)
    return { parentId: '1', isInbox: true }
  }
}

const newBookmarkParentResolver = {
  ...saveParentResolver,
  resolveDefaultTarget: resolveDefaultSaveTarget,
}

/** 壞掉的 metadata 不得被當成空記錄覆寫，失敗只記錄不中斷儲存。 */
async function persistBookmarkMetaGuarded(
  update: (latest: Record<string, BookmarkMeta>) => Record<string, BookmarkMeta>,
) {
  const result = await updateBookmarkMetadataGuarded(update)
  if (!result.written)
    reportExpectedFallback('save.meta-corrupt', undefined)
  return result
}

async function saveQuickBookmark(input: unknown): Promise<void> {
  if (!input || typeof input !== 'object')
    throw new LocalizedError('runtimeQuickSaveInvalidData')
  const candidate = input as Record<string, unknown>
  const page = currentPageFromTab({
    title: typeof candidate.name === 'string' ? candidate.name : '',
    url: typeof candidate.url === 'string' ? candidate.url : '',
  })
  if (!page)
    throw new LocalizedError('runtimeQuickSaveInvalidUrl')

  const bookmarks = await getAllBookmarks()
  if (getDuplicateBookmark(
    bookmarks.flatMap(node => node.url ? [{ url: node.url }] : []),
    page.url,
  )) {
    throw new LocalizedError('runtimeQuickSaveDuplicate')
  }

  const target = await resolveSaveTarget(candidate.categoryId, newBookmarkParentResolver)
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined
  const saved = await saveBookmarkWithInboxSemantics(
    {
      url: page.url,
      parentId: target.parentId,
      isInbox: target.isInbox,
      tags,
      requestedInboxAt: typeof candidate.inboxAt === 'number' && candidate.inboxAt > 0
        ? candidate.inboxAt
        : undefined,
    },
    {
      createBookmark: parentId => chrome.bookmarks.create({
        parentId,
        title: page.title,
        url: page.url,
      }),
      persistMeta: persistBookmarkMetaGuarded,
    },
  )
  await markLocalMetadataChanged()
  void applyAutoOrganizeToSavedBookmark(page.url, saved.id)
}

type SaveTabResult = 'duplicate' | 'invalid' | 'saved'

async function saveTab(tab?: chrome.tabs.Tab, preferredCategoryId?: string): Promise<SaveTabResult> {
  const page = currentPageFromTab(tab)
  if (!page) {
    setBadge('!', '#b91c1c')
    return 'invalid'
  }
  const bookmarks = await getAllBookmarks()
  const bookmarkUrls = bookmarks.flatMap(node => node.url ? [{ url: node.url }] : [])
  if (getDuplicateBookmark(bookmarkUrls, page.url)) {
    setBadge('=', '#525252')
    return 'duplicate'
  }
  // 三值語意：`cat-<nativeId>` 進該資料夾、`inbox` 進收件匣、`all`／未指定跟隨正式預設；
  // 虛擬 ID 絕不直接當 parentId 傳給 chrome.bookmarks。
  const target = await resolveSaveTarget(preferredCategoryId, newBookmarkParentResolver)
  const saved = await saveBookmarkWithInboxSemantics(
    {
      url: page.url,
      parentId: target.parentId,
      isInbox: target.isInbox,
    },
    {
      createBookmark: parentId => chrome.bookmarks.create({
        parentId,
        title: page.title,
        url: page.url,
      }),
      persistMeta: persistBookmarkMetaGuarded,
    },
  )
  await markLocalMetadataChanged()
  void applyAutoOrganizeToSavedBookmark(page.url, saved.id)
  setBadge('✓', '#15803d')
  return 'saved'
}

async function getGlobalPaletteSession(token: unknown, senderTabId?: number) {
  if (typeof token !== 'string' || !token || senderTabId === undefined)
    return undefined
  const key = globalPaletteSessionKey(token)
  const stored = await chrome.storage.session.get(key)
  const session = stored[key]
  if (!isGlobalPaletteSessionValid(session, senderTabId)) {
    await chrome.storage.session.remove(key)
    return undefined
  }
  return session
}

async function removeGlobalPaletteSessionsForTab(tabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(null)
  const keys = Object.entries(stored).flatMap(([key, session]) =>
    key.startsWith(globalPaletteSessionPrefix)
    && isGlobalPaletteSessionValid(session, undefined, 0)
    && session.tabId === tabId
      ? [key]
      : [])
  if (keys.length > 0)
    await chrome.storage.session.remove(keys)
}

async function pruneExpiredGlobalPaletteSessions(): Promise<void> {
  const stored = await chrome.storage.session.get(null)
  const keys = Object.entries(stored).flatMap(([key, session]) =>
    key.startsWith(globalPaletteSessionPrefix)
    && !isGlobalPaletteSessionValid(session, undefined)
      ? [key]
      : [])
  if (keys.length > 0)
    await chrome.storage.session.remove(keys)
}

async function recordGlobalPaletteBookmarkOpen(url: string): Promise<void> {
  await withBookmarkUsageLock(async () => {
    const usage = await localAreaStorage.get<Record<string, BookmarkUsage>>(STORAGE_KEYS.usage)
      ?? {}
    const current = usage[url]
    usage[url] = {
      openCount: (current?.openCount ?? 0) + 1,
      lastOpenedAt: Date.now(),
    }
    await localAreaStorage.set(STORAGE_KEYS.usage, usage)
  })
}

async function loadGlobalPaletteData() {
  const [{ bookmarks, categories }, bookmarkMeta, settings] = await Promise.all(
    [
      loadQuickSaveData(),
      localAreaStorage.get<Record<string, BookmarkMeta>>(STORAGE_KEYS.meta),
      settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings),
    ],
  )
  return {
    bookmarks: bookmarks.map(bookmark => ({
      ...bookmark,
      ...(bookmarkMeta?.[bookmark.url] ?? {}),
    })),
    categories,
    language: await getSelectedLanguage(),
    theme: settings?.theme ?? 'system',
    defaultCategoryId:
      typeof settings?.defaultCategoryId === 'string'
        ? settings.defaultCategoryId
        : undefined,
  }
}

/**
 * 命令面板「切換預設分類」：只有一個回傳值，呼叫端據此回應一次。
 * `all` 是「未指定（跟隨預設）」而非資料夾，必須拒絕且不得寫入正式設定，
 * 也不得自動轉成其他資料夾；`inbox`／`cat-X` 行為不變。
 */
async function switchGlobalPaletteCategory(
  message: { token?: unknown, categoryId?: unknown },
  senderTabId?: number,
): Promise<{ ok: boolean }> {
  const session = await getGlobalPaletteSession(message.token, senderTabId)
  if (!session)
    return { ok: false }
  // 舊版以空字串代表收件匣；正式值是 `'inbox'`，不得改寫成 `'cat-1'`
  // （`cat-1` 是書籤列這個普通資料夾），也不得經 popup 記憶分類代寫。
  const categoryId = resolveDefaultCategoryForSwitch(message.categoryId)
  if (categoryId === 'all')
    return { ok: false }
  const next = await withSettingsLock(async () => {
    const stored = await settingsStorage.get<Partial<Settings>>(
      STORAGE_KEYS.settings,
    )
    const merged = normalizeSettings({
      ...normalizeSettings(stored),
      defaultCategoryId: categoryId,
    })
    await persist(settingsStorage, STORAGE_KEYS.settings, merged)
    return merged
  })
  return { ok: next.defaultCategoryId === categoryId }
}

async function openGlobalPaletteBookmark(
  token: unknown,
  bookmarkId: unknown,
  senderTabId?: number,
): Promise<boolean> {
  if (!(await getGlobalPaletteSession(token, senderTabId)))
    return false
  if (typeof bookmarkId !== 'string')
    return false
  const [bookmark] = await chrome.bookmarks
    .get(toNodeId(bookmarkId))
    .catch((cause) => {
      reportExpectedFallback('command-palette.bookmark', cause)
      return []
    })
  const primaryUrl = normalizeBookmarkUrl(bookmark?.url ?? '')
  if (!primaryUrl)
    return false
  const bookmarkMeta = await localAreaStorage.get<Record<string, BookmarkMeta>>(
    STORAGE_KEYS.meta,
  )
  const url = await resolveFastestBookmarkUrl({
    url: primaryUrl,
    alternateUrls: bookmarkMeta?.[primaryUrl]?.alternateUrls,
  })
  await recordGlobalPaletteBookmarkOpen(primaryUrl)
  await chrome.tabs.create({ url })
  return true
}

async function openGlobalCommandPalette(tab?: chrome.tabs.Tab): Promise<void> {
  if (tab?.id === undefined) {
    await queueHomeTabTask(() => openOrFocusHomeTab(true))
    return
  }

  if (isHomeTab(tab, true)) {
    await chrome.tabs.update(tab.id, {
      url: `${HOME_URL}${globalPaletteHomeHash}`,
    })
    return
  }

  await pruneExpiredGlobalPaletteSessions()
  const token = crypto.randomUUID()
  const key = globalPaletteSessionKey(token)
  await chrome.storage.session.set({
    [key]: {
      tabId: tab.id,
      expiresAt: Date.now() + globalPaletteSessionTtlMs,
    },
  })
  const iframeUrl = chrome.runtime.getURL(
    `tabs/global-command-palette.html#${encodeURIComponent(token)}`,
  )

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: toggleGlobalCommandPalette,
      args: [iframeUrl, token],
    })
    if (result?.result === 'closed')
      await chrome.storage.session.remove(key)
  }
  catch (cause) {
    reportExpectedFallback('command-palette.inject', cause)
    await chrome.storage.session.remove(key)
    await queueHomeTabTask(() => openOrFocusHomeTab(true))
  }
}

async function openGlobalCommandPaletteIfEnabled(
  tab?: chrome.tabs.Tab,
): Promise<boolean> {
  const settings = await settingsStorage.get<Partial<Settings>>(STORAGE_KEYS.settings)
  if (settings?.globalCommandPaletteEnabled !== true)
    return false
  await openGlobalCommandPalette(tab)
  return true
}

async function refreshContextMenu(): Promise<void> {
  const language = await getSelectedLanguage()
  await chrome.contextMenus.remove(MENU_ID).catch((cause) => {
    // 首次安裝時選單不存在，屬正常情況，保留紀錄方便排查建立失敗。
    reportExpectedFallback('context-menu.reset', cause)
  })
  // 清理舊品牌殘留的 contextMenu id
  await chrome.contextMenus.remove(LEGACY_MENU_ID).catch(() => undefined)
  chrome.contextMenus.create({
    id: MENU_ID,
    title: translateRuntime(language, 'runtimeSaveCurrentPage'),
    contexts: ['page'],
  })
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshContextMenu().catch(() => undefined)
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[STORAGE_KEYS.settings])
    void refreshContextMenu().catch(() => undefined)
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) {
    void saveTab(tab).catch((cause) => {
      reportDiagnostic('quick-save.context-menu', cause)
      setBadge('!', '#b91c1c')
    })
  }
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'quick-save-page') {
    void saveTab(tab).catch((cause) => {
      reportDiagnostic('quick-save.command', cause)
      setBadge('!', '#b91c1c')
    })
  }
  if (command === openGlobalCommandPaletteCommand)
    void openGlobalCommandPaletteIfEnabled(tab).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === fetchRemoteFaviconMessage) {
    void fetchRemoteFavicon(message.url).then(sendResponse).catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === homeTabReadyMessage) {
    void queueHomeTabTask(() => registerHomeTab(sender.tab))
      .then(() => sendResponse({ ok: true }))
      .catch((cause) => {
        reportDiagnostic('home-tab.register', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === openHomeTabMessage) {
    void queueHomeTabTask(openOrFocusHomeTab)
      .then(() => sendResponse({ ok: true }))
      .catch((cause) => {
        reportDiagnostic('home-tab.open', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteValidateMessage) {
    void getGlobalPaletteSession(message.token, sender.tab?.id)
      .then(session => (session ? loadGlobalPaletteData() : undefined))
      .then(data => sendResponse(data ? { ok: true, data } : { ok: false }))
      .catch((cause) => {
        reportDiagnostic('command-palette.validate', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (
    message?.type === globalPaletteOpenForTabMessage
    && sender.id === chrome.runtime.id
  ) {
    void (typeof message.tabId === 'number'
      ? chrome.tabs.get(message.tabId).then(openGlobalCommandPaletteIfEnabled)
      : Promise.reject(new TypeError('Missing target tab')))
      .then(ok => sendResponse({ ok }))
      .catch((cause) => {
        reportDiagnostic('command-palette.open-for-tab', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteOpenBookmarkMessage) {
    void openGlobalPaletteBookmark(
      message.token,
      message.bookmarkId,
      sender.tab?.id,
    )
      .then(ok => sendResponse({ ok }))
      .catch((cause) => {
        reportDiagnostic('command-palette.open-bookmark', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteSavePageMessage) {
    void getGlobalPaletteSession(message.token, sender.tab?.id)
      .then(async (session) => {
        if (!session)
          return undefined
        const tab = await chrome.tabs.get(session.tabId).catch((cause) => {
          reportExpectedFallback('command-palette.save-tab', cause)
          return undefined
        })
        const categoryId = typeof message.categoryId === 'string' && message.categoryId
          ? message.categoryId
          : undefined
        return saveTab(tab, categoryId)
      })
      .then(result => sendResponse({ ok: Boolean(result), result }))
      .catch((cause) => {
        reportDiagnostic('command-palette.save', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteSwitchCategoryMessage) {
    // 單一出口：成功或失敗都只呼叫一次 sendResponse（不再於分支內先回一次）。
    void switchGlobalPaletteCategory(message, sender.tab?.id)
      .then(sendResponse)
      .catch((cause) => {
        reportDiagnostic('command-palette.switch-category', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteOpenHomeMessage) {
    void getGlobalPaletteSession(message.token, sender.tab?.id)
      .then(async (session) => {
        if (!session)
          return false
        await queueHomeTabTask(openOrFocusHomeTab)
        return true
      })
      .then(ok => sendResponse({ ok }))
      .catch((cause) => {
        reportDiagnostic('command-palette.open-home', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === globalPaletteCloseMessage) {
    const key
      = typeof message.token === 'string'
        ? globalPaletteSessionKey(message.token)
        : ''
    void getGlobalPaletteSession(message.token, sender.tab?.id)
      .then(session =>
        session && key ? chrome.storage.session.remove(key) : undefined,
      )
      .then(() => sendResponse({ ok: true }))
      .catch((cause) => {
        reportDiagnostic('command-palette.close', cause)
        sendResponse({ ok: false })
      })
    return true
  }
  if (message?.type === quickSaveBookmarkMessage) {
    void saveQuickBookmark(message.bookmark)
      .then(() => sendResponse({ ok: true }))
      .catch(cause => sendResponse({
        ok: false,
        errorKey: cause instanceof LocalizedError
          ? cause.messageKey
          : 'runtimeQuickSaveFailed',
        params: cause instanceof LocalizedError ? cause.params : undefined,
      }))
    return true
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeGlobalPaletteSessionsForTab(tabId)
  void chrome.storage.session.get(homeTabStorageKey).then((stored) => {
    if (stored[homeTabStorageKey] === tabId)
      return chrome.storage.session.remove(homeTabStorageKey)
  })
})

registerBookmarkEvents()
registerNativeSortAutoListener()
