import type { Page } from '@playwright/test'
import { expect, test } from './extension.fixture'

const SETTINGS_KEY = 'moorread:settings'
const META_KEY = 'moorread:meta'
const QUICK_SAVE_MSG = 'moorread:quick-save-bookmark'
const uid = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

test('auto-organize rule moves bookmark to target folder on save', async ({ newTabPage, extensionWorker }) => {
  const worker = extensionWorker as unknown as Page
  const url = `https://example.test/${uid()}`

  const folderId = await worker.evaluate(async () => {
    const [root] = await chrome.bookmarks.getTree()
    const walk = (nodes: any[]): string | null => {
      for (const n of nodes) {
        if (!n.url && n.title === 'AutoTest')
          return n.id
        if (n.children) {
          const r = walk(n.children)
          if (r)
            return r
        }
      }
      return null
    }
    return walk([root]) ?? (await chrome.bookmarks.create({ parentId: '2', title: 'AutoTest' })).id
  }) as string

  await worker.evaluate(async ({ SETTINGS_KEY, targetId }) => {
    // 正式程式透過 @plasmohq/storage 寫入，實際存放格式是 JSON 字串
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: JSON.stringify({
        autoOrganizeOnSave: true,
        autoOrganizeRules: [{
          id: 'auto-test',
          enabled: true,
          name: 'example → AutoTest',
          field: 'domain',
          operator: 'contains',
          value: 'example.test',
          targetCategoryId: `cat-${targetId}`,
          addTags: ['auto'],
          clearInbox: true,
        }],
      }),
    })
  }, { SETTINGS_KEY, targetId: folderId })

  const storedSettings = await worker.evaluate(
    async (key: string) => (await chrome.storage.sync.get(key))[key],
    SETTINGS_KEY,
  )
  // 種子資料必須與正式儲存格式一致，否則測試會繞過真正的設定讀取流程
  expect(typeof storedSettings).toBe('string')

  await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
    await chrome.runtime.sendMessage(
      { type: QUICK_SAVE_MSG, bookmark: { name: 'Example Test', url } },
    )
  }, { QUICK_SAVE_MSG, url })

  await new Promise(r => setTimeout(r, 2000))

  const node = await worker.evaluate(async (url) => {
    const results = await chrome.bookmarks.search({ url })
    return results[0] ?? null
  }, url) as any

  expect(node).not.toBeNull()
  expect(node.parentId).toBe(folderId)

  // metadata 由同一段 SW 流程寫入；舊版把 JSON 字串當物件讀，規則不會命中、也不會有標籤。
  const storedMeta = await worker.evaluate(
    async (key: string) => (await chrome.storage.local.get(key))[key],
    META_KEY,
  )
  expect(typeof storedMeta).toBe('string')
  const meta = JSON.parse(storedMeta as string) as Record<string, { tags?: string[] }>
  expect(meta[url]?.tags ?? []).toContain('auto')
})

