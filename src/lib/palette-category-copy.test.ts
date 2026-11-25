import { describe, expect, it } from 'vitest'
import { languageOptions, messageKeys, translate } from './i18n'

describe('r13：命令面板「all」文案（未指定／跟隨預設）', () => {
  it('只有 zh-TW 與 en 兩個語系（不得自行新增語系）', () => {
    expect(languageOptions.map(option => option.value)).toEqual(['zh-TW', 'en'])
  })

  it('messageKeys 仍包含 paletteSwitchAll（防止鍵被刪）', () => {
    expect(messageKeys).toContain('paletteSwitchAll')
  })

  it('繁體中文改為「未指定（跟隨預設）」，不得留下「全部書籤」字樣', () => {
    const text = translate('zh-TW', 'paletteSwitchAll')
    expect(text).toBe('未指定（跟隨預設）')
    expect(text).toContain('跟隨預設')
    expect(text).not.toContain('全部書籤')
  })

  it('英文改為 Use default，不得留下 Show all bookmarks', () => {
    const text = translate('en', 'paletteSwitchAll')
    expect(text).toBe('Use default')
    expect(text).not.toMatch(/show all bookmarks/i)
    expect(text).not.toMatch(/all bookmarks/i)
  })

  it('兩個語系都有非空且互不相同的譯文', () => {
    const values = languageOptions.map(option => translate(option.value, 'paletteSwitchAll'))
    for (const value of values)
      expect(value.trim().length).toBeGreaterThan(0)
    expect(new Set(values).size).toBe(values.length)
  })
})
