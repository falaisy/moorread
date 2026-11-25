import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNavStore } from './store'

const storageState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  reads: [] as string[],
  writes: [] as Array<{ area: string, key: string, value: unknown }>,
  failures: new Map<string, { error: Error, remaining: number }>(),
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    area: string

    constructor(options: { area: string }) {
      this.area = options.area
    }

    async get(key: string) {
      const id = `${this.area}:${key}`
      storageState.reads.push(id)
      const failure = storageState.failures.get(id)
      if (failure) {
        failure.remaining -= 1
        if (failure.remaining <= 0)
          storageState.failures.delete(id)
        throw failure.error
      }
      return structuredClone(storageState.values.get(id))
    }

    async set(key: string, value: unknown) {
      storageState.writes.push({ area: this.area, key, value })
      storageState.values.set(`${this.area}:${key}`, structuredClone(value))
    }

    async remove() {}
  },
}))

const initialState = useNavStore.getInitialState()

function transientError() {
  return new Error(
    'IO error: C:\\profile\\Default\\Local Extension Settings\\moorread\\MANIFEST-000001: NewSequentialFile: The system cannot find the file specified.',
  )
}

function failReads(key: string, error: Error, remaining: number) {
  storageState.failures.set(key, { error, remaining })
}

function readsOf(key: string) {
  return storageState.reads.filter(read => read === key)
}

beforeEach(() => {
  storageState.values.clear()
  storageState.reads.length = 0
  storageState.writes.length = 0
  storageState.failures.clear()
  useNavStore.setState(initialState, true)
  vi.stubGlobal('chrome', { bookmarks: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('store initialization', () => {
  it('loads and validates every required store before marking initialization complete', async () => {
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { description: 'Keep', tags: ['a'] },
    })
    storageState.values.set('local:moorread:category-meta', { 'cat-1': { emoji: 'A' } })
    storageState.values.set('sync:moorread:settings', { language: 'en', theme: 'dark' })
    storageState.values.set('local:moorread:usage', {
      'https://example.test': { openCount: 2, lastOpenedAt: 1 },
    })

    await useNavStore.getState().init()

    const state = useNavStore.getState()
    expect(state.initialized).toBe(true)
    expect(state.initError).toBeNull()
    expect(state.meta).toEqual({ 'https://example.test': { description: 'Keep', tags: ['a'] } })
    expect(state.categoryMeta).toEqual({ 'cat-1': { emoji: 'A' } })
    expect(state.settings).toMatchObject({ language: 'en', theme: 'dark' })
    expect(state.usage).toEqual({ 'https://example.test': { openCount: 2, lastOpenedAt: 1 } })
  })

  it('recovers when a transient LevelDB read failure succeeds on retry', async () => {
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { description: 'Keep' },
    })
    failReads('local:moorread:meta', transientError(), 1)

    await useNavStore.getState().init()

    const state = useNavStore.getState()
    expect(state.initialized).toBe(true)
    expect(state.initError).toBeNull()
    expect(state.meta).toEqual({ 'https://example.test': { description: 'Keep' } })
    expect(readsOf('local:moorread:meta')).toHaveLength(2)
  })

  it('keeps the failure state and existing data when retries are exhausted, then recovers on a later call', async () => {
    const meta = { 'https://state.example': { description: 'Existing' } }
    const bookmarks = [{
      id: 'bm-1',
      name: 'Existing',
      url: 'https://state.example',
      categoryId: 'all',
    }]
    useNavStore.setState({ meta, bookmarks })
    storageState.values.set('local:moorread:meta', {
      'https://stored.example': { description: 'Stored' },
    })
    failReads('local:moorread:meta', transientError(), Number.POSITIVE_INFINITY)

    await expect(useNavStore.getState().init()).rejects.toThrow('MANIFEST')

    const failed = useNavStore.getState()
    expect(failed.initialized).toBe(false)
    expect(failed.initError).toMatchObject({ retryable: true })
    expect(failed.meta).toBe(meta)
    expect(failed.bookmarks).toBe(bookmarks)
    expect(readsOf('local:moorread:meta')).toHaveLength(5)

    storageState.failures.clear()
    await useNavStore.getState().init()

    const recovered = useNavStore.getState()
    expect(recovered.initialized).toBe(true)
    expect(recovered.initError).toBeNull()
    expect(recovered.meta).toEqual({ 'https://stored.example': { description: 'Stored' } })
    expect(recovered.bookmarks).toBe(bookmarks)
  })

  it('does not retry a non-transient read error', async () => {
    failReads('local:moorread:meta', new Error('Extension context invalidated'), 1)

    await expect(useNavStore.getState().init()).rejects.toThrow('Extension context invalidated')

    const state = useNavStore.getState()
    expect(state.initialized).toBe(false)
    expect(state.initError).toMatchObject({ retryable: false })
    expect(readsOf('local:moorread:meta')).toHaveLength(1)
    expect(storageState.writes).toEqual([])
  })

  it('does not apply an invalid stored shape as empty data', async () => {
    storageState.values.set('local:moorread:meta', ['not', 'a', 'record'])

    await expect(useNavStore.getState().init()).rejects.toThrow('init.invalid.meta')

    expect(useNavStore.getState().initialized).toBe(false)
    expect(useNavStore.getState().meta).toEqual({})
    expect(readsOf('local:moorread:meta')).toHaveLength(1)
  })

  it('shares one read pass between concurrent init calls and never repeats it after success', async () => {
    const first = useNavStore.getState().init()
    const second = useNavStore.getState().init()

    await Promise.all([first, second])

    expect(useNavStore.getState().initialized).toBe(true)
    expect(readsOf('local:moorread:meta')).toHaveLength(1)

    await useNavStore.getState().init()
    expect(readsOf('local:moorread:meta')).toHaveLength(1)
  })

  it('does not apply partially read data when another required read fails', async () => {
    storageState.values.set('local:moorread:meta', {
      'https://example.test': { tags: ['keep'] },
    })
    failReads('local:moorread:category-meta', new Error('quota backend offline'), 1)

    await expect(useNavStore.getState().init()).rejects.toThrow('quota backend offline')

    const state = useNavStore.getState()
    expect(state.initialized).toBe(false)
    expect(state.meta).toEqual({})
    expect(state.categoryMeta).toEqual({})
    expect(readsOf('local:moorread:category-meta')).toHaveLength(1)
  })
})
