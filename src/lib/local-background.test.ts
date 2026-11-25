import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteLocalBackgroundBlob,
  getLocalBackgroundState,
  hasLocalBackgroundBlob,
  loadActiveLocalBackground,
  LOCAL_BACKGROUND_CACHE_KEY,
  LOCAL_BACKGROUND_MAX_BYTES,
  LOCAL_BACKGROUND_MAX_DIMENSION,
  LOCAL_BACKGROUND_META_KEY,
  readLocalBackgroundBlob,
  removeLocalBackground,
  saveLocalBackground,
  setLocalBackgroundEnabled,
  sniffImageMime,
  validateBackgroundImage,
} from './local-background'

const PNG_HEADER = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_HEADER = [0xFF, 0xD8, 0xFF, 0xE0]
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
const AVIF_HEADER = [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]
const GIF_HEADER = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const SVG_BYTES = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')]

let localData: Record<string, unknown>
let cacheStore: Map<string, Response>
let cacheMock: {
  match: Mock
  put: Mock
  delete: Mock
}
let bitmapSize: { width: number, height: number }

function installChrome() {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) =>
          key in localData ? { [key]: localData[key] } : {}),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(localData, items)
        }),
        remove: vi.fn(async (key: string) => {
          delete localData[key]
        }),
      },
    },
  })
}

function installCaches(available = true) {
  cacheMock = {
    match: vi.fn(async (key: string) => cacheStore.get(key)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      cacheStore.set(request.url, response)
    }),
    delete: vi.fn(async (key: string) => cacheStore.delete(key)),
  }
  vi.stubGlobal(
    'caches',
    available ? { open: vi.fn(async () => cacheMock), delete: vi.fn() } : undefined,
  )
}

function makeImage(
  bytes: number[],
  name = 'background.png',
  type = 'image/png',
): Blob & { name?: string } {
  const blob = new Blob([new Uint8Array(bytes)], { type }) as Blob & { name?: string }
  blob.name = name
  return blob
}

async function readCachedBytes(): Promise<number[] | null> {
  const response = cacheStore.get(LOCAL_BACKGROUND_CACHE_KEY)
  if (!response)
    return null
  return [...new Uint8Array(await response.clone().arrayBuffer())]
}

beforeEach(() => {
  localData = {}
  cacheStore = new Map()
  bitmapSize = { width: 1920, height: 1080 }
  installChrome()
  installCaches()
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: bitmapSize.width,
    height: bitmapSize.height,
    close: vi.fn(),
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sniffImageMime', () => {
  it('recognises the accepted formats by their bytes', () => {
    expect(sniffImageMime(new Uint8Array(PNG_HEADER))).toBe('image/png')
    expect(sniffImageMime(new Uint8Array(JPEG_HEADER))).toBe('image/jpeg')
    expect(sniffImageMime(new Uint8Array(WEBP_HEADER))).toBe('image/webp')
    expect(sniffImageMime(new Uint8Array(AVIF_HEADER))).toBe('image/avif')
  })
})

describe('validateBackgroundImage', () => {
  it('accepts a valid PNG', async () => {
    const result = await validateBackgroundImage(makeImage(PNG_HEADER))
    expect(result).toEqual({ ok: true, value: { mime: 'image/png', width: 1920, height: 1080 } })
  })

  it('rejects SVG even when the MIME claims otherwise', async () => {
    const result = await validateBackgroundImage(makeImage(SVG_BYTES, 'background.png', 'image/png'))
    expect(result).toEqual({ ok: false, code: 'unsupported-format' })
  })

  it('rejects GIF', async () => {
    const result = await validateBackgroundImage(makeImage(GIF_HEADER, 'background.gif', 'image/gif'))
    expect(result).toEqual({ ok: false, code: 'unsupported-format' })
  })

  it('rejects a non-image file', async () => {
    const result = await validateBackgroundImage(
      makeImage([...new TextEncoder().encode('not an image')], 'notes.png', 'image/png'),
    )
    expect(result).toEqual({ ok: false, code: 'unsupported-format' })
  })

  it('rejects images larger than 8 MiB', async () => {
    const oversized = new Uint8Array(LOCAL_BACKGROUND_MAX_BYTES + 1)
    oversized.set(PNG_HEADER)
    const blob = new Blob([oversized], { type: 'image/png' }) as Blob & { name?: string }
    blob.name = 'big.png'
    const result = await validateBackgroundImage(blob)
    expect(result).toEqual({ ok: false, code: 'too-large' })
  })

  it('rejects images wider or taller than 8192 px', async () => {
    bitmapSize = { width: LOCAL_BACKGROUND_MAX_DIMENSION + 1, height: 100 }
    const wide = await validateBackgroundImage(makeImage(PNG_HEADER))
    expect(wide).toEqual({ ok: false, code: 'dimensions-too-large' })

    bitmapSize = { width: 100, height: LOCAL_BACKGROUND_MAX_DIMENSION + 1 }
    const tall = await validateBackgroundImage(makeImage(PNG_HEADER))
    expect(tall).toEqual({ ok: false, code: 'dimensions-too-large' })
  })

  it('rejects corrupted images that fail to decode', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('decode failed')
    }))
    const result = await validateBackgroundImage(makeImage(PNG_HEADER))
    expect(result).toEqual({ ok: false, code: 'decode-failed' })
  })
})

