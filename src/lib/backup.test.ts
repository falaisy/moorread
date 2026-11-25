import type { Category, Settings } from './types'

import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE_SETTINGS } from './appearance'
import {
  createFullBookmarkSnapshot,
  createMoorreadBackup,
  parseFullBookmarkSnapshot,
  parseMoorreadBackup,
} from './backup'
import { DEFAULT_KEYBOARD_SHORTCUTS } from './keyboard-shortcuts'
import { DEFAULT_HEADER_WIDGET } from './weather'

const settings: Settings = {
  headerWidget: {
    ...DEFAULT_HEADER_WIDGET,
    temperatureUnit: 'fahrenheit',
    location: { name: '上海', latitude: 31.22, longitude: 121.46 },
  },
  bookmarkGroupsEnabled: false,
  language: 'zh-TW',
  theme: 'system',
  defaultCategoryId: 'cat-docs',
  singleHomeTab: true,
  globalCommandPaletteEnabled: true,
  descriptionIgnoredDomains: [],
  customSearchEngines: [],
  bookmarkSortMode: 'manual',
  bookmarkViewMode: 'grid',
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  savedSearches: [],
  metadataSyncScope: {
    description: true,
    icon: true,
    alternateUrls: true,
    pinnedAt: true,
    tags: true,
    inboxAt: true,
    categoryIcons: true,
  },
  metadataSyncEncryptionEnabled: false,
  autoOrganizeRules: [],
  autoOrganizeOnSave: true,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  nativeBookmarkSort: { enabled: false, autoSort: false, sortCriteria: [{ field: 'title', direction: 'asc' }], includeSubfolders: false, sortSelf: true, targetMode: 'all', targetFolderIds: [], ignoreFolderIds: [] },
  gistBackup: { token: '', gistId: '', encrypt: false, passphrase: '' },
}

const categories: Category[] = [
  {
    id: 'cat-work',
    name: '工作',
    emoji: '📁',
    parentId: 'all',
    modifiable: true,
  },
  {
    id: 'cat-docs',
    name: '文档',
    emoji: '📁',
    parentId: 'cat-work',
    modifiable: true,
  },
]