test('toggle autoOrganizeOnSave=false prevents auto-organize', async ({ newTabPage, extensionWorker }) => {
  const worker = extensionWorker as unknown as Page
  const url = `https://example.test/${uid()}`

  // Find folder 1 (unclassified) — save target
  const originalParentId = '1'

  await worker.evaluate(async ({ SETTINGS_KEY }) => {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: JSON.stringify({
        autoOrganizeOnSave: false,
        autoOrganizeRules: [{
          id: 'auto-test-off',
          enabled: true,
          name: 'skip when off',
          field: 'domain',
          operator: 'contains',
          value: 'example.test',
          // This would move to folder 5 but should be skipped
          targetCategoryId: 'cat-5',
          addTags: ['should-not-appear'],
          clearInbox: true,
        }],
      }),
    })
  }, { SETTINGS_KEY })

  await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
    await chrome.runtime.sendMessage(
      { type: QUICK_SAVE_MSG, bookmark: { name: 'Skip Test', url } },
    )
  }, { QUICK_SAVE_MSG, url })

  await new Promise(r => setTimeout(r, 2000))

  const node = await worker.evaluate(async (url) => {
    const results = await chrome.bookmarks.search({ url })
    return results[0] ?? null
  }, url) as any

  expect(node).not.toBeNull()
  // Should NOT have moved (toggle off)
  expect(node.parentId).toBe(originalParentId)

  // 關閉時規則的 addTags 也不得生效
  const disabledMetaRaw = await worker.evaluate(
    async (key: string) => (await chrome.storage.local.get(key))[key],
    META_KEY,
  )
  const disabledMeta = (typeof disabledMetaRaw === 'string' ? JSON.parse(disabledMetaRaw) : {}) as Record<string, { tags?: string[] }>
  expect(disabledMeta[url]?.tags ?? []).not.toContain('should-not-appear')

  // 控制組：把同一條規則的開關打開後，第二個書籤必須被搬移。
  // 若 SW 讀不到 JSON 字串設定（R-01 故障版），控制組會失敗，本測試才具鑑別力。
  const controlFolderId = await worker.evaluate(async () => {
    return (await chrome.bookmarks.create({ parentId: '2', title: `Control-${Date.now()}` })).id
  }) as string
  const controlUrl = `https://example.test/${uid()}`

  await worker.evaluate(async ({ SETTINGS_KEY, targetId }) => {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: JSON.stringify({
        autoOrganizeOnSave: true,
        autoOrganizeRules: [{
          id: 'auto-test-on',
          enabled: true,
          name: 'control on',
          field: 'domain',
          operator: 'contains',
          value: 'example.test',
          targetCategoryId: `cat-${targetId}`,
        }],
      }),
    })
  }, { SETTINGS_KEY, targetId: controlFolderId })

  await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
    await chrome.runtime.sendMessage(
      { type: QUICK_SAVE_MSG, bookmark: { name: 'Control Test', url } },
    )
  }, { QUICK_SAVE_MSG, url: controlUrl })

  await new Promise(r => setTimeout(r, 2000))

  const controlNode = await worker.evaluate(async (url) => {
    const results = await chrome.bookmarks.search({ url })
    return results[0] ?? null
  }, controlUrl) as any

  expect(controlNode).not.toBeNull()
  expect(controlNode.parentId).toBe(controlFolderId)
})

test('save still works when rule targets nonexistent folder', async ({ newTabPage, extensionWorker }) => {
  const worker = extensionWorker as unknown as Page
  const url = `https://example.test/${uid()}`

  await worker.evaluate(async ({ SETTINGS_KEY, url }) => {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: JSON.stringify({
        autoOrganizeOnSave: true,
        autoOrganizeRules: [{
          id: 'bad-rule',
          enabled: true,
          name: 'nonexistent folder',
          field: 'url',
          operator: 'equals',
          value: url,
          targetCategoryId: 'cat-nonexistent-xyz',
          addTags: ['survived'],
        }],
      }),
    })
  }, { SETTINGS_KEY, url })

  await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
    await chrome.runtime.sendMessage(
      { type: QUICK_SAVE_MSG, bookmark: { name: 'Save OK', url } },
    )
  }, { QUICK_SAVE_MSG, url })

  await new Promise(r => setTimeout(r, 1500))

  const node = await worker.evaluate(async (url) => {
    const results = await chrome.bookmarks.search({ url })
    return results[0] ?? null
  }, url) as any

  // Save must succeed even though rule can't resolve
  expect(node).not.toBeNull()
  expect(node.parentId).toBe('1')

  // 規則本身必須已被讀到並執行（標籤有寫入），只是目標資料夾不存在而不搬移。
  // 舊版讀不到 JSON 字串設定時不會有任何標籤，本斷言因此具鑑別力。
  const storedMeta = await worker.evaluate(
    async (key: string) => (await chrome.storage.local.get(key))[key],
    META_KEY,
  )
  expect(typeof storedMeta).toBe('string')
  const meta = JSON.parse(storedMeta as string) as Record<string, { tags?: string[] }>
  expect(meta[url]?.tags ?? []).toContain('survived')
})