describe('storage lifecycle', () => {
  it('is disabled by default', async () => {
    expect(await loadActiveLocalBackground()).toBeNull()
    expect(await getLocalBackgroundState()).toEqual({
      enabled: false,
      fileName: '',
      hasImage: false,
      cacheAvailable: true,
      error: null,
    })
  })

  it('saves and reads the original blob', async () => {
    const result = await saveLocalBackground(makeImage(PNG_HEADER, 'holiday.png'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatchObject({ v: 1, enabled: true, fileName: 'holiday.png' })
    }
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ enabled: true, fileName: 'holiday.png' })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).not.toHaveProperty('data')

    const blob = await readLocalBackgroundBlob()
    expect(blob.ok && blob.value).toBeTruthy()
    expect(await readCachedBytes()).toEqual(PNG_HEADER)
    expect(await hasLocalBackgroundBlob()).toBe(true)
  })

  it('removes both the image and the flag', async () => {
    await saveLocalBackground(makeImage(PNG_HEADER))
    await removeLocalBackground()
    expect(cacheStore.has(LOCAL_BACKGROUND_CACHE_KEY)).toBe(false)
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeUndefined()
    expect(await loadActiveLocalBackground()).toBeNull()
  })

  it('disabling keeps the image in the cache', async () => {
    await saveLocalBackground(makeImage(PNG_HEADER))
    const disabled = await setLocalBackgroundEnabled(false)
    expect(disabled.ok).toBe(true)
    expect(cacheStore.has(LOCAL_BACKGROUND_CACHE_KEY)).toBe(true)
    expect(await hasLocalBackgroundBlob()).toBe(true)
    expect(await loadActiveLocalBackground()).toBeNull()
  })

  it('deletes only its own cache entry', async () => {
    await saveLocalBackground(makeImage(PNG_HEADER))
    const deleteAll = vi.fn()
    vi.stubGlobal('caches', { open: vi.fn(async () => cacheMock), delete: deleteAll })
    await deleteLocalBackgroundBlob()
    expect(cacheStore.has(LOCAL_BACKGROUND_CACHE_KEY)).toBe(false)
    expect(deleteAll).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('reports unavailable Cache Storage without touching the flag', async () => {
    installCaches(false)
    const result = await saveLocalBackground(makeImage(PNG_HEADER))
    expect(result).toEqual({ ok: false, code: 'cache-unavailable' })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeUndefined()

    const state = await getLocalBackgroundState()
    expect(state.cacheAvailable).toBe(false)
    expect(await loadActiveLocalBackground()).toBeNull()
  })

  it('keeps the previous image when saving the new one fails', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 1, 2, 3], 'old.png'))
    cacheMock.put.mockRejectedValueOnce(new Error('quota'))

    const result = await saveLocalBackground(makeImage([...PNG_HEADER, 9, 9, 9], 'new.png'))
    expect(result).toEqual({ ok: false, code: 'write-failed' })
    expect(await readCachedBytes()).toEqual([...PNG_HEADER, 1, 2, 3])
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ fileName: 'old.png', enabled: true })
  })

  it('rolls back the image when the flag cannot be written', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 1, 2, 3], 'old.png'))
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) =>
            key in localData ? { [key]: localData[key] } : {}),
          set: vi.fn(async () => {
            throw new Error('storage write failed')
          }),
          remove: vi.fn(async (key: string) => {
            delete localData[key]
          }),
        },
      },
    })

    const result = await saveLocalBackground(makeImage([...PNG_HEADER, 7, 7, 7], 'new.png'))
    expect(result).toEqual({ ok: false, code: 'write-failed' })
    expect(await readCachedBytes()).toEqual([...PNG_HEADER, 1, 2, 3])
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ fileName: 'old.png', enabled: true })
  })

  it('falls back to disabled when the flag exists but the image is gone', async () => {
    localData[LOCAL_BACKGROUND_META_KEY] = {
      v: 1,
      enabled: true,
      fileName: 'missing.png',
      updatedAt: Date.now(),
    }

    expect(await loadActiveLocalBackground()).toBeNull()
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeUndefined()

    localData[LOCAL_BACKGROUND_META_KEY] = {
      v: 1,
      enabled: true,
      fileName: 'missing.png',
      updatedAt: Date.now(),
    }
    expect(await getLocalBackgroundState()).toMatchObject({ enabled: false, hasImage: false })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeUndefined()
  })

  it('ignores unknown metadata versions', async () => {
    localData[LOCAL_BACKGROUND_META_KEY] = { v: 99, enabled: true, fileName: 'future.png', updatedAt: 1 }
    expect(await getLocalBackgroundState()).toMatchObject({ enabled: false, hasImage: false })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeDefined()
  })

  it('keeps the flag and the stored blob when Cache.match throws', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 4, 5, 6], 'kept.png'))
    cacheMock.match.mockRejectedValueOnce(new Error('match failed'))

    const state = await getLocalBackgroundState()
    expect(state).toMatchObject({
      enabled: true,
      hasImage: false,
      cacheAvailable: true,
      error: 'read-failed',
    })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ enabled: true, fileName: 'kept.png' })
    expect(await readCachedBytes()).toEqual([...PNG_HEADER, 4, 5, 6])
    expect(cacheStore.has(LOCAL_BACKGROUND_CACHE_KEY)).toBe(true)
  })

  it('keeps the flag when Cache Storage cannot be opened', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 1], 'kept.png'))
    vi.stubGlobal('caches', {
      open: vi.fn(async () => {
        throw new Error('open failed')
      }),
      delete: vi.fn(),
    })

    const state = await getLocalBackgroundState()
    expect(state).toMatchObject({
      enabled: true,
      hasImage: false,
      cacheAvailable: false,
      error: null,
    })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ enabled: true, fileName: 'kept.png' })
    expect(cacheStore.has(LOCAL_BACKGROUND_CACHE_KEY)).toBe(true)
  })

  it('keeps the enabled flag after a transient read failure', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 2], 'kept.png'))
    cacheMock.match.mockRejectedValueOnce(new Error('transient'))
    cacheMock.match.mockRejectedValueOnce(new Error('transient again'))

    expect(await getLocalBackgroundState()).toMatchObject({ enabled: true, error: 'read-failed' })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ enabled: true, fileName: 'kept.png' })
    // 新分頁讀取失敗時同樣只退回主題背景，不清旗標。
    expect(await loadActiveLocalBackground()).toBeNull()
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ enabled: true })
  })

  it('keeps the original blob after a transient read failure', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 7, 8], 'kept.png'))
    cacheMock.put.mockClear()
    cacheMock.match.mockRejectedValueOnce(new Error('transient'))

    expect((await getLocalBackgroundState()).hasImage).toBe(false)
    expect(await readCachedBytes()).toEqual([...PNG_HEADER, 7, 8])
    expect(cacheMock.delete).not.toHaveBeenCalled()
    expect(cacheMock.put).not.toHaveBeenCalled()
  })

  it('recovers on the next successful read', async () => {
    await saveLocalBackground(makeImage([...PNG_HEADER, 3], 'kept.png'))
    cacheMock.match.mockRejectedValueOnce(new Error('transient'))
    expect(await getLocalBackgroundState()).toMatchObject({ error: 'read-failed' })

    const state = await getLocalBackgroundState()
    expect(state).toMatchObject({ enabled: true, hasImage: true, error: null })
    const active = await loadActiveLocalBackground()
    expect(active).toBeTruthy()
    expect([...new Uint8Array(await active!.arrayBuffer())]).toEqual([...PNG_HEADER, 3])
  })

  it('still clears a stale flag when the cache is confirmed empty', async () => {
    localData[LOCAL_BACKGROUND_META_KEY] = {
      v: 1,
      enabled: true,
      fileName: 'stale.png',
      updatedAt: Date.now(),
    }

    expect(await getLocalBackgroundState()).toEqual({
      enabled: false,
      fileName: '',
      hasImage: false,
      cacheAvailable: true,
      error: null,
    })
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toBeUndefined()
    expect(await loadActiveLocalBackground()).toBeNull()
  })

  it('lets only the last of several quick selections win', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let call = 0
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      call += 1
      if (call === 1)
        await firstGate
      return { width: 100, height: 100, close: vi.fn() }
    }))

    const first = saveLocalBackground(makeImage([...PNG_HEADER, 1], 'first.png'))
    const second = saveLocalBackground(makeImage([...PNG_HEADER, 2], 'second.png'))
    // 等第一個解碼真的開始後才放行，確保它落到 generation 檢查。
    await vi.waitFor(() => {
      if (call < 1)
        throw new Error('first validation not started')
    })
    releaseFirst?.()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual({ ok: false, code: 'superseded' })
    expect(secondResult.ok).toBe(true)
    expect(await readCachedBytes()).toEqual([...PNG_HEADER, 2])
    expect(localData[LOCAL_BACKGROUND_META_KEY]).toMatchObject({ fileName: 'second.png' })
  })
})
