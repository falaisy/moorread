import { describe, expect, it } from 'vitest'

import {
  isLanguage,
  languageTag,
  loadPreferredLanguage,
  localizedMessage,
  messageKeys,
  resolveBrowserLanguage,
  translate,
  translateCategoryName,
  translateText,
} from './i18n'
import { aiMessages } from './i18n-ai'

describe('i18n', () => {
  it('translates messages and interpolates values', () => {
    expect(translate('zh-TW', 'bookmarkCount', { count: 3 })).toBe('3 個書籤')
    expect(translate('zh-TW', 'brandName')).toBe('書野 Moorread')
    expect(translate('en', 'bookmarkCount', { count: 3 })).toBe('3 bookmarks')
  })

  it('localizes the complete appearance surface', () => {
    expect(translate('en', 'appearanceLightDarkMode')).toBe('Light and dark mode')
    expect(translate('en', 'themeLight')).toBe('Light')
    expect(translate('zh-TW', 'appearanceOverallStyle')).toBe('整體風格')
  })

  it('localizes built-in categories without changing user folder names', () => {
    expect(translateCategoryName('en', { id: 'inbox', name: '收件箱' }))
      .toBe('Inbox')
    expect(translateCategoryName('en', { id: 'cat-1', name: '工作' }))
      .toBe('工作')
    expect(translateCategoryName('en', { id: 'cat-2', name: '' }))
      .toBe('Folder')
  })

  it('renders persisted message descriptors in the current language', () => {
    const message = localizedMessage('runtimeBookmarkCountLabel', { count: 2 })
    expect(translateText('en', message)).toBe('2 bookmarks')
    expect(translateText('zh-TW', message)).toBe('2 個書籤')
    expect(translateText('en', 'User-provided label')).toBe('User-provided label')
  })

  it('returns valid document language tags', () => {
    for (const language of ['zh-TW', 'en'] as const)
      expect(languageTag(language)).toBe(language)
  })

  it('matches supported browser languages and falls back to English', () => {
    // 所有中文地區 → zh-TW
    expect(resolveBrowserLanguage('zh-CN')).toBe('zh-TW')
    expect(resolveBrowserLanguage('zh-Hant')).toBe('zh-TW')
    expect(resolveBrowserLanguage('zh-HK')).toBe('zh-TW')
    expect(resolveBrowserLanguage('zh-TW')).toBe('zh-TW')
    // 英文 → en
    expect(resolveBrowserLanguage('en-GB')).toBe('en')
    // 其他語言一律 fallback 到 en
    expect(resolveBrowserLanguage('ja-JP')).toBe('en')
    expect(resolveBrowserLanguage('ko-KR')).toBe('en')
    expect(resolveBrowserLanguage('es-MX')).toBe('en')
    expect(resolveBrowserLanguage('fr-CA')).toBe('en')
    expect(resolveBrowserLanguage('de-DE')).toBe('en')
    expect(resolveBrowserLanguage()).toBe('en')
  })

  it('validates supported language values', () => {
    expect(isLanguage('zh-TW')).toBe(true)
    expect(isLanguage('en')).toBe(true)
    expect(isLanguage('zh-CN')).toBe(false)
    expect(isLanguage('ja')).toBe(false)
    expect(isLanguage('ko')).toBe(false)
    expect(isLanguage('es')).toBe(false)
    expect(isLanguage('fr')).toBe(false)
    expect(isLanguage('xx')).toBe(false)
    expect(isLanguage('')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it('falls back to saved value when browser language is unsupported', async () => {
    await expect(
      loadPreferredLanguage(
        async () => ({ language: 'zh-TW' }),
        'en',
      ),
    ).resolves.toBe('zh-TW')
    await expect(
      loadPreferredLanguage(
        async () => ({ language: 'en' }),
        'zh-TW',
      ),
    ).resolves.toBe('en')
  })

  it('message keys include every placeholder referenced by the translators', () => {
    const placeholderRegex = /\{(\w+)\}/g
    for (const key of messageKeys) {
      const zhTWText = translate('zh-TW', key)
      const enText = translate('en', key)
      const zhTWMatches = new Set([...zhTWText.matchAll(placeholderRegex)].map(m => m[1]))
      const enMatches = new Set([...enText.matchAll(placeholderRegex)].map(m => m[1]))
      expect(zhTWMatches).toEqual(enMatches)
    }
  })

  it('uses localized AI copy for both supported locales', () => {
    // zh-TW 和 en 必須有不同的 AI 翻譯
    const localizedCount = Object.keys(aiMessages.en).filter((key) => {
      const messageKey = key as keyof typeof aiMessages.en
      return aiMessages['zh-TW'][messageKey] !== aiMessages.en[messageKey]
    }).length
    expect(localizedCount).toBeGreaterThan(0)
  })
})
