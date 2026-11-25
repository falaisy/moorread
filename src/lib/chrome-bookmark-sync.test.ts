import type { BookmarkTreeNode } from './bookmark-tree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_FOLDER_TITLE,
  exportToChromeBookmarks,
  importFromChromeBookmarks,
} from './chrome-bookmark-sync'

function bookmarkNode(partial: Partial<BookmarkTreeNode> & { id: string, url: string, title: string }): BookmarkTreeNode {
  return { syncing: false, children: undefined, ...partial } as BookmarkTreeNode
}

function folderNode(partial: Partial<BookmarkTreeNode> & { id: string }): BookmarkTreeNode {
  return { syncing: false, children: undefined, title: '', url: undefined, unmodifiable: undefined, ...partial } as BookmarkTreeNode
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('importFromChromeBookmarks', () => {
  const makeTree = (chromeBookmarks: BookmarkTreeNode[]): BookmarkTreeNode[] => [{
    id: '0',
    title: '',
    syncing: false,
    children: [folderNode({ id: '1', title: 'Other bookmarks', children: chromeBookmarks })],
  }]

  it('imports new bookmarks and counts added/skipped', async () => {
    const bookmarks = [
      bookmarkNode({ id: 'cb1', title: 'GitHub', url: 'https://github.com', dateAdded: 100 }),
      bookmarkNode({ id: 'cb2', title: 'Mozilla', url: 'https://mozilla.org', dateAdded: 200 }),
    ]
    const getTree = vi.fn(async () => makeTree(bookmarks))
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([])
    expect(result.added).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.items).toHaveLength(2)
    expect(result.items).toEqual(expect.arrayContaining([
      { name: 'GitHub', url: 'https://github.com', dateAdded: 100 },
      { name: 'Mozilla', url: 'https://mozilla.org', dateAdded: 200 },
    ]))
  })

  it('skips bookmarks already present in Moorread (canonical key match)', async () => {
    const bookmarks = [
      bookmarkNode({ id: 'cb1', title: 'GitHub', url: 'https://github.com' }),
      bookmarkNode({ id: 'cb2', title: 'New Thing', url: 'https://new.test' }),
    ]
    const getTree = vi.fn(async () => makeTree(bookmarks))
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([
      { name: 'GitHub', url: 'https://github.com/' }, // trailing slash 不影響
    ])
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('New Thing')
  })

  it('handles canonical key: trailing slash, trim, lowercase', async () => {
    const bookmarks = [
      bookmarkNode({ id: 'cb1', title: '  GitHub  ', url: 'https://GITHUB.COM/' }),
    ]
    const getTree = vi.fn(async () => makeTree(bookmarks))
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([
      { name: 'github', url: 'https://github.com' },
    ])
    expect(result.skipped).toBe(1)
    expect(result.added).toBe(0)
  })

  it('deduplicates within the same Chrome batch', async () => {
    const bookmarks = [
      bookmarkNode({ id: 'cb1', title: 'Dup', url: 'https://dup.co' }),
      bookmarkNode({ id: 'cb2', title: 'Dup', url: 'https://dup.co/' }),
    ]
    const getTree = vi.fn(async () => makeTree(bookmarks))
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([])
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('flattens nested folders and imports all URLs', async () => {
    const tree: BookmarkTreeNode[] = [{
      id: '0',
      title: '',
      syncing: false,
      children: [
        folderNode({
          id: '1',
          title: 'Root',
          children: [
            bookmarkNode({ id: 'cb1', title: 'L1', url: 'https://l1.co' }),
            folderNode({
              id: '2',
              title: 'Nested',
              children: [
                bookmarkNode({ id: 'cb2', title: 'L2', url: 'https://l2.co' }),
              ],
            }),
          ],
        }),
      ],
    }]
    const getTree = vi.fn(async () => tree)
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([])
    expect(result.added).toBe(2)
  })

  it('ignores folder nodes (nodes without URL)', async () => {
    const tree: BookmarkTreeNode[] = [{
      id: '0',
      title: '',
      syncing: false,
      children: [
        folderNode({ id: '1', title: 'Folder Only' }),
        bookmarkNode({ id: '2', title: 'Real', url: 'https://real.co' }),
      ],
    }]
    const getTree = vi.fn(async () => tree)
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([])
    expect(result.added).toBe(1)
    expect(result.items[0].name).toBe('Real')
  })

  it('uses empty string as title when title is missing/nullish', async () => {
    const tree: BookmarkTreeNode[] = [{
      id: '0',
      title: '',
      syncing: false,
      children: [
        bookmarkNode({ id: 'cb1', title: '', url: 'https://example.com' }),
      ],
    }]
    const getTree = vi.fn(async () => tree)
    vi.stubGlobal('chrome', { bookmarks: { getTree } })

    const result = await importFromChromeBookmarks([])
    expect(result.added).toBe(1)
    expect(result.items[0].name).toBe('')
    expect(result.items[0].url).toBe('https://example.com')
  })
})

describe('exportToChromeBookmarks', () => {
  const makeTree = (otherChildren: BookmarkTreeNode[] = []): BookmarkTreeNode[] => [{
    id: '0',
    title: '',
    syncing: false,
    children: [folderNode({ id: '1', title: 'Other bookmarks', children: otherChildren })],
  }]

  it('throws when folderTitle is a Chrome root id', async () => {
    const getTree = vi.fn(async () => makeTree())
    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren: vi.fn(), create: vi.fn() } })
    await expect(exportToChromeBookmarks([], '0')).rejects.toThrow('invalid folder id')
    await expect(exportToChromeBookmarks([], '1')).rejects.toThrow('invalid folder id')
    await expect(exportToChromeBookmarks([], '2')).rejects.toThrow('invalid folder id')
  })

  it('creates export folder under Other bookmarks when it does not exist', async () => {
    const getTree = vi.fn(async () => makeTree())
    const getChildren = vi.fn(async () => [])
    const createdFolder = folderNode({ id: 'f1', title: EXPORT_FOLDER_TITLE })
    const create = vi.fn(async (opts: { parentId: string, title: string, url?: string }) => {
      if (opts.title === EXPORT_FOLDER_TITLE)
        return createdFolder as BookmarkTreeNode
      return bookmarkNode({ id: 'cb1', title: opts.title, url: opts.url! })
    })

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    const result = await exportToChromeBookmarks([
      { name: 'GitHub', url: 'https://github.com' },
    ])

    expect(create).toHaveBeenCalledWith({ parentId: '1', title: EXPORT_FOLDER_TITLE })
    expect(result.created).toBe(1)
  })

  it('reuses existing export folder', async () => {
    const existingFolder = folderNode({ id: 'existing-folder', title: EXPORT_FOLDER_TITLE })
    const existingChildren: BookmarkTreeNode[] = []
    const getTree = vi.fn(async () => makeTree([existingFolder]))
    const getChildren = vi.fn(async folderId => folderId === 'existing-folder' ? existingChildren : [])
    const create = vi.fn(async opts => bookmarkNode({ id: 'cb-new', title: opts.title, url: opts.url! }))

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    const result = await exportToChromeBookmarks([
      { name: 'New', url: 'https://new.co' },
    ])

    // 不應再建立資料夾
    const folderCreateCalls = create.mock.calls.filter((c: any[]) => c[0].title === EXPORT_FOLDER_TITLE)
    expect(folderCreateCalls).toHaveLength(0)
    expect(result.created).toBe(1)
  })

  it('dedupes against existing children by URL (trailing slash / case insensitive)', async () => {
    const existingChildren: BookmarkTreeNode[] = [
      bookmarkNode({ id: 'cb-existing', title: 'GitHub', url: 'https://github.com/' }),
    ]
    const existingFolder = folderNode({ id: 'existing-folder', title: EXPORT_FOLDER_TITLE })
    const getTree = vi.fn(async () => makeTree([existingFolder]))
    const getChildren = vi.fn(async () => existingChildren)
    const create = vi.fn(async opts => bookmarkNode({ id: 'cb-new', title: opts.title, url: opts.url! }))

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    const result = await exportToChromeBookmarks([
      { name: 'GITHUB', url: 'https://GITHUB.COM' }, // 應被去重
      { name: 'Fresh', url: 'https://fresh.co' }, // 應建立
    ])

    expect(result.created).toBe(1)
    expect(create).toHaveBeenCalledWith({
      parentId: 'existing-folder',
      title: 'Fresh',
      url: 'https://fresh.co',
    })
  })

  it('skips empty URL entries', async () => {
    const existingFolder = folderNode({ id: 'existing-folder', title: EXPORT_FOLDER_TITLE })
    const getTree = vi.fn(async () => makeTree([existingFolder]))
    const getChildren = vi.fn(async () => [])
    const create = vi.fn(async opts => bookmarkNode({ id: 'cb-new', title: opts.title, url: opts.url! }))

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    const result = await exportToChromeBookmarks([
      { name: 'Empty', url: '' },
      { name: 'Valid', url: 'https://valid.co' },
    ])

    expect(result.created).toBe(1)
  })

  it('falls back to URL when bookmark name is empty', async () => {
    const existingFolder = folderNode({ id: 'existing-folder', title: EXPORT_FOLDER_TITLE })
    const getTree = vi.fn(async () => makeTree([existingFolder]))
    const getChildren = vi.fn(async () => [])
    const create = vi.fn(async opts => bookmarkNode({ id: 'cb-new', title: opts.title, url: opts.url! }))

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    await exportToChromeBookmarks([
      { name: '', url: 'https://noname.co' },
    ])

    expect(create).toHaveBeenCalledWith({
      parentId: 'existing-folder',
      title: 'https://noname.co', // fallback to URL
      url: 'https://noname.co',
    })
  })

  it('does not fail the whole batch when a single create fails', async () => {
    const existingFolder = folderNode({ id: 'existing-folder', title: EXPORT_FOLDER_TITLE })
    const getTree = vi.fn(async () => makeTree([existingFolder]))
    const getChildren = vi.fn(async () => [])
    let callCount = 0
    const create = vi.fn(async (opts) => {
      callCount++
      if (callCount === 2)
        throw new Error('chrome refused')
      return bookmarkNode({ id: `cb-${callCount}`, title: opts.title, url: opts.url! })
    })

    vi.stubGlobal('chrome', { bookmarks: { getTree, getChildren, create } })

    const result = await exportToChromeBookmarks([
      { name: 'First', url: 'https://first.co' },
      { name: 'Fail', url: 'https://fail.co' },
      { name: 'Third', url: 'https://third.co' },
    ])

    expect(result.created).toBe(2) // First + Third
  })
})