test('old user with no autoOrganizeOnSave key still gets auto-organize (defaults true)', async ({ newTabPage, extensionWorker }) => {
  const worker = extensionWorker as unknown as Page
  const url = `https://example.test/${uid()}`

  const folderId = await worker.evaluate(async () => {
    const [root] = await chrome.bookmarks.getTree()
    const walk = (nodes: any[]): string | null => {
      for (const n of nodes) {
        if (!n.url && n.title === 'AutoTest')
          return n.id
        if (n.children) {
          const r = walk(n.children)
          if (r)
            return r
        }
      }
      return null
    }
    return walk([root]) ?? (await chrome.bookmarks.create({ parentId: '2', title: 'AutoTest' })).id
  }) as string

  // OLD SETTING — no autoOrganizeOnSave key at all
  await worker.evaluate(async ({ SETTINGS_KEY, targetId, url }) => {
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: JSON.stringify({
        // Note: no autoOrganizeOnSave field — simulates old user
        autoOrganizeRules: [{
          id: 'legacy-rule',
          enabled: true,
          name: 'legacy trigger',
          field: 'url',
          operator: 'equals',
          value: url,
          targetCategoryId: `cat-${targetId}`,
        }],
      }),
    })
  }, { SETTINGS_KEY, targetId: folderId, url })

  await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
    await chrome.runtime.sendMessage(
      { type: QUICK_SAVE_MSG, bookmark: { name: 'Legacy Test', url } },
    )
  }, { QUICK_SAVE_MSG, url })

  await new Promise(r => setTimeout(r, 2000))

  const node = await worker.evaluate(async (url) => {
    const results = await chrome.bookmarks.search({ url })
    return results[0] ?? null
  }, url) as any

  expect(node).not.toBeNull()
  // Default autoOrganizeOnSave=true should have applied the rule
  expect(node.parentId).toBe(folderId)
})

test('損壞 metadata 不得被 auto-organize 用空物件覆寫', async ({ newTabPage, extensionWorker }) => {
  const worker = extensionWorker as unknown as Page
  const url = `https://example.test/${uid()}`
  const corrupt = '{not-json'

  try {
    await worker.evaluate(async ({ SETTINGS_KEY, url }) => {
      await chrome.storage.sync.set({
        [SETTINGS_KEY]: JSON.stringify({
          autoOrganizeOnSave: true,
          autoOrganizeRules: [{
            id: 'corrupt-meta',
            enabled: true,
            name: 'tag only',
            field: 'url',
            operator: 'equals',
            value: url,
            addTags: ['auto'],
            clearInbox: false,
          }],
        }),
      })
    }, { SETTINGS_KEY, url })
    await worker.evaluate(async ({ META_KEY, corrupt }) => {
      await chrome.storage.local.set({ [META_KEY]: corrupt })
    }, { META_KEY, corrupt })

    await newTabPage.evaluate(async ({ QUICK_SAVE_MSG, url }) => {
      await chrome.runtime.sendMessage(
        { type: QUICK_SAVE_MSG, bookmark: { name: 'Corrupt Meta', url } },
      )
    }, { QUICK_SAVE_MSG, url })

    await new Promise(r => setTimeout(r, 2000))

    // 儲存本身必須成功（metadata 壞掉不得阻斷書籤建立）。
    const node = await worker.evaluate(async (url) => {
      const results = await chrome.bookmarks.search({ url })
      return results[0] ?? null
    }, url) as any
    expect(node).not.toBeNull()

    // 原始損壞資料必須原封不動，不得被 `{}` 或任何寫入取代。
    const storedMeta = await worker.evaluate(
      async (key: string) => (await chrome.storage.local.get(key))[key],
      META_KEY,
    )
    expect(storedMeta).toBe(corrupt)
  }
  finally {
    await worker.evaluate(async ({ META_KEY, url }) => {
      await chrome.storage.local.remove(META_KEY)
      for (const node of await chrome.bookmarks.search({ url }))
        await chrome.bookmarks.remove(node.id)
    }, { META_KEY, url })
  }
})