describe('yunji tab backup', () => {
  it('keeps bookmark metadata including pinned state', () => {
    const backup = createMoorreadBackup({
      settings,
      categories,
      bookmarkGroups: [{ id: 'tools', title: '工具', description: '日常使用', icon: '🛠️', pinnedAt: 123, sortOrder: 2, pinnedOrder: -50, bookmarks: [{ id: 'docs', url: 'https://example.com', title: '组内文档' }] }],
      meta: {
        'https://example.com': {
          description: 'Example',
          pinnedAt: 123,
          pinnedOrder: -100.5,
          tags: ['AI', '文档'],
          inboxAt: 789,
        },
      },
      categoryMeta: {
        'cat-docs': { emoji: '📚' },
      },
      usage: {
        'https://example.com': {
          openCount: 2,
          lastOpenedAt: 456,
        },
      },
    })

    const parsed = parseMoorreadBackup(JSON.stringify(backup))

    expect(parsed.bookmarkMeta['https://example.com']?.pinnedAt).toBe(123)
    expect(parsed.bookmarkMeta['https://example.com']?.pinnedOrder).toBe(-100.5)
    expect(parsed.bookmarkMeta['https://example.com']?.tags).toEqual([
      'AI',
      '文档',
    ])
    expect(parsed.bookmarkMeta['https://example.com']?.inboxAt).toBe(789)
    expect(parsed.categoryMeta).toEqual([
      { path: ['工作', '文档'], emoji: '📚' },
    ])
    expect(parsed.defaultCategoryPath).toEqual(['工作', '文档'])
    expect(parsed.settings.globalCommandPaletteEnabled).toBe(true)
    expect(parsed.settings.bookmarkGroupsEnabled).toBe(false)
    expect(parsed.settings.headerWidget).toEqual(settings.headerWidget)
    expect(parsed.bookmarkGroups).toEqual(backup.bookmarkGroups)
    const legacy = { ...backup, settings: { ...backup.settings } }
    delete legacy.bookmarkGroups
    delete (legacy.settings as Partial<Settings>).bookmarkGroupsEnabled
    delete (legacy.settings as Partial<Settings>).headerWidget
    expect(parseMoorreadBackup(JSON.stringify(legacy)).settings.headerWidget).toEqual(DEFAULT_HEADER_WIDGET)
    expect(parseMoorreadBackup(JSON.stringify(legacy)).settings.bookmarkGroupsEnabled).toBe(true)
    expect(parseMoorreadBackup(JSON.stringify(legacy)).bookmarkGroups).toEqual([])
  })

  it('strips sensitive fields (gist token/passphrase) from backup payload', () => {
    const settingsWithSecrets: Settings = {
      ...settings,
      gistBackup: {
        token: 'ghp_abcdef1234567890ghijklmnopqrstuvwxyz',
        gistId: 'abc123def456',
        encrypt: true,
        passphrase: 'my-secret-backup-passphrase',
      },
    }

    const backup = createMoorreadBackup({
      settings: settingsWithSecrets,
      categories,
      meta: {},
      categoryMeta: {},
      usage: {},
    })

    expect(backup.settings.gistBackup.token).toBe('')
    expect(backup.settings.gistBackup.passphrase).toBe('')
    // 非敏感欄位保留
    expect(backup.settings.gistBackup.gistId).toBe('abc123def456')
    expect(backup.settings.gistBackup.encrypt).toBe(true)

    // JSON 序列化後也不含敏感字串（防 grep 級別外洩）
    const json = JSON.stringify(backup)
    expect(json).not.toContain('ghp_abcdef1234567890ghijklmnopqrstuvwxyz')
    expect(json).not.toContain('my-secret-backup-passphrase')
  })

  it('round-trips encrypted backup through parseMoorreadBackup with secrets excluded', () => {
    const settingsWithSecrets: Settings = {
      ...settings,
      gistBackup: {
        token: 'ghp_SECRET_TOKEN_PLACEHOLDER',
        gistId: 'xyz789',
        encrypt: false,
        passphrase: 'super-secret',
      },
    }
    const backup = createMoorreadBackup({
      settings: settingsWithSecrets,
      categories,
      meta: {},
      categoryMeta: {},
      usage: {},
    })
    const parsed = parseMoorreadBackup(JSON.stringify(backup))
    expect(parsed.settings.gistBackup.token).toBe('')
    expect(parsed.settings.gistBackup.passphrase).toBe('')
    expect(parsed.settings.gistBackup.gistId).toBe('xyz789')
  })

  it('parses full native bookmark snapshots', () => {
    const moorreadBackup = createMoorreadBackup({
      settings,
      categories,
      meta: {},
      categoryMeta: {},
      usage: {},
    })
    const snapshot = createFullBookmarkSnapshot({
      moorread: moorreadBackup,
      nativeRoots: [
        {
          id: '1',
          title: '书签栏',
          children: [
            {
              id: '10',
              title: '工作',
              children: [{ id: '11', title: 'Example', url: 'https://e.test' }],
            },
          ],
        } as chrome.bookmarks.BookmarkTreeNode,
      ],
    })

    const parsed = parseFullBookmarkSnapshot(JSON.stringify(snapshot))

    expect(parsed.roots[0]?.title).toBe('书签栏')
    expect(parsed.roots[0]?.children?.[0]?.children?.[0]?.url).toBe(
      'https://e.test',
    )
  })
})

