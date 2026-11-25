import type { Language } from './types'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_BATCH_SIZE,
  getDefaultAiClassificationPrompt,
  getDefaultAiSettings,
  localizeDefaultAiClassificationPrompt,
  normalizeAiBatchSize,
} from './ai-settings'

const languages: Language[] = ['zh-TW', 'en']

describe('ai settings', () => {
  it('normalizes the configurable batch size', () => {
    expect(normalizeAiBatchSize(undefined)).toBe(DEFAULT_AI_BATCH_SIZE)
    expect(normalizeAiBatchSize('40')).toBe(40)
    expect(normalizeAiBatchSize(0)).toBe(1)
    expect(normalizeAiBatchSize(999)).toBe(200)
  })

  it('provides a distinct localized default prompt for every language', () => {
    const prompts = languages.map(getDefaultAiClassificationPrompt)

    expect(new Set(prompts)).toHaveLength(languages.length)
    for (const language of languages) {
      expect(getDefaultAiSettings(language).prompt).toBe(
        getDefaultAiClassificationPrompt(language),
      )
    }
  })

  it('localizes known defaults without overwriting a custom prompt', () => {
    const zhTWDefault = getDefaultAiClassificationPrompt('zh-TW')

    expect(localizeDefaultAiClassificationPrompt('', 'en')).toBe(
      getDefaultAiClassificationPrompt('en'),
    )
    expect(localizeDefaultAiClassificationPrompt(zhTWDefault, 'en')).toBe(
      getDefaultAiClassificationPrompt('en'),
    )
    expect(
      localizeDefaultAiClassificationPrompt('My custom prompt', 'zh-TW'),
    ).toBe('My custom prompt')
  })
})
