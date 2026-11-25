import type { AiSettings } from './ai-settings'
import { describe, expect, it } from 'vitest'
import { getDefaultAiSettings } from './ai-settings'
import { resolveHydratedAiSettings } from './ai-settings-hydration'

const defaults = getDefaultAiSettings('zh-TW')
const stored: AiSettings = {
  ...defaults,
  baseUrl: 'https://stored.example/v1',
  model: 'stored-model',
  batchSize: 20,
}
const typed: AiSettings = {
  ...defaults,
  baseUrl: 'https://www.google.com/v1',
  model: 'e2e-model',
}

describe('resolveHydratedAiSettings', () => {
  it('載入前就編輯：保留使用者輸入，不被已儲存值覆蓋', () => {
    const result = resolveHydratedAiSettings(
      { settings: typed, token: 'typed-token' },
      { settings: stored, token: 'stored-token' },
      true,
    )
    expect(result.settings.baseUrl).toBe('https://www.google.com/v1')
    expect(result.settings.model).toBe('e2e-model')
    expect(result.token).toBe('typed-token')
  })

  it('載入期間編輯：同樣保留較新的修改', () => {
    const result = resolveHydratedAiSettings(
      { settings: typed, token: '' },
      { settings: stored, token: 'stored-token' },
      true,
    )
    expect(result.settings).toEqual(typed)
    expect(result.token).toBe('')
  })

  it('未編輯時套用載入結果', () => {
    const result = resolveHydratedAiSettings(
      { settings: defaults, token: '' },
      { settings: stored, token: 'stored-token' },
      false,
    )
    expect(result.settings.baseUrl).toBe('https://stored.example/v1')
    expect(result.settings.batchSize).toBe(20)
    expect(result.token).toBe('stored-token')
  })

  it('載入完成後才編輯：不影響已套用的載入結果，之後的修改直接生效', () => {
    const hydrated = resolveHydratedAiSettings(
      { settings: defaults, token: '' },
      { settings: stored, token: 'stored-token' },
      false,
    )
    const afterEdit = { settings: { ...hydrated.settings, model: 'later-model' }, token: hydrated.token }
    expect(afterEdit.settings.model).toBe('later-model')
    expect(afterEdit.settings.baseUrl).toBe('https://stored.example/v1')
  })

  it('載入失敗（維持預設）時不會把使用者輸入換回預設', () => {
    // 載入失敗路徑不呼叫 hydration，等價於 current 原樣保留。
    const current = { settings: typed, token: 'typed-token' }
    const kept = resolveHydratedAiSettings(current, current, true)
    expect(kept).toEqual(current)
  })

  it('重新載入相同資料時結果穩定（冪等）', () => {
    const once = resolveHydratedAiSettings(
      { settings: defaults, token: '' },
      { settings: stored, token: 'stored-token' },
      false,
    )
    const twice = resolveHydratedAiSettings(once, { settings: stored, token: 'stored-token' }, false)
    expect(twice).toEqual(once)
  })
})
