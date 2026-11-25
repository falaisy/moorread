import type { Language } from './types'

const supportedLanguages = new Set<Language>([
  'zh-TW',
  'en',
])

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string'
    && supportedLanguages.has(value as Language)
}

export function resolveBrowserLanguage(browserLanguage?: string): Language {
  const normalized = browserLanguage?.trim().toLowerCase() ?? ''
  // 所有中文地區（zh-CN, zh-HK, zh-MO, zh-Hant, zh-TW...）→ zh-TW
  if (normalized.startsWith('zh'))
    return 'zh-TW'
  // 英文地區 → en
  if (normalized.startsWith('en'))
    return 'en'
  // 其他語言一律 fallback 到 en
  return 'en'
}

export function getBrowserLanguage(): Language {
  if (typeof navigator !== 'undefined')
    return resolveBrowserLanguage(navigator.language)
  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage)
    return resolveBrowserLanguage(chrome.i18n.getUILanguage())
  return 'en'
}

export async function loadPreferredLanguage(
  readSettings: () => Promise<unknown>,
  fallback: Language = getBrowserLanguage(),
): Promise<Language> {
  try {
    const settings = await readSettings()
    if (typeof settings === 'object' && settings !== null) {
      const language = (settings as { language?: unknown }).language
      if (isLanguage(language))
        return language
    }
  }
  catch {
    // A failed settings read must not block background safety operations.
  }
  return fallback
}