describe('legacy yunji-tab full snapshot adapter', () => {
  const legacySettings = { ...settings }
  delete (legacySettings as Partial<Settings>).nativeBookmarkSort
  delete (legacySettings as Partial<Settings>).gistBackup

  const legacyRaw = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    kind: 'yunji-tab-full-bookmark-snapshot',
    schemaVersion: 1,
    exportedAt: '2020-06-01T00:00:00.000Z',
    yunjiTab: {
      schemaVersion: 1,
      exportedAt: '2020-06-01T00:00:00.000Z',
      settings: legacySettings,
      bookmarkMeta: {},
      categoryMeta: [],
      usage: {},
      ...overrides,
    },
    roots: [{ title: '書籤列', children: [{ title: 'Old', url: 'https://old.example' }] }],
  })

  it('converts 0.1.5/0.1.6 snapshots and reports which settings really existed', () => {
    const parsed = parseFullBookmarkSnapshot(legacyRaw())

    expect(parsed.legacy).toBe(true)
    expect(parsed.kind).toBe('moorread-full-bookmark-snapshot')
    expect(parsed.roots[0]?.children?.[0]?.url).toBe('https://old.example')
    expect(parsed.moorread.presentSettings).not.toContain('nativeBookmarkSort')
    expect(parsed.moorread.presentSettings).not.toContain('gistBackup')
    expect(parsed.moorread.presentSettings).toContain('theme')
    // parser 仍會把缺少的欄位補成預設值，但 presentSettings 讓還原層知道不可覆蓋現值。
    expect(parsed.moorread.settings.nativeBookmarkSort).toBeDefined()
    expect(parsed.moorread.bookmarkGroupsProvided).toBe(false)
  })

  it('keeps bookmarkGroups presence distinct from an explicit empty array', () => {
    expect(parseFullBookmarkSnapshot(legacyRaw({ bookmarkGroups: [] })).moorread.bookmarkGroupsProvided).toBe(true)
    expect(parseFullBookmarkSnapshot(legacyRaw({ bookmarkGroups: [] })).moorread.bookmarkGroups).toEqual([])
    expect(() => parseFullBookmarkSnapshot(legacyRaw({ bookmarkGroups: {} }))).toThrow('backup.missing_data')
  })

  it('rejects incomplete or unsupported legacy snapshots', () => {
    const missingShell = JSON.parse(legacyRaw()) as Record<string, unknown>
    delete missingShell.yunjiTab
    expect(() => parseFullBookmarkSnapshot(JSON.stringify(missingShell))).toThrow('snapshot.unsupported_version')

    const missingRoots = JSON.parse(legacyRaw()) as Record<string, unknown>
    delete missingRoots.roots
    expect(() => parseFullBookmarkSnapshot(JSON.stringify(missingRoots))).toThrow('snapshot.unsupported_version')

    const wrongVersion = JSON.parse(legacyRaw()) as Record<string, unknown>
    wrongVersion.schemaVersion = 2
    expect(() => parseFullBookmarkSnapshot(JSON.stringify(wrongVersion))).toThrow('snapshot.unsupported_version')

    const unknownKind = JSON.parse(legacyRaw()) as Record<string, unknown>
    unknownKind.kind = 'yunji-tab-something-else'
    expect(() => parseFullBookmarkSnapshot(JSON.stringify(unknownKind))).toThrow('snapshot.unsupported_version')
  })

  it('does not treat kind-less supplementary data as a full snapshot, or vice versa', () => {
    const supplementary = JSON.stringify(createMoorreadBackup({
      settings,
      categories,
      meta: {},
      categoryMeta: {},
      usage: {},
    }))

    expect(parseMoorreadBackup(supplementary).settings.theme).toBe('system')
    expect(() => parseFullBookmarkSnapshot(supplementary)).toThrow('snapshot.unsupported_version')
    expect(() => parseMoorreadBackup(legacyRaw())).toThrow('backup.missing_data')
  })

  it('keeps parsing current-format snapshots without the legacy marker', () => {
    const snapshot = createFullBookmarkSnapshot({
      moorread: createMoorreadBackup({ settings, categories, meta: {}, categoryMeta: {}, usage: {} }),
      nativeRoots: [{ id: '1', title: '书签栏', children: [] } as chrome.bookmarks.BookmarkTreeNode],
    })

    const parsed = parseFullBookmarkSnapshot(JSON.stringify(snapshot))

    expect(parsed.legacy).toBeUndefined()
    expect(parsed.moorread.bookmarkGroupsProvided).toBe(true)
    expect(parsed.moorread.presentSettings).toContain('nativeBookmarkSort')
  })
})
