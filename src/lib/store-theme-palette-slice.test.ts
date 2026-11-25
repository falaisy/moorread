import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_THEME_PALETTE } from './palette'
import { createThemePaletteSlice } from './store-theme-palette-slice'

const mocks = vi.hoisted(() => ({
  writeThemePalette: vi.fn(),
  clearThemePalette: vi.fn(),
  writeCachedPaletteBaseColor: vi.fn(),
}))

vi.mock('./theme-palette-storage', () => ({
  readThemePalette: vi.fn(async () => ({ ...EMPTY_THEME_PALETTE })),
  writeThemePalette: mocks.writeThemePalette,
  clearThemePalette: mocks.clearThemePalette,
}))

vi.mock('./theme-boot', () => ({
  writeCachedPaletteBaseColor: mocks.writeCachedPaletteBaseColor,
}))

function createSlice(initial: { baseColor: string | null, savedBaseColor: string | null, locked: boolean }) {
  let state: Record<string, unknown> = {}
  const set = (partial: unknown) => {
    const next = typeof partial === 'function'
      ? (partial as (current: Record<string, unknown>) => Record<string, unknown>)(state)
      : partial as Record<string, unknown>
    state = { ...state, ...next }
  }
  const get = () => state as never
  const slice = createThemePaletteSlice(set as never, get, {} as never)
  state = { ...slice, themePalette: { ...initial } }
  return {
    slice: slice as ReturnType<typeof createThemePaletteSlice>,
    get: () => state as { themePalette: { baseColor: string | null, savedBaseColor: string | null, locked: boolean } },
  }
}

describe('theme palette slice cache mirroring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeThemePalette.mockResolvedValue(undefined)
    mocks.clearThemePalette.mockResolvedValue(undefined)
  })

  it('updates the boot cache only after the official save succeeds', async () => {
    const { slice, get } = createSlice({
      baseColor: '#ff0000',
      savedBaseColor: null,
      locked: false,
    })

    await slice.saveThemePalette()

    expect(mocks.writeThemePalette).toHaveBeenCalledWith({
      baseColor: '#ff0000',
      savedBaseColor: '#ff0000',
      locked: false,
    })
    expect(mocks.writeCachedPaletteBaseColor).toHaveBeenCalledWith('#ff0000')
    expect(get().themePalette.savedBaseColor).toBe('#ff0000')
  })

  it('does not update state or cache when saving fails', async () => {
    mocks.writeThemePalette.mockRejectedValue(new Error('quota exceeded'))
    const { slice, get } = createSlice({
      baseColor: '#00ff00',
      savedBaseColor: '#ff0000',
      locked: true,
    })

    await expect(slice.saveThemePalette()).rejects.toThrow('quota exceeded')

    expect(mocks.writeCachedPaletteBaseColor).not.toHaveBeenCalled()
    expect(get().themePalette).toEqual({
      baseColor: '#00ff00',
      savedBaseColor: '#ff0000',
      locked: true,
    })
  })

  it('clears the boot cache when the stored palette is removed', async () => {
    const { slice, get } = createSlice({
      baseColor: '#ff0000',
      savedBaseColor: '#ff0000',
      locked: false,
    })

    await slice.resetThemePalette()

    expect(mocks.clearThemePalette).toHaveBeenCalled()
    expect(mocks.writeCachedPaletteBaseColor).toHaveBeenCalledWith(null)
    expect(get().themePalette).toEqual(EMPTY_THEME_PALETTE)
  })

  it('keeps the cache when removing the stored palette fails', async () => {
    mocks.clearThemePalette.mockRejectedValue(new Error('denied'))
    const { slice, get } = createSlice({
      baseColor: '#ff0000',
      savedBaseColor: '#ff0000',
      locked: false,
    })

    await expect(slice.resetThemePalette()).rejects.toThrow('denied')

    expect(mocks.writeCachedPaletteBaseColor).not.toHaveBeenCalled()
    expect(get().themePalette.baseColor).toBe('#ff0000')
  })

  it('never lets preview or random change the saved theme', () => {
    const { slice, get } = createSlice({
      baseColor: '#ff0000',
      savedBaseColor: '#ff0000',
      locked: true,
    })

    slice.randomizeThemeBaseColor()
    expect(get().themePalette.baseColor).toBe('#ff0000')

    slice.previewThemeBaseColor('#00ff00')
    expect(get().themePalette.baseColor).toBe('#00ff00')
    expect(get().themePalette.savedBaseColor).toBe('#ff0000')
    expect(mocks.writeThemePalette).not.toHaveBeenCalled()
  })

  it('restores the saved color, or default themes when nothing was saved', () => {
    const saved = createSlice({
      baseColor: '#00ff00',
      savedBaseColor: '#ff0000',
      locked: false,
    })
    saved.slice.restoreThemePalette()
    expect(saved.get().themePalette.baseColor).toBe('#ff0000')

    const empty = createSlice({
      baseColor: '#00ff00',
      savedBaseColor: null,
      locked: false,
    })
    empty.slice.restoreThemePalette()
    expect(empty.get().themePalette.baseColor).toBeNull()
  })
})
