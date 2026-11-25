import { DEFAULT_APPEARANCE_SETTINGS } from '../src/lib/appearance'
import { resolveBrowserLanguage, translate } from '../src/lib/i18n'
import { normalizeSettings } from '../src/lib/store-settings-state'
import { expect, test } from './extension.fixture'
import { artifactPath } from './support/artifacts'

for (const scope of ['general', 'appearance'] as const) {
  test(`restores ${scope} defaults, preserves other settings and data across reloads`, async ({ extensionContext, extensionWorker, extensionId, newTabPage }) => {
    const settingsKey = 'moorread:settings'
    const groupKey = 'moorread:bookmark-group:reset-fixture'
    const partKey = `${groupKey}:reset:0`
    const settings = normalizeSettings({
      language: 'en',
      theme: 'dark',
      onboardingDismissed: true,
      defaultCategoryId: 'pinned',
      singleHomeTab: false,
      bookmarkGroupsEnabled: false,
      bookmarkViewMode: 'compact',
      globalCommandPaletteEnabled: true,
      savedSearches: [{ id: 'reset-filter', name: 'Keep filter', query: 'tag:work' }],
      autoOrganizeRules: [{ id: 'reset-rule', name: 'Keep rule', enabled: true, field: 'domain', operator: 'contains', value: 'example.test', addTags: ['work'], clearInbox: false }],
      appearance: { ...DEFAULT_APPEARANCE_SETTINGS, colorTheme: 'graphite', navLayout: 'top', contentWidth: 'full', navItems: { icons: false, counts: false, smartCategories: false, savedSearches: true, categoryTree: false }, cardFields: { ...DEFAULT_APPEARANCE_SETTINGS.cardFields, websiteIcon: false, description: false, tags: false, actions: 'always' } },
    })
    const original = await extensionWorker.evaluate(async ({ settingsKey, groupKey, partKey }) => chrome.storage.sync.get([settingsKey, groupKey, partKey]), { settingsKey, groupKey, partKey })
    const bookmarkId = await extensionWorker.evaluate(async () => (await chrome.bookmarks.create({ parentId: '1', title: 'Keep bookmark', url: 'https://example.test/reset-fixture' })).id)
    const group = JSON.stringify({ id: 'reset-fixture', title: 'Keep group', description: '', bookmarks: [{ id: 'reset-member', title: 'Keep bookmark', url: 'https://example.test/reset-fixture' }] })
    await extensionWorker.evaluate(async ({ settingsKey, groupKey, partKey, settings, group }) => {
      await chrome.storage.sync.set({
        [settingsKey]: JSON.stringify(settings),
        [groupKey]: { version: 1, generation: 'reset', partCount: 1 },
        [partKey]: group,
      })
    }, { settingsKey, groupKey, partKey, settings, group })
    let other: Awaited<ReturnType<typeof extensionContext.newPage>> | undefined
    try {
      const nativeTree = await extensionWorker.evaluate(() => chrome.bookmarks.getTree())
      await newTabPage.reload()
      await newTabPage.setViewportSize({ width: scope === 'general' ? 1280 : 375, height: 900 })
      other = await extensionContext.newPage()
      await other.goto(`chrome-extension://${extensionId}/newtab.html`)
      // Color theme is applied via CSS variables (no html class). Verify the stored value instead.
      await expect.poll(async () => extensionWorker.evaluate(async (key) => {
        const raw = (await chrome.storage.sync.get(key))[key]
        return raw ? JSON.parse(String(raw)).appearance?.colorTheme : null
      }, settingsKey)).toBe('graphite')
      // 設定入口已改為 header 按鈕（aria-label = openSettings），不再是「More actions」選單項目。
      await newTabPage.getByRole('button', { name: 'Open settings', exact: true }).click()
      // 舊版「Appearance」分頁已拆成 Layout／Bookmark Style／Visual；
      // 重置外觀的入口（resetAppearanceSettings）現在位於 Layout 分頁。
      await newTabPage.getByRole('tab', { name: scope === 'general' ? 'General' : 'Layout', exact: true }).click()
      const browserLanguage = resolveBrowserLanguage(await newTabPage.evaluate(() => navigator.language))
      const language = scope === 'general' ? browserLanguage : 'en'
      // 現行 resetAppearanceSettings 刻意保留版面偏好（navLayout／homeLayout／contentWidth／sidebar），
      // 只重設主題、卡片與字型等外觀值；以下 expected 與該實作逐欄對齊。
      const expectedAppearance = scope === 'general'
        ? { ...settings.appearance, navLayout: 'sidebar', navItems: { icons: false, counts: true, smartCategories: true, savedSearches: false, categoryTree: true } }
        : {
            ...DEFAULT_APPEARANCE_SETTINGS,
            navLayout: settings.appearance.navLayout,
            homeLayout: settings.appearance.homeLayout,
            contentWidth: settings.appearance.contentWidth,
            sidebarWidth: settings.appearance.sidebarWidth,
            sidebarCollapsed: settings.appearance.sidebarCollapsed,
            navItems: { ...settings.appearance.navItems, icons: true },
          }
      // 正式資料以 JSON 字串保存，undefined 欄位不會落盤；expected 同步比照。
      const expected = JSON.parse(JSON.stringify(scope === 'general'
        ? { ...settings, language, defaultCategoryId: 'all', bookmarkGroupsEnabled: true, appearance: expectedAppearance }
        : { ...settings, theme: 'system', appearance: expectedAppearance }))
      await newTabPage.getByRole('button', { name: 'Restore defaults', exact: true }).click()
      await expect(newTabPage.getByRole('dialog').getByRole('status')).toHaveText(translate(language, 'settingsResetDone'))
      await expect.poll(() => extensionWorker.evaluate(async key => JSON.parse(String((await chrome.storage.sync.get(key))[key])), settingsKey)).toEqual(expected)
      // Other open pages pick up general and appearance preferences on reload.
      await other.reload()
      if (scope === 'general') {
        await expect(other.locator('.workspace-layout')).toHaveAttribute('data-nav-layout', 'sidebar')
      }
      else {
        // Appearance reset restores the default color theme (sky), not graphite.
        await expect.poll(async () => extensionWorker.evaluate(async (key) => {
          const raw = (await chrome.storage.sync.get(key))[key]
          return raw ? JSON.parse(String(raw)).appearance?.colorTheme : null
        }, settingsKey)).not.toBe('graphite')
        await expect(other.locator('.newtab-shell')).toHaveAttribute('data-home-layout', DEFAULT_APPEARANCE_SETTINGS.homeLayout)
      }
      await newTabPage.screenshot({ path: artifactPath(`yunji-settings-reset-${scope}.png`), fullPage: true })
      await newTabPage.reload()
      await newTabPage.getByRole('button', { name: translate(language, 'openSettings'), exact: true }).click()
      await newTabPage.getByRole('tab', { name: translate(language, scope === 'appearance' ? 'layoutAppearance' : 'general'), exact: true }).click()
      await expect(newTabPage.getByRole('button', { name: translate(language, 'settingsResetDefault'), exact: true })).toBeVisible()
      await expect.poll(() => newTabPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await extensionWorker.evaluate(() => chrome.bookmarks.getTree())).toEqual(nativeTree)
      expect(await extensionWorker.evaluate(async key => (await chrome.storage.sync.get(key))[key], partKey)).toBe(group)
    }
    finally {
      await other?.close()
      await extensionWorker.evaluate(async ({ settingsKey, groupKey, partKey, original, bookmarkId }) => {
        await chrome.bookmarks.remove(bookmarkId)
        await chrome.storage.sync.remove([settingsKey, groupKey, partKey])
        await chrome.storage.sync.set(original)
      }, { settingsKey, groupKey, partKey, original, bookmarkId })
    }
  })
}
