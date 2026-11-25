import type { StoragePortLike } from './migrate-sidebar-ls'

import type { Settings } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './appearance'
import {
  LS_KEY_COLLAPSED,
  LS_KEY_MIGRATED,
  LS_KEY_WIDTH,
  runSidebarLsMigration,
} from './migrate-sidebar-ls'
import { STORAGE_KEYS } from './store-persistence'

// ---------- Helpers ------------------------------------------------------

interface FakeStorage {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  data: Map<string, unknown>
  /** Pass this to runSidebarLsMigration — cast satisfies the interface. */
  readonly port: StoragePortLike
}

function createFakeStorage(): FakeStorage {
  const data = new Map<string, unknown>()
  const get = vi.fn(async (key: string) => data.get(key))
  const set = vi.fn(async (key: string, value: unknown) => {
    data.set(key, value)
  })
  return {
    get,
    set,
    data,
    port: { get, set } as unknown as StoragePortLike,
  }
}

function makeAppearance(overrides: Partial<typeof DEFAULT_APPEARANCE_SETTINGS>) {
  return { ...DEFAULT_APPEARANCE_SETTINGS, ...overrides }
}

// ---------- Suite --------------------------------------------------------

describe('runSidebarLsMigration', () => {
  beforeEach(() => {
    // Fresh localStorage on every test
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => Object.hasOwn(store, k) ? store[k] : null),
      setItem: vi.fn((k: string, v: string) => { store[k] = v }),
      removeItem: vi.fn((k: string) => { delete store[k] }),
      clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
    } as unknown as unknown as unknown as Storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // --- Branch 1: already-migrated --------------------------------------

  it('returns already-migrated when marker exists, does not touch storage', async () => {
    localStorage.setItem(LS_KEY_MIGRATED, '1')
    const storage = createFakeStorage()

    const result = await runSidebarLsMigration(storage.port)

    expect(result).toMatchObject({
      persisted: false,
      marked: true,
      skipped: true,
      reason: 'already-migrated',
    })
    expect(storage.get).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
  })

  // --- Branch 2: no-localStorage ----------------------------------------

  it('returns no-localStorage and does not write marker when localStorage throws on read', async () => {
    const brokenLs: Storage = {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('private mode') },
      removeItem: () => { throw new Error('private mode') },
      clear: () => { throw new Error('private mode') },
      length: 0,
      key: () => null,
    }
    vi.stubGlobal('localStorage', brokenLs)

    const storage = createFakeStorage()
    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('no-localStorage')
    expect(result.skipped).toBe(true)
    expect(result.persisted).toBe(false)
    expect(result.marked).toBe(false)
  })

  it('falls back to safe defaults when only non-marker LS reads throw', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => {
        if (k === LS_KEY_MIGRATED) {
          return store[k] ?? null
        }
        throw new Error('corrupt')
      }),
      setItem: vi.fn((k: string, v: string) => { store[k] = v }),
      removeItem: vi.fn((k: string) => { delete store[k] }),
      clear: vi.fn(),
      length: 0,
      key: () => null,
    } as unknown as unknown as Storage)

    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined, sidebarCollapsed: undefined }),
    })

    const result = await runSidebarLsMigration(storage.port)

    // Should proceed with null values from LS, fall back to defaults
    expect(result.reason).toBe('persisted')
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(merged.appearance.sidebarCollapsed).toBe(false)
    expect(localStorage.getItem(LS_KEY_MIGRATED)).toBe('1')
  })

  // --- Branch 3: new-settings-complete (skipPersist) -------------------

  it('skips persist and writes marker when new settings already have both fields', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '280')
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: 300, sidebarCollapsed: true }),
    })

    const result = await runSidebarLsMigration(storage.port)

    expect(result).toMatchObject({
      persisted: false,
      marked: true,
      skipped: true,
      reason: 'new-settings-complete',
    })
    // marker should still be written since skipPersist = true
    expect(localStorage.getItem(LS_KEY_MIGRATED)).toBe('1')
  })

  // --- Branch 4: backfill when only sidebarWidth missing ---------------

  it('backfills sidebarWidth from LS when only sidebarWidth missing, preserves existing collapsed', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '280')
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined, sidebarCollapsed: false }),
    })

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persisted')
    expect(result.persisted).toBe(true)
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    expect(call).toBeDefined()
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(280)
    expect(merged.appearance.sidebarCollapsed).toBe(false) // preserved from existing
    expect(localStorage.getItem(LS_KEY_MIGRATED)).toBe('1')
  })

  // --- Branch 5: backfill when only sidebarCollapsed missing -----------

  it('backfills sidebarCollapsed from LS when only sidebarCollapsed missing', async () => {
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: 250, sidebarCollapsed: undefined }),
    })

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persisted')
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(250) // preserved from existing
    expect(merged.appearance.sidebarCollapsed).toBe(true)
  })

  // --- Branch 6: both missing, use LS values ----------------------------

  it('backfills both fields from LS when both missing in new settings', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '240')
    localStorage.setItem(LS_KEY_COLLAPSED, '1') // '1' is also truthy
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined, sidebarCollapsed: undefined }),
    })

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persisted')
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(240)
    expect(merged.appearance.sidebarCollapsed).toBe(true)
  })

  // --- Branch 7: both missing, no LS → safe defaults -------------------

  it('uses safe defaults when both fields missing and no LS values', async () => {
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined, sidebarCollapsed: undefined }),
    })

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persisted')
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(merged.appearance.sidebarCollapsed).toBe(false)
  })

  // --- Branch 8: persist-failed, no marker, next launch will retry -----

  it('returns persist-failed and does NOT write migrated marker when storage.set throws', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '250')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })
    storage.set.mockRejectedValueOnce(new Error('storage quota exceeded'))

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persist-failed')
    expect(result.persisted).toBe(false)
    expect(result.marked).toBe(false)
    expect(result.skipped).toBe(false)
    // Most importantly: marker NOT written so next launch retries
    expect(localStorage.getItem(LS_KEY_MIGRATED)).toBeNull()
  })

  // --- Branch 9: persist succeeds but marker write fails ---------------

  it('still reports persisted=true when storage persist succeeded but marker write fails', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => store[k] ?? null),
      setItem: vi.fn((k: string, v: string) => {
        if (k === LS_KEY_MIGRATED) {
          throw new Error('LS full')
        }
        store[k] = v
      }),
      removeItem: vi.fn((k: string) => { delete store[k] }),
      clear: vi.fn(),
      length: 0,
      key: () => null,
    } as unknown as unknown as Storage)

    localStorage.setItem(LS_KEY_WIDTH, '260')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    const result = await runSidebarLsMigration(storage.port)

    // persist succeeded but marker failed
    expect(result.reason).toBe('persisted')
    expect(result.persisted).toBe(true)
    expect(result.marked).toBe(false)
  })

  // --- Edge: LS width out of range → null → default --------------------

  it('ignores LS width below MIN, falls back to safe default', async () => {
    localStorage.setItem(LS_KEY_WIDTH, `${SIDEBAR_WIDTH_MIN - 100}`)
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('ignores LS width above MAX, falls back to safe default', async () => {
    localStorage.setItem(LS_KEY_WIDTH, `${SIDEBAR_WIDTH_MAX + 100}`)
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  // --- Edge: LS width non-numeric → null → default --------------------

  it('ignores non-numeric LS width, falls back to safe default', async () => {
    localStorage.setItem(LS_KEY_WIDTH, 'abc')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  // --- Edge: valid width is rounded ------------------------------------

  it('rounds LS width to nearest integer when valid', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '240.7')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(241)
  })

  // --- Edge: collapsed accepts both '1' and 'true' --------------------

  it('treats LS collapsed="1" as true', async () => {
    localStorage.setItem(LS_KEY_COLLAPSED, '1')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarCollapsed: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarCollapsed).toBe(true)
  })

  it('treats LS collapsed="true" as true', async () => {
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarCollapsed: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarCollapsed).toBe(true)
  })

  it('treats LS collapsed="0" or "false" as false', async () => {
    localStorage.setItem(LS_KEY_COLLAPSED, '0')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarCollapsed: undefined }),
    })

    await runSidebarLsMigration(storage.port)

    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarCollapsed).toBe(false)
  })

  // --- Idempotency: can be called twice safely ------------------------

  it('second call after successful migration short-circuits on marker', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '260')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined }),
    })

    const first = await runSidebarLsMigration(storage.port)
    expect(first.reason).toBe('persisted')
    expect(localStorage.getItem(LS_KEY_MIGRATED)).toBe('1')

    // Second call should short-circuit
    const second = await runSidebarLsMigration(storage.port)
    expect(second).toMatchObject({
      persisted: false,
      marked: true,
      skipped: true,
      reason: 'already-migrated',
    })
    // storage.set should only have been called once (from first run)
    const settingWrites = storage.set.mock.calls.filter(c => c[0] === STORAGE_KEYS.settings)
    expect(settingWrites).toHaveLength(1)
  })

  // --- storage returns null (no settings) → DEFAULT_SETTINGS already has sidebar fields → skip ---

  it('skips persist when storage is empty because DEFAULT_SETTINGS carries full sidebar fields', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '260')
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    storage.get.mockResolvedValue(null) // no settings at all

    const result = await runSidebarLsMigration(storage.port)

    // DEFAULT_SETTINGS.appearance already has both sidebarWidth and sidebarCollapsed,
    // so the migration correctly identifies settings as "complete" and skips writing.
    expect(result.reason).toBe('new-settings-complete')
    expect(result.skipped).toBe(true)
    expect(result.marked).toBe(true) // marker still written
    expect(storage.set).not.toHaveBeenCalled()
  })

  // --- appearance exists but lacks both sidebar fields (legacy partial) ---

  it('persists merged settings when appearance object exists but lacks both sidebar fields', async () => {
    localStorage.setItem(LS_KEY_WIDTH, '260')
    localStorage.setItem(LS_KEY_COLLAPSED, 'true')
    const storage = createFakeStorage()
    // Simulate a legacy V6 settings object where appearance exists but has no sidebar fields yet
    storage.get.mockResolvedValue({
      appearance: makeAppearance({ sidebarWidth: undefined, sidebarCollapsed: undefined }),
    } as Partial<Settings>)

    const result = await runSidebarLsMigration(storage.port)

    expect(result.reason).toBe('persisted')
    const call = storage.set.mock.calls.find(c => c[0] === STORAGE_KEYS.settings)
    const merged = call![1] as Settings
    expect(merged.appearance.sidebarWidth).toBe(260)
    expect(merged.appearance.sidebarCollapsed).toBe(true)
  })
})
