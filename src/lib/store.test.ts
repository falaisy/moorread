import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeBookmarkGroups, encodeBookmarkGroup } from './bookmark-groups'
import { useBookmarkGroupsStore } from './bookmark-groups-store'
import { getPinnedCards } from './card-order'
import * as metadataSync from './metadata-sync'
import { applyMaterializedBookmarkMetadata } from './metadata-sync'
import * as siteMetadata from './site-metadata'
import {
  flushUsagePersistence,
  mergeAlternateUrlsForDuplicate,
  metadataAutoSyncDelayMs,
  usagePersistDelayMs,
  useNavStore,
} from './store'
import { metaStorage, withBookmarkMetadataLock } from './store-persistence'
import { DEFAULT_SETTINGS, normalizeSettings } from './store-settings-state'

const storageState = vi.hoisted(() => ({
  writes: [] as Array<{ area: string, key: string, value: unknown }>,
  values: new Map<string, unknown>(),
  setError: null as Error | null,
  setHook: null as ((key: string) => Promise<void>) | null,
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    area: string

    constructor(options: { area: string }) {
      this.area = options.area
    }

    async get(key: string) {
      return structuredClone(storageState.values.get(`${this.area}:${key}`))
    }

    async set(key: string, value: unknown) {
      await storageState.setHook?.(key)
      if (storageState.setError)
        throw storageState.setError
      storageState.writes.push({ area: this.area, key, value })
      storageState.values.set(`${this.area}:${key}`, structuredClone(value))
    }

    async remove() {}
  },
}))

const initialState = useNavStore.getInitialState()

