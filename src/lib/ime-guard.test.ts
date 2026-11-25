import { describe, expect, it } from 'vitest'
import { isImeComposing } from './ime-guard'

describe('isImeComposing', () => {
  it('treats the Enter that confirms a composition as IME input', () => {
    // 注音／拼音按 Enter 確認選字時，keydown 仍帶 isComposing。
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true)
  })

  it('treats keyCode 229 as IME input even when isComposing is missing', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
  })

  it('allows a normal Enter after the composition has ended', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('allows ordinary keys when no composition is active', () => {
    expect(isImeComposing({ isComposing: false, keyCode: 39 })).toBe(false)
  })
})