beforeEach(() => {
  storageState.writes.length = 0
  storageState.values.clear()
  storageState.setError = null
  storageState.setHook = null
  useNavStore.setState(initialState, true)
  useBookmarkGroupsStore.setState({ groups: [], error: false })
  vi.stubGlobal('chrome', { bookmarks: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('navigation store boundaries', () => {
  it('retains unchanged bookmark and category objects across native tree reloads', async () => {
    const tree = [{ id: '0', title: '', children: [{ id: '1', title: 'Folder', children: [
      { id: '2', title: 'One', url: 'https://one.example' },
      { id: '3', title: 'Two', url: 'https://two.example' },
    ] }] }]
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => structuredClone(tree) } })
    useNavStore.setState({ meta: { 'https://two.example': { tags: ['keep'], description: 'Keep' } } })
    await useNavStore.getState().loadBookmarks()
    const first = useNavStore.getState()
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().bookmarks).toBe(first.bookmarks)
    expect(useNavStore.getState().categories).toBe(first.categories)
    tree[0].children[0].children[0].title = 'Edited'
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().bookmarks[0].name).toBe('Edited')
    expect(useNavStore.getState().bookmarks[1]).toBe(first.bookmarks[1])
    expect(useNavStore.getState().categories).toBe(first.categories)
  })

  it('restores the configured default folder when the bookmark tree only becomes available later', async () => {
    // 瀏覽器啟動時書籤樹可能先回空樹；分類晚到後必須還原預設資料夾，不能永久停在 all。
    const emptyTree = [{ id: '0', title: '', children: [] }]
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks bar', children: [{ id: '5', title: 'Sample bookmark', children: [] }] },
    ] }]
    useNavStore.setState({
      settings: normalizeSettings({ defaultCategoryId: 'cat-5' }),
      categories: [],
      activeCategoryId: 'all',
      categorySelectionTouched: false,
    })
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => structuredClone(emptyTree) } })
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().activeCategoryId).toBe('all')

    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => structuredClone(tree) } })
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().categories.map(category => category.id)).toContain('cat-5')
    expect(useNavStore.getState().activeCategoryId).toBe('cat-5')
  })

  it('keeps the category the user selected when bookmarks reload', async () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks bar', children: [{ id: '5', title: 'Sample bookmark', children: [] }, { id: '6', title: 'other', children: [] }] },
    ] }]
    useNavStore.setState({
      settings: normalizeSettings({ defaultCategoryId: 'cat-5' }),
      categories: [],
      activeCategoryId: 'cat-6',
      categorySelectionTouched: true,
    })
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => structuredClone(tree) } })
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().activeCategoryId).toBe('cat-6')
  })

  it('falls back to all without rewriting a default folder that does not exist', async () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks bar', children: [{ id: '5', title: 'Sample bookmark', children: [] }] },
    ] }]
    useNavStore.setState({
      settings: normalizeSettings({ defaultCategoryId: 'cat-999999' }),
      categories: [],
      activeCategoryId: 'all',
      categorySelectionTouched: false,
    })
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => structuredClone(tree) } })
    await useNavStore.getState().loadBookmarks()
    expect(useNavStore.getState().activeCategoryId).toBe('all')
    expect(useNavStore.getState().settings.defaultCategoryId).toBe('cat-999999')
    expect(storageState.writes.filter(write => write.key === 'moorread:settings')).toEqual([])
  })

  it('does not pretend the default folder was saved when the storage write fails', async () => {
    useNavStore.setState({ settings: normalizeSettings({ defaultCategoryId: 'cat-a' }) })
    storageState.setError = new Error('quota exceeded')
    await expect(useNavStore.getState().setDefaultCategory('cat-b')).rejects.toThrow('quota exceeded')
    expect(useNavStore.getState().settings.defaultCategoryId).toBe('cat-a')
    expect(storageState.writes).toEqual([])
  })

  it('applies native bookmark and folder titles locally while preserving metadata and siblings', async () => {
    const untouched = { id: 'bm-3', name: 'Two', url: 'https://two.example', categoryId: 'cat-1' }
    const categories = [{ id: 'cat-1', name: 'Folder', emoji: 'A', parentId: 'all', modifiable: true }]
    useNavStore.setState({
      bookmarks: [{ id: 'bm-2', name: 'One', url: 'https://one.example', categoryId: 'cat-1', tags: ['keep'] }, untouched],
      categories,
    })
    expect(useNavStore.getState().applyNativeBookmarkTitle('2', 'Changed URL', 'https://changed.example')).toBe(false)
    expect(useNavStore.getState().bookmarks[0].name).toBe('One')
    expect(useNavStore.getState().applyNativeBookmarkTitle('2', 'Renamed', 'https://one.example')).toBe(true)
    expect(useNavStore.getState().bookmarks[0]).toMatchObject({ name: 'Renamed', tags: ['keep'] })
    expect(useNavStore.getState().bookmarks[1]).toBe(untouched)
    expect(useNavStore.getState().categories).toBe(categories)
    expect(useNavStore.getState().applyNativeBookmarkTitle('1', 'Projects')).toBe(true)
    expect(useNavStore.getState().categories[0]).toMatchObject({ name: 'Projects', emoji: 'A' })
    expect(useNavStore.getState().applyNativeBookmarkTitle('missing', 'Unknown')).toBe(false)
    expect(useNavStore.getState().applyNativeBookmarkTitle('2', '')).toBe(true)
    expect(useNavStore.getState().bookmarks[0].name).toBe('https://one.example')
  })

  it.each(['Old', 'New'])('discards an in-flight native tree snapshot when a local native title event arrives (cached title: %s)', async (cachedTitle) => {
    useNavStore.setState({ bookmarks: [{ id: 'bm-2', name: cachedTitle, url: 'https://one.example', categoryId: 'all' }] })
    const oldTree = deferred<chrome.bookmarks.BookmarkTreeNode[]>()
    const entered = deferred<void>()
    const getTree = vi.fn().mockImplementationOnce(() => {
      entered.resolve()
      return oldTree.promise
    }).mockResolvedValue([
      { id: '0', title: '', children: [{ id: '2', title: 'New', url: 'https://one.example' }] },
    ])
    vi.stubGlobal('chrome', { bookmarks: { getTree } })
    const load = useNavStore.getState().loadBookmarks()
    await entered.promise
    useNavStore.getState().applyNativeBookmarkTitle('2', 'New')
    oldTree.resolve([{ id: '0', title: '', syncing: false, children: [{ id: '2', title: 'Old', url: 'https://one.example', syncing: false }] }])
    await load
    expect(getTree).toHaveBeenCalledTimes(2)
    expect(useNavStore.getState().bookmarks[0].name).toBe('New')
  })

  it('retains another page’s category icon when editing a stale category snapshot', async () => {
    vi.useFakeTimers()
    storageState.values.set('local:moorread:category-meta', { 'cat-2': { emoji: 'B' } })
    useNavStore.setState({
      categories: [{ id: 'cat-1', name: 'One', emoji: '📁', parentId: 'cat-root', modifiable: true }],
      categoryMeta: {},
      loadBookmarks: vi.fn().mockResolvedValue(undefined),
    })
    await useNavStore.getState().updateCategory('cat-1', { emoji: 'A' })
    expect(storageState.values.get('local:moorread:category-meta')).toEqual({
      'cat-1': { emoji: 'A' },
      'cat-2': { emoji: 'B' },
    })
    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
  })

  it('adds pending opens to the latest persisted count instead of overwriting another page', async () => {
    vi.useFakeTimers()
    const url = 'https://usage-concurrency.example/'
    storageState.values.set('local:moorread:usage', { [url]: { openCount: 3, lastOpenedAt: 1 } })
    useNavStore.setState({ usage: { [url]: { openCount: 3, lastOpenedAt: 1 } } })
    await useNavStore.getState().recordBookmarkOpen(url)
    storageState.values.set('local:moorread:usage', {
      [url]: { openCount: 5, lastOpenedAt: 2 },
      'https://other.example/': { openCount: 1, lastOpenedAt: 2 },
    })
    await flushUsagePersistence()
    expect(storageState.values.get('local:moorread:usage')).toEqual({
      [url]: expect.objectContaining({ openCount: 6 }),
      'https://other.example/': { openCount: 1, lastOpenedAt: 2 },
    })
  })

  it('resets general preferences in one write while retaining appearance and user data', async () => {
    const settings = normalizeSettings({
      language: 'en',
      defaultCategoryId: 'pinned',
      singleHomeTab: true,
      bookmarkGroupsEnabled: false,
      theme: 'dark',
      onboardingDismissed: true,
      bookmarkViewMode: 'compact',
      savedSearches: [{ id: 'saved', name: 'Work', query: 'tag:work' }],
      autoOrganizeRules: [{ id: 'rule', name: 'Work', enabled: true, field: 'domain', operator: 'contains', value: 'example.com', addTags: ['work'], clearInbox: true }],
      appearance: { ...DEFAULT_SETTINGS.appearance, colorTheme: 'graphite', navLayout: 'top', navItems: { icons: false, counts: false, smartCategories: false, savedSearches: true, categoryTree: false }, cardFields: { ...DEFAULT_SETTINGS.appearance.cardFields, websiteIcon: false } },
    })
    useNavStore.setState({ settings })
    storageState.values.set('sync:moorread:settings', settings)
    await useNavStore.getState().resetGeneralSettings()
    const actual = useNavStore.getState().settings
    expect(actual).toEqual({ ...settings, language: DEFAULT_SETTINGS.language, defaultCategoryId: 'all', singleHomeTab: false, bookmarkGroupsEnabled: true, appearance: { ...settings.appearance, navLayout: 'sidebar', navItems: { icons: false, counts: true, smartCategories: true, savedSearches: false, categoryTree: true } } })
    expect(storageState.writes).toEqual([{ area: 'sync', key: 'moorread:settings', value: actual }])
  })

  it('resets appearance and icon preferences without changing general settings or user data', async () => {
    const settings = normalizeSettings({
      language: 'en',
      defaultCategoryId: 'pinned',
      singleHomeTab: true,
      bookmarkGroupsEnabled: false,
      theme: 'dark',
      onboardingDismissed: true,
      bookmarkViewMode: 'compact',
      savedSearches: [{ id: 'saved', name: 'Work', query: 'tag:work' }],
      appearance: { ...DEFAULT_SETTINGS.appearance, colorTheme: 'berry', navLayout: 'top', navItems: { icons: false, counts: false, smartCategories: false, savedSearches: true, categoryTree: false }, cardFields: { ...DEFAULT_SETTINGS.appearance.cardFields, websiteIcon: false, description: false, tags: false } },
    })
    useNavStore.setState({ settings })
    storageState.values.set('sync:moorread:settings', settings)
    await useNavStore.getState().resetAppearanceSettings()
    const actual = useNavStore.getState().settings
    expect(actual).toEqual({ ...settings, theme: 'system', appearance: { ...DEFAULT_SETTINGS.appearance, navLayout: 'top', navItems: { ...settings.appearance.navItems, icons: true } } })
    expect(actual.appearance.cardFields).not.toBe(DEFAULT_SETTINGS.appearance.cardFields)
    expect(storageState.writes).toEqual([{ area: 'sync', key: 'moorread:settings', value: actual }])
  })

  it('merges the default folder into the latest stored settings instead of the stale page snapshot', async () => {
    storageState.values.set('sync:moorread:settings', normalizeSettings({ defaultCategoryId: 'cat-a', theme: 'dark' }))
    useNavStore.setState({ settings: normalizeSettings({ defaultCategoryId: 'all', theme: 'light' }), categories: [] })
    await useNavStore.getState().setDefaultCategory('cat-b')
    expect(storageState.values.get('sync:moorread:settings')).toMatchObject({ defaultCategoryId: 'cat-b', theme: 'dark' })
    expect(useNavStore.getState().settings.defaultCategoryId).toBe('cat-b')
  })

  it('keeps a default folder id even when categories are not loaded yet', async () => {
    useNavStore.setState({ settings: normalizeSettings({}), categories: [] })
    await useNavStore.getState().setDefaultCategory('cat-x')
    expect(storageState.values.get('sync:moorread:settings')).toMatchObject({ defaultCategoryId: 'cat-x' })
  })

  it('lets a metadata-locked URL migration finish while a pinned reorder is waiting', async () => {
    vi.useFakeTimers()
    const group = { id: 'tools', title: 'Tools', description: '', pinnedAt: 20, bookmarks: [{ url: 'https://one.example/', title: 'One' }] }
    const values = encodeBookmarkGroup(group, 'initial')
    vi.stubGlobal('chrome', { storage: { sync: {
      get: vi.fn(async () => structuredClone(values)),
      set: vi.fn(async changes => Object.assign(values, changes)),
      remove: vi.fn(async () => {}),
    } }, bookmarks: {} })
    useNavStore.setState({ syncMetadataNow: vi.fn().mockResolvedValue(undefined), bookmarks: [] })
    const entered = deferred<void>()
    const release = deferred<void>()
    const migration = withBookmarkMetadataLock(async () => {
      entered.resolve()
      await release.promise
      await useBookmarkGroupsStore.getState().migrateUrl('https://one.example/', 'https://new.example/')
    })
    await entered.promise
    const reorder = useNavStore.getState().reorderPinnedCard('group:tools', 'bookmark:https://one.example/')
    // Let the reorder reach whichever lock it acquires first.
    await vi.advanceTimersByTimeAsync(0)
    release.resolve()
    const outcome = Promise.race([
      Promise.all([migration, reorder]).then(() => 'completed'),
      new Promise<string>(resolve => setTimeout(resolve, 100, 'deadlocked')),
    ])
    await vi.advanceTimersByTimeAsync(100)
    expect(await outcome).toBe('completed')
    expect(decodeBookmarkGroups(values)[0].bookmarks[0].url).toBe('https://new.example/')
  })
  it('rolls back only order fields if a dense mixed reorder cannot save group ranks', async () => {
    vi.useFakeTimers()
    const group = { id: 'tools', title: 'Tools', description: '', pinnedAt: 20, pinnedOrder: -100, bookmarks: [{ url: 'https://one.example/', title: 'One' }] }
    const values = encodeBookmarkGroup(group, 'initial')
    vi.stubGlobal('chrome', { storage: { sync: {
      get: vi.fn(async () => structuredClone(values)),
      set: vi.fn(async () => {
        storageState.values.set('local:moorread:meta', {
          ...storageState.values.get('local:moorread:meta') as object,
          'https://one.example/': { pinnedAt: 30, pinnedOrder: -100, tags: ['concurrent edit'] },
        })
        throw new Error('sync write rejected')
      }),
    } }, bookmarks: {} })
    const meta = {
      'https://one.example/': { pinnedAt: 30, pinnedOrder: -100 },
      'https://two.example/': { pinnedAt: 10, pinnedOrder: -100 },
    }
    storageState.values.set('local:moorread:meta', meta)
    useNavStore.setState({ meta, syncMetadataNow: vi.fn().mockResolvedValue(undefined), bookmarks: [
      { id: 'one', name: 'One', url: 'https://one.example/', categoryId: 'cat-1', pinnedAt: 30, pinnedOrder: -100 },
      { id: 'two', name: 'Two', url: 'https://two.example/', categoryId: 'cat-2', pinnedAt: 10, pinnedOrder: -100 },
    ] })
    await expect(useNavStore.getState().reorderPinnedCard('bookmark:https://one.example/', 'bookmark:https://two.example/'))
      .rejects
      .toThrow('sync write rejected')
    expect(useNavStore.getState().meta['https://one.example/']).toEqual({ pinnedAt: 30, pinnedOrder: -100, tags: ['concurrent edit'] })
    expect(useNavStore.getState().meta['https://two.example/'].pinnedOrder).toBe(-100)
    expect(decodeBookmarkGroups(values)[0].pinnedOrder).toBe(-100)
    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
  })
  it('reorders mixed pinned cards with fresh metadata while retaining concurrent group edits', async () => {
    vi.useFakeTimers()
    const group = { id: 'tools', title: 'Tools', description: 'Remote edit', pinnedAt: 20, bookmarks: [{ url: 'https://one.example/', title: 'One' }] }
    const values = encodeBookmarkGroup(group, 'initial')
    const sync = {
      get: vi.fn(async () => structuredClone(values)),
      set: vi.fn(async (changes) => {
        Object.assign(values, changes)
      }),
      remove: vi.fn(async () => {}),
    }
    vi.stubGlobal('chrome', { storage: { sync }, bookmarks: {} })
    useBookmarkGroupsStore.setState({ groups: [{ ...group, description: 'Stale' }] })
    useNavStore.setState({ syncMetadataNow: vi.fn().mockResolvedValue(undefined), bookmarks: [
      { id: 'one', name: 'One', url: 'https://one.example/', categoryId: 'cat-1', pinnedAt: 30 },
      { id: 'two', name: 'Two', url: 'https://two.example/', categoryId: 'cat-2', pinnedAt: 10 },
    ] })
    storageState.values.set('local:moorread:meta', {
      'https://one.example/': { pinnedAt: 30, tags: ['latest'] },
      'https://two.example/': { pinnedAt: 10 },
    })
    await useNavStore.getState().reorderPinnedCard('group:tools', 'bookmark:https://one.example/')
    expect(getPinnedCards(useNavStore.getState().bookmarks, decodeBookmarkGroups(values)).map(item => item.key))
      .toEqual(['group:tools', 'bookmark:https://one.example/', 'bookmark:https://two.example/'])
    expect(decodeBookmarkGroups(values)[0]).toMatchObject({ pinnedAt: 20, description: 'Remote edit' })
    await useNavStore.getState().reorderPinnedCard('bookmark:https://two.example/', 'group:tools')
    expect(getPinnedCards(useNavStore.getState().bookmarks, decodeBookmarkGroups(values)).map(item => item.key))
      .toEqual(['bookmark:https://two.example/', 'group:tools', 'bookmark:https://one.example/'])
    expect(useNavStore.getState().meta['https://one.example/'].tags).toEqual(['latest'])
    expect(useNavStore.getState().bookmarks.map(item => item.categoryId)).toEqual(['cat-1', 'cat-2'])
    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
  })
  it('preserves metadata saved by another page when editing a stale bookmark', async () => {
    vi.useFakeTimers()
    storageState.values.set('local:moorread:meta', {
      'https://example.com/': { alternateUrls: ['https://backup.example.com/'] },
      'https://other.example/': { tags: ['other'] },
    })

    await useNavStore.getState().setBookmarkMeta('https://example.com/', {
      description: 'Only edit description',
    })

    expect(useNavStore.getState().meta).toEqual({
      'https://example.com/': {
        alternateUrls: ['https://backup.example.com/'],
        description: 'Only edit description',
      },
      'https://other.example/': { tags: ['other'] },
    })
    expect(storageState.values.get('local:moorread:meta'))
      .toEqual(useNavStore.getState().meta)
    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
  })

  it('preserves both metadata edits when saves overlap', async () => {
    vi.useFakeTimers()
    await Promise.all([
      useNavStore.getState().setBookmarkMeta('https://example.com/', {
        alternateUrls: ['https://backup.example.com/'],
      }),
      useNavStore.getState().setBookmarkMeta('https://example.com/', {
        description: 'Concurrent description',
      }),
    ])

    expect(storageState.values.get('local:moorread:meta')).toEqual({
      'https://example.com/': {
        alternateUrls: ['https://backup.example.com/'],
        description: 'Concurrent description',
      },
    })
    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
  })

  it('does not display an unsaved metadata edit when storage rejects it', async () => {
    const meta = { 'https://example.com/': { tags: ['saved'] } }
    useNavStore.setState({ meta })
    storageState.setError = new Error('storage failed')

    await expect(useNavStore.getState().setBookmarkMeta('https://example.com/', {
      alternateUrls: ['https://backup.example.com/'],
    })).rejects.toThrow('storage failed')

    expect(useNavStore.getState().meta).toBe(meta)
  })

  it('updates and persists the interface language', async () => {
    await useNavStore.getState().setLanguage('en')

    expect(useNavStore.getState().settings.language).toBe('en')
    expect(storageState.writes).toContainEqual({
      area: 'sync',
      key: 'moorread:settings',
      value: expect.objectContaining({ language: 'en' }),
    })
  })

  it('preserves the group toggle when another setting changes during its pending save', async () => {
    const pending: Array<() => void> = []
    storageState.setHook = () => new Promise<void>((resolve) => {
      pending.push(resolve)
    })
    const disable = useNavStore.getState().setBookmarkGroupsEnabled(false)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const language = useNavStore.getState().setLanguage('en')
    // 写入在锁内串行：第二笔要等第一笔落盘后才读取最新值合并。
    expect(pending).toHaveLength(1)
    pending[0]()
    await disable
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[1]()
    await language

    expect(useNavStore.getState().settings).toMatchObject({ bookmarkGroupsEnabled: false, language: 'en' })
    expect(storageState.values.get('sync:moorread:settings')).toMatchObject({ bookmarkGroupsEnabled: false, language: 'en' })
    expect(storageState.writes.map(write => (write.value as { bookmarkGroupsEnabled: boolean }).bookmarkGroupsEnabled)).toEqual([false, false])
  })

  it('updates and persists settings through the sync storage boundary', async () => {
    await useNavStore.getState().setTheme('dark')

    expect(useNavStore.getState().settings.theme).toBe('dark')
    expect(storageState.writes).toContainEqual({
      area: 'sync',
      key: 'moorread:settings',
      value: expect.objectContaining({ theme: 'dark' }),
    })
  })

  it('updates and persists a keyboard shortcut without allowing conflicts', async () => {
    await useNavStore.getState().setKeyboardShortcut('focusSearch', {
      key: 'f',
      primary: true,
      alt: false,
      shift: true,
    })

    expect(
      useNavStore.getState().settings.keyboardShortcuts.focusSearch,
    ).toEqual({
      key: 'f',
      primary: true,
      alt: false,
      shift: true,
    })
    expect(storageState.writes).toContainEqual({
      area: 'sync',
      key: 'moorread:settings',
      value: expect.objectContaining({
        keyboardShortcuts: expect.objectContaining({
          focusSearch: expect.objectContaining({ key: 'f' }),
        }),
      }),
    })
    await expect(
      useNavStore
        .getState()
        .setKeyboardShortcut(
          'focusSearch',
          useNavStore.getState().settings.keyboardShortcuts.addBookmark,
        ),
    ).rejects.toThrow('shortcut.conflict')
  })

  it('rejects moving bookmarks into a stale category before writing', async () => {
    useNavStore.setState({
      categories: [],
      bookmarks: [
        {
          id: 'bookmark-1',
          name: 'Example',
          url: 'https://example.com',
          categoryId: 'cat-1',
        },
      ],
    })

    await expect(
      useNavStore.getState().moveBookmarks(['bookmark-1'], 'cat-missing'),
    ).rejects.toThrow('category.target_not_found')
  })

  it('coalesces supplementary metadata changes into one delayed sync', async () => {
    vi.useFakeTimers()
    const syncMetadataNow = vi.fn().mockResolvedValue(undefined)
    useNavStore.setState({ syncMetadataNow })

    await useNavStore.getState().setBookmarkMeta('https://one.example', {
      description: 'One',
    })
    await useNavStore.getState().setBookmarkMeta('https://two.example', {
      description: 'Two',
    })

    await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs - 1)
    expect(syncMetadataNow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(syncMetadataNow).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid usage updates into one storage write', async () => {
    vi.useFakeTimers()

    await useNavStore.getState().recordBookmarkOpen('https://example.test')
    await useNavStore.getState().recordBookmarkOpen('https://example.test')
    expect(
      storageState.writes.filter(write => write.key === 'moorread:usage'),
    ).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(usagePersistDelayMs)
    expect(
      storageState.writes.filter(write => write.key === 'moorread:usage'),
    ).toEqual([
      {
        area: 'local',
        key: 'moorread:usage',
        value: {
          'https://example.test': expect.objectContaining({ openCount: 2 }),
        },
      },
    ])
  })

  it('retries a scheduled usage write after a temporary storage failure', async () => {
    vi.useFakeTimers()
    const url = 'https://retry.example/'
    await useNavStore.getState().recordBookmarkOpen(url)
    storageState.setError = new Error('temporary failure')
    await vi.advanceTimersByTimeAsync(usagePersistDelayMs)
    expect(storageState.values.get('local:moorread:usage')).toBeUndefined()
    storageState.setError = null
    await vi.advanceTimersByTimeAsync(5_000)
    expect(storageState.values.get('local:moorread:usage')).toEqual({
      [url]: expect.objectContaining({ openCount: 1 }),
    })
  })

  it('preserves unaffected bookmark objects during metadata updates', async () => {
    const untouched = {
      id: 'two',
      name: 'Two',
      url: 'https://two.example',
      categoryId: 'cat-1',
    }
    useNavStore.setState({
      bookmarks: [
        {
          id: 'one',
          name: 'One',
          url: 'https://one.example',
          categoryId: 'cat-1',
        },
        untouched,
      ],
    })

    await useNavStore.getState().setBookmarkMeta('https://one.example', {
      description: 'Updated',
    })

    expect(useNavStore.getState().bookmarks[0]?.description).toBe('Updated')
    expect(useNavStore.getState().bookmarks[1]).toBe(untouched)
  })

  it('reorders pinned bookmarks without moving their native folders', async () => {
    useNavStore.setState({
      bookmarks: [
        {
          id: 'one',
          name: 'One',
          url: 'https://one.example',
          categoryId: 'cat-1',
          pinnedAt: 30,
        },
        {
          id: 'two',
          name: 'Two',
          url: 'https://two.example',
          categoryId: 'cat-2',
          pinnedAt: 20,
        },
        {
          id: 'three',
          name: 'Three',
          url: 'https://three.example',
          categoryId: 'cat-3',
          pinnedAt: 10,
        },
      ],
      meta: {
        'https://one.example': { pinnedAt: 30 },
        'https://two.example': { pinnedAt: 20 },
        'https://three.example': { pinnedAt: 10 },
      },
      recordActivity: vi.fn().mockResolvedValue(undefined),
    })

    await useNavStore.getState().reorderPinnedBookmark('one', 'three')

    expect(
      useNavStore.getState().bookmarks
        .toSorted((left, right) => (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0))
        .map(bookmark => bookmark.id),
    ).toEqual(['two', 'three', 'one'])
    expect(useNavStore.getState().bookmarks.map(bookmark => bookmark.categoryId))
      .toEqual(['cat-1', 'cat-2', 'cat-3'])
  })

  it('moves duplicate pinned URLs as one group', async () => {
    useNavStore.setState({
      bookmarks: [
        { id: 'one-a', name: 'One A', url: 'https://one.example', categoryId: 'cat-1', pinnedAt: 30 },
        { id: 'one-b', name: 'One B', url: 'https://one.example', categoryId: 'cat-2', pinnedAt: 30 },
        { id: 'two', name: 'Two', url: 'https://two.example', categoryId: 'cat-3', pinnedAt: 20 },
      ],
      meta: {
        'https://one.example': { pinnedAt: 30 },
        'https://two.example': { pinnedAt: 20 },
      },
      recordActivity: vi.fn().mockResolvedValue(undefined),
    })

    await useNavStore.getState().reorderPinnedBookmark('one-b', 'two')

    const [oneA, oneB, two] = useNavStore.getState().bookmarks
    expect(oneA?.pinnedAt).toBe(oneB?.pinnedAt)
    expect(oneA?.pinnedAt).toBeLessThan(two?.pinnedAt ?? 0)
  })

  it('keeps the current order when pinned-order persistence fails', async () => {
    const bookmarks = [
      { id: 'one', name: 'One', url: 'https://one.example', categoryId: 'cat-1', pinnedAt: 20 },
      { id: 'two', name: 'Two', url: 'https://two.example', categoryId: 'cat-2', pinnedAt: 10 },
    ]
    useNavStore.setState({ bookmarks })
    storageState.setError = new Error('storage failed')

    await expect(
      useNavStore.getState().reorderPinnedBookmark('one', 'two'),
    ).rejects.toThrow('storage failed')
    expect(useNavStore.getState().bookmarks).toBe(bookmarks)
  })

  it('migrates alternate URLs when a native bookmark URL changes', async () => {
    useNavStore.setState({
      bookmarks: [{
        id: 'bm-1',
        name: 'Example',
        url: 'https://old.example',
        categoryId: 'cat-1',
      }],
      meta: {
        'https://old.example': {
          alternateUrls: ['https://backup.example'],
        },
      },
    })

    await useNavStore.getState().reconcileBookmarkUrlChange(
      '1',
      'https://new.example',
    )

    expect(useNavStore.getState().meta).toEqual({
      'https://new.example': {
        alternateUrls: ['https://backup.example'],
      },
    })
  })

  it('keeps metadata on an old URL that another bookmark still uses', async () => {
    const sharedMeta = {
      alternateUrls: ['https://backup.example'],
    }
    useNavStore.setState({
      bookmarks: [
        {
          id: 'bm-1',
          name: 'First',
          url: 'https://old.example',
          categoryId: 'cat-1',
        },
        {
          id: 'bm-2',
          name: 'Second',
          url: 'https://old.example',
          categoryId: 'cat-1',
        },
      ],
      meta: { 'https://old.example': sharedMeta },
    })

    await useNavStore.getState().reconcileBookmarkUrlChange(
      '1',
      'https://new.example',
    )

    expect(useNavStore.getState().meta).toEqual({
      'https://old.example': sharedMeta,
      'https://new.example': sharedMeta,
    })
  })

  it('keeps alternate URLs entered while an older sync is in flight', () => {
    const baseline = {
      'https://example.test': { description: 'Before' },
    }
    const current = {
      'https://example.test': {
        description: 'Before',
        alternateUrls: ['https://backup.example'],
      },
    }

    expect(applyMaterializedBookmarkMetadata(
      current,
      { 'https://example.test': { description: 'Remote' } },
      undefined,
      { baseline },
    )).toEqual({
      'https://example.test': {
        description: 'Remote',
        alternateUrls: ['https://backup.example'],
      },
    })
  })

  it('keeps local metadata for bookmarks omitted from the sync payload', () => {
    const local = {
      'https://example.test': {
        alternateUrls: ['https://backup.example'],
      },
    }

    expect(applyMaterializedBookmarkMetadata(
      local,
      {},
      undefined,
      { omittedUrls: ['https://example.test'] },
    )).toEqual(local)
  })

  it('merges alternate URLs when adding data to a duplicate bookmark', () => {
    expect(mergeAlternateUrlsForDuplicate(
      ['https://backup-one.example'],
      ['backup-two.example', 'https://backup-one.example'],
      'https://primary.example',
    )).toEqual([
      'https://backup-one.example',
      'https://backup-two.example',
    ])
  })

  it('restores a metadata sync recovery point', async () => {
    vi.useFakeTimers()
    useNavStore.setState({
      meta: { 'https://example.test': { description: 'Remote' } },
      categoryMeta: { 'cat-1': { emoji: 'B' } },
      metadataSyncRecovery: [
        {
          id: 'recovery-1',
          label: '同步前快照',
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
          direction: 'downloaded',
          bookmarkMeta: { 'https://example.test': { description: 'Local' } },
          categoryMeta: { 'cat-1': { emoji: 'A' } },
          changedBookmarkCount: 1,
          changedCategoryCount: 1,
          removedFieldCount: 0,
        },
      ],
    })

    await expect(
      useNavStore.getState().restoreMetadataSyncRecovery('recovery-1'),
    ).resolves.toBe(true)

    expect(useNavStore.getState().meta).toEqual({
      'https://example.test': { description: 'Local' },
    })
    expect(useNavStore.getState().categoryMeta).toEqual({
      'cat-1': { emoji: 'A' },
    })
    expect(useNavStore.getState().metadataSyncRecovery).toEqual([])
    expect(storageState.values.get('local:moorread:meta')).toEqual(useNavStore.getState().meta)
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function drainMetadataTimer() {
  vi.stubGlobal('chrome', { bookmarks: {} })
  await vi.advanceTimersByTimeAsync(metadataAutoSyncDelayMs)
}

describe('metadata concurrency regressions', () => {
  it('ignores an older storage refresh that finishes after a newer refresh', async () => {
    const oldRead = deferred<Record<string, { alternateUrls: string[] }>>()
    vi.spyOn(metaStorage, 'get').mockImplementationOnce(() => oldRead.promise)
    const oldRefresh = useNavStore.getState().refreshSupplementaryMetadata()
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { alternateUrls: ['https://new.example'] },
    })
    await useNavStore.getState().refreshSupplementaryMetadata()
    oldRead.resolve({ 'https://example.test': { alternateUrls: ['https://old.example'] } })
    await oldRefresh
    expect(useNavStore.getState().meta['https://example.test'].alternateUrls)
      .toEqual(['https://new.example'])
  })

  it('keeps a durable edit made during a pending storage refresh', async () => {
    vi.useFakeTimers()
    const oldRead = deferred<Record<string, { alternateUrls: string[] }>>()
    vi.spyOn(metaStorage, 'get').mockImplementationOnce(() => oldRead.promise)
    const refresh = useNavStore.getState().refreshSupplementaryMetadata()
    await useNavStore.getState().setBookmarkMeta('https://example.test', {
      alternateUrls: ['https://new.example'],
    })
    oldRead.resolve({ 'https://example.test': { alternateUrls: ['https://old.example'] } })
    await refresh
    expect(useNavStore.getState().meta['https://example.test'].alternateUrls)
      .toEqual(['https://new.example'])
    await drainMetadataTimer()
  })

  it('moves metadata through rapid native URL changes before refreshing or saving', async () => {
    vi.useFakeTimers()
    const oldUrl = 'https://old.example'
    const newUrl = 'https://new.example'
    const finalUrl = 'https://final.example'
    useNavStore.setState({
      bookmarks: [{ id: 'bm-1', name: 'Site', url: oldUrl, categoryId: 'all' }],
      meta: { [oldUrl]: { alternateUrls: ['https://old-backup.example'] } },
    })
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => [{
      id: '0',
      title: '',
      children: [{ id: '1', title: 'Site', url: finalUrl }],
    }] } })
    const entered = deferred<void>()
    const release = deferred<void>()
    const blocker = withBookmarkMetadataLock(async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    const firstMigration = useNavStore.getState().reconcileBookmarkUrlChange('1', newUrl)
    const secondMigration = useNavStore.getState().reconcileBookmarkUrlChange('1', finalUrl)
    const save = useNavStore.getState().updateBookmark('bm-1', {
      alternateUrls: ['https://new-backup.example'],
    })
    const refresh = useNavStore.getState().loadBookmarks()
    release.resolve()
    await Promise.all([blocker, firstMigration, secondMigration, save, refresh])
    expect(storageState.values.get('local:moorread:meta')).toEqual({
      [finalUrl]: { alternateUrls: ['https://new-backup.example'] },
    })
    expect(useNavStore.getState().bookmarks[0]).toMatchObject({
      url: finalUrl,
      alternateUrls: ['https://new-backup.example'],
    })
    await drainMetadataTimer()
  })

  it('discards a native tree snapshot captured before an URL migration', async () => {
    vi.useFakeTimers()
    const oldUrl = 'https://old.example'
    const newUrl = 'https://new.example'
    useNavStore.setState({
      bookmarks: [{ id: 'bm-1', name: 'Site', url: oldUrl, categoryId: 'all' }],
      meta: { [oldUrl]: { alternateUrls: ['https://backup.example'] } },
    })
    const oldTree = deferred<chrome.bookmarks.BookmarkTreeNode[]>()
    const entered = deferred<void>()
    const getTree = vi.fn().mockImplementationOnce(() => {
      entered.resolve()
      return oldTree.promise
    }).mockResolvedValue([{
      id: '0',
      title: '',
      children: [{ id: '1', title: 'Site', url: newUrl }],
    }])
    vi.stubGlobal('chrome', { bookmarks: { getTree } })
    const load = useNavStore.getState().loadBookmarks()
    await entered.promise
    await useNavStore.getState().reconcileBookmarkUrlChange('1', newUrl)
    oldTree.resolve([{
      id: '0',
      title: '',
      syncing: false,
      children: [{ id: '1', title: 'Site', url: oldUrl, syncing: false }],
    }])
    await load
    expect(getTree).toHaveBeenCalledTimes(2)
    expect(useNavStore.getState().bookmarks[0]).toMatchObject({
      url: newUrl,
      alternateUrls: ['https://backup.example'],
    })
    await drainMetadataTimer()
  })

  it('merges duplicate alternate URLs against the latest stored values', async () => {
    vi.useFakeTimers()
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { alternateUrls: ['https://other-page.example'] },
    })
    await useNavStore.getState().setBookmarkMeta('https://example.test', latest => ({
      alternateUrls: mergeAlternateUrlsForDuplicate(
        latest.alternateUrls,
        ['https://entered.example'],
        'https://example.test',
      ),
    }))
    expect(useNavStore.getState().meta['https://example.test'].alternateUrls)
      .toEqual(['https://other-page.example', 'https://entered.example'])
    await drainMetadataTimer()
  })

  it('preserves other-page metadata when importing a backup into stale state', async () => {
    vi.useFakeTimers()
    const backup = JSON.parse(useNavStore.getState().exportBackup())
    backup.bookmarkMeta = { 'https://example.test': { description: 'Imported' } }
    backup.categoryMeta = [{ path: ['Folder'], emoji: 'Imported' }]
    backup.usage = { 'https://example.test': { openCount: 9, lastOpenedAt: 9 } }
    useNavStore.setState({ categories: [{ id: 'cat-1', name: 'Folder', emoji: '📁', parentId: 'all', modifiable: false }] })
    storageState.values.set('local:moorread:category-meta', { 'cat-2': { emoji: 'Keep' } })
    storageState.values.set('local:moorread:usage', { 'https://other.example': { openCount: 1, lastOpenedAt: 1 } })
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { alternateUrls: ['https://backup.example'] },
      'https://other.example': { tags: ['keep'] },
    })
    vi.stubGlobal('chrome', { bookmarks: { getTree: async () => [{ id: '0', title: '', children: [] }] } })
    await useNavStore.getState().importBackup(JSON.stringify(backup))
    expect(storageState.values.get('local:moorread:meta')).toEqual({
      'https://example.test': { alternateUrls: ['https://backup.example'], description: 'Imported' },
      'https://other.example': { tags: ['keep'] },
    })
    expect(storageState.values.get('local:moorread:category-meta')).toEqual({
      'cat-1': { emoji: 'Imported' },
      'cat-2': { emoji: 'Keep' },
    })
    expect(storageState.values.get('local:moorread:usage')).toEqual({
      'https://example.test': { openCount: 9, lastOpenedAt: 9 },
      'https://other.example': { openCount: 1, lastOpenedAt: 1 },
    })
    await drainMetadataTimer()
  })

  it('preserves alternate URLs saved while a description is being fetched', async () => {
    vi.useFakeTimers()
    const fetched = deferred<string | undefined>()
    vi.spyOn(siteMetadata, 'fetchSiteDescription').mockReturnValue(fetched.promise)
    useNavStore.setState({
      bookmarks: [{ id: 'bm-1', name: 'Site', url: 'https://example.test', categoryId: 'all' }],
    })
    const fetch = useNavStore.getState().syncBookmarkDescriptions(['bm-1'])
    await useNavStore.getState().setBookmarkMeta('https://example.test', {
      alternateUrls: ['https://backup.example'],
    })
    fetched.resolve('Fetched description')
    await fetch
    expect(storageState.values.get('local:moorread:meta')).toEqual({
      'https://example.test': {
        alternateUrls: ['https://backup.example'],
        description: 'Fetched description',
      },
    })
    await drainMetadataTimer()
  })

  it('preserves an edit queued while cloud application saves its recovery point', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { bookmarks: {}, storage: { sync: {} } })
    vi.spyOn(metadataSync, 'synchronizeMetadata').mockResolvedValue({
      direction: 'downloaded',
      document: { bookmarkMeta: { 'https://example.test': { description: 'Remote' } }, categoryMeta: [] },
      omittedBookmarkCount: 0,
      omittedBookmarkUrls: [],
      byteCount: 100,
      syncedAt: 1,
      retryCount: 0,
    })
    const entered = deferred<void>()
    const release = deferred<void>()
    storageState.setHook = async (key) => {
      if (key === 'moorread:metadata-sync-recovery') {
        entered.resolve()
        await release.promise
      }
    }
    const sync = useNavStore.getState().syncMetadataNow()
    await entered.promise
    const save = useNavStore.getState().setBookmarkMeta('https://example.test', {
      alternateUrls: ['https://backup.example'],
    })
    release.resolve()
    await Promise.all([sync, save])
    expect(storageState.values.get('local:moorread:meta')).toEqual({
      'https://example.test': { description: 'Remote', alternateUrls: ['https://backup.example'] },
    })
    await drainMetadataTimer()
  })

  it('retains category icon edits and removals made by another page during sync', async () => {
    vi.stubGlobal('chrome', { bookmarks: {}, storage: { sync: {} } })
    const remote = deferred<Awaited<ReturnType<typeof metadataSync.synchronizeMetadata>>>()
    vi.spyOn(metadataSync, 'synchronizeMetadata').mockReturnValue(remote.promise)
    useNavStore.setState({
      categories: [
        { id: 'cat-1', name: 'One', emoji: 'Before', parentId: 'all', modifiable: false },
        { id: 'cat-2', name: 'Two', emoji: 'Before', parentId: 'all', modifiable: false },
      ],
      categoryMeta: { 'cat-1': { emoji: 'Before' }, 'cat-2': { emoji: 'Before' } },
    })
    const sync = useNavStore.getState().syncMetadataNow()
    storageState.values.set('local:moorread:category-meta', { 'cat-1': { emoji: 'Edited' } })
    remote.resolve({
      direction: 'downloaded',
      document: { bookmarkMeta: {}, categoryMeta: [{ path: ['One'], emoji: 'Remote' }, { path: ['Two'], emoji: 'Remote' }] },
      omittedBookmarkCount: 0,
      omittedBookmarkUrls: [],
      byteCount: 100,
      syncedAt: 1,
      retryCount: 0,
    })
    await sync
    expect(storageState.values.get('local:moorread:category-meta')).toEqual({ 'cat-1': { emoji: 'Edited' } })
  })
})

function stubRestoreChrome(options: { failAt?: number } = {}) {
  let created = 0
  const create = vi.fn(async (details: chrome.bookmarks.CreateDetails) => {
    created += 1
    if (options.failAt === created)
      throw new Error('bookmark create failed')
    return { id: `node-${created}`, title: details.title ?? '', url: details.url }
  })
  const removeTree = vi.fn(async () => undefined)
  vi.stubGlobal('chrome', {
    bookmarks: {
      create,
      removeTree,
      getTree: async () => [{ id: '0', title: '', children: [{ id: '1', title: '書籤列', children: [] }] }],
    },
    storage: {
      sync: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    },
  })
  return { create, removeTree }
}

function legacySnapshot(options: {
  settings?: Record<string, unknown>
  bookmarkGroups?: unknown
  roots?: unknown[]
} = {}) {
  const yunjiTab: Record<string, unknown> = {
    schemaVersion: 1,
    exportedAt: '2020-06-01T00:00:00.000Z',
    settings: options.settings ?? { theme: 'dark' },
    bookmarkMeta: {},
    categoryMeta: [],
    usage: {},
  }
  if ('bookmarkGroups' in options)
    yunjiTab.bookmarkGroups = options.bookmarkGroups
  return JSON.stringify({
    kind: 'yunji-tab-full-bookmark-snapshot',
    schemaVersion: 1,
    exportedAt: '2020-06-01T00:00:00.000Z',
    yunjiTab,
    roots: options.roots ?? [{ title: '書籤列', children: [{ title: 'Legacy', url: 'https://legacy.example' }] }],
  })
}

describe('restore full backup safety', () => {
  it('keeps current settings that an older backup does not contain', async () => {
    stubRestoreChrome()
    const currentNativeSort = { ...DEFAULT_SETTINGS.nativeBookmarkSort, enabled: true, autoSort: true }
    const currentGistBackup = { token: 'secret-token', gistId: 'gist-1', encrypt: true, passphrase: 'secret-pass' }
    useNavStore.setState({
      settings: { ...DEFAULT_SETTINGS, theme: 'light', nativeBookmarkSort: currentNativeSort, gistBackup: currentGistBackup },
      meta: { 'https://existing.example': { tags: ['keep'] } },
    })

    const result = await useNavStore.getState().restoreFullBackup(legacySnapshot({
      settings: { theme: 'dark', language: 'en' },
    }))

    expect(result.restoredNodeCount).toBeGreaterThan(0)
    const settings = useNavStore.getState().settings
    expect(settings.theme).toBe('dark')
    expect(settings.language).toBe('en')
    expect(settings.nativeBookmarkSort).toEqual(currentNativeSort)
    expect(settings.gistBackup).toEqual(currentGistBackup)
    expect(useNavStore.getState().meta['https://existing.example']).toEqual({ tags: ['keep'] })
  })

  it('does not touch bookmark groups when the backup has no bookmarkGroups field', async () => {
    stubRestoreChrome()
    useBookmarkGroupsStore.setState({ groups: [{ id: 'keep', title: '保留', description: '', icon: '', pinnedAt: 0, sortOrder: 0, pinnedOrder: 0, bookmarks: [] }] })
    const restoreSpy = vi.spyOn(useBookmarkGroupsStore.getState(), 'restore')

    await useNavStore.getState().restoreFullBackup(legacySnapshot())

    expect(restoreSpy).not.toHaveBeenCalled()
    expect(useBookmarkGroupsStore.getState().groups.map(group => group.id)).toEqual(['keep'])
  })

  it('still replaces bookmark groups when the backup explicitly provides an empty array', async () => {
    stubRestoreChrome()
    useBookmarkGroupsStore.setState({ groups: [{ id: 'keep', title: '保留', description: '', icon: '', pinnedAt: 0, sortOrder: 0, pinnedOrder: 0, bookmarks: [] }] })
    const restoreSpy = vi.spyOn(useBookmarkGroupsStore.getState(), 'restore')

    await useNavStore.getState().restoreFullBackup(legacySnapshot({ bookmarkGroups: [] }))

    expect(restoreSpy).toHaveBeenCalledWith([], 'replace')
  })

  it('restores bookmark groups that the backup provides', async () => {
    stubRestoreChrome()
    const groups = [{
      id: 'tools',
      title: '工具',
      description: '',
      icon: '🛠️',
      pinnedAt: 1,
      sortOrder: 0,
      pinnedOrder: 0,
      bookmarks: [{ id: 'docs', url: 'https://docs.example', title: 'Docs' }],
    }]

    await useNavStore.getState().restoreFullBackup(legacySnapshot({ bookmarkGroups: groups }))

    expect(useBookmarkGroupsStore.getState().groups.map(group => group.id)).toEqual(['tools'])
  })

  it('removes the created folder and keeps existing data when a node write fails midway', async () => {
    const { removeTree } = stubRestoreChrome({ failAt: 2 })
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const }
    useNavStore.setState({ settings, meta: { 'https://existing.example': { tags: ['keep'] } } })
    const writesBefore = storageState.writes.length

    await expect(useNavStore.getState().restoreFullBackup(legacySnapshot({ settings: { theme: 'dark' } })))
      .rejects
      .toThrow('bookmark create failed')

    expect(removeTree).toHaveBeenCalledWith('node-1')
    expect(useNavStore.getState().settings).toEqual(settings)
    expect(useNavStore.getState().meta).toEqual({ 'https://existing.example': { tags: ['keep'] } })
    expect(storageState.writes.slice(writesBefore).filter(write => write.key === 'moorread:settings')).toEqual([])
  })

  it('rolls back settings and metadata when the settings write fails', async () => {
    const { removeTree } = stubRestoreChrome()
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const, gistBackup: { token: 'secret-token', gistId: 'gist-1', encrypt: true, passphrase: 'secret-pass' } }
    useNavStore.setState({ settings, meta: { 'https://existing.example': { tags: ['keep'] } } })
    storageState.setHook = async (key) => {
      if (key === 'moorread:settings')
        throw new Error('settings write failed')
    }

    await expect(useNavStore.getState().restoreFullBackup(legacySnapshot({ settings: { theme: 'dark' } })))
      .rejects
      .toThrow('settings write failed')

    expect(removeTree).toHaveBeenCalled()
    expect(useNavStore.getState().settings).toEqual(settings)
    expect(useNavStore.getState().settings.gistBackup?.token).toBe('secret-token')
    expect(useNavStore.getState().meta).toEqual({ 'https://existing.example': { tags: ['keep'] } })
  })

  it('keeps current settings when supplementary metadata omits newer fields', async () => {
    vi.stubGlobal('chrome', {
      bookmarks: {
        getTree: async () => [{ id: '0', title: '', children: [{ id: '1', title: '書籤列', children: [] }] }],
      },
    })
    const currentNativeSort = { ...DEFAULT_SETTINGS.nativeBookmarkSort, enabled: true }
    useNavStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'light', nativeBookmarkSort: currentNativeSort } })

    await useNavStore.getState().importBackup(JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2020-06-01T00:00:00.000Z',
      settings: { theme: 'dark' },
      bookmarkMeta: {},
      categoryMeta: [],
      usage: {},
    }), 'merge')

    expect(useNavStore.getState().settings.theme).toBe('dark')
    expect(useNavStore.getState().settings.nativeBookmarkSort).toEqual(currentNativeSort)
  })

  it('writes nothing when the snapshot fails validation', async () => {
    const { create, removeTree } = stubRestoreChrome()
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const }
    useNavStore.setState({ settings, meta: { 'https://existing.example': { tags: ['keep'] } } })
    const writesBefore = storageState.writes.length

    await expect(useNavStore.getState().restoreFullBackup(JSON.stringify({ kind: 'unknown-snapshot' })))
      .rejects
      .toThrow('snapshot.unsupported_version')

    expect(create).not.toHaveBeenCalled()
    expect(removeTree).not.toHaveBeenCalled()
    expect(useNavStore.getState().settings).toEqual(settings)
    expect(storageState.writes.slice(writesBefore)).toEqual([])
  })
})
