import type { Settings } from './types'
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from './appearance'
import { persist, STORAGE_KEYS, withSettingsLock } from './store-persistence'
import { DEFAULT_SETTINGS } from './store-settings-state'

export const LS_KEY_MIGRATED = 'moorread.sidebar.migrated'
export const LS_KEY_WIDTH = 'moorread.sidebar.width'
export const LS_KEY_COLLAPSED = 'moorread.sidebar.collapsed'

export interface SidebarMigrationResult {
  /** true if a persist write happened */
  persisted: boolean
  /** true if migrated marker was successfully written */
  marked: boolean
  /** true if we completely skipped (LS unavailable or already migrated) */
  skipped: boolean
  /** reason codes for debugging */
  reason:
    | 'already-migrated'
    | 'no-localStorage'
    | 'new-settings-complete'
    | 'persisted'
    | 'persist-failed'
}

export interface StoragePortLike {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
}

/**
 * One-shot migration that backfills sidebarWidth / sidebarCollapsed from the
 * old pre-V7 localStorage keys into the synced settings storage. Safe to call
 * multiple times — once `moorread.sidebar.migrated === '1'` we short-circuit.
 *
 * The caller must await this before passing settings to normalizeSettings,
 * so that either the migrated values or the safe defaults are already
 * present on startup.
 */
export async function runSidebarLsMigration(
  storage: StoragePortLike,
): Promise<SidebarMigrationResult> {
  // --- Try to read migration marker / LS availability --------------------
  let lsAvailable = true
  try {
    const marker = globalThis.localStorage?.getItem(LS_KEY_MIGRATED)
    if (marker === '1') {
      return { persisted: false, marked: true, skipped: true, reason: 'already-migrated' }
    }
  }
  catch {
    // localStorage is unavailable (private mode, or WebExtension API not present)
    lsAvailable = false
  }

  if (!lsAvailable) {
    // No localStorage → nothing to migrate, no marker to write.
    return { persisted: false, marked: false, skipped: true, reason: 'no-localStorage' }
  }

  // --- Read old LS values (best-effort) ----------------------------------
  let lsWidth: number | null = null
  let lsCollapsed: boolean | null = null
  try {
    const rawW = globalThis.localStorage!.getItem(LS_KEY_WIDTH)
    if (rawW !== null) {
      const n = Number(rawW)
      if (Number.isFinite(n) && n >= SIDEBAR_WIDTH_MIN && n <= SIDEBAR_WIDTH_MAX)
        lsWidth = Math.round(n)
    }
    const rawC = globalThis.localStorage!.getItem(LS_KEY_COLLAPSED)
    if (rawC !== null)
      lsCollapsed = rawC === '1' || rawC === 'true'
  }
  catch {
    // treat as missing; safe defaults will be used
  }

  // --- Merge and persist under settings lock -----------------------------
  let persistSucceeded = false
  let skipPersist = false
  try {
    await withSettingsLock(async () => {
      const latest = (await storage.get<Partial<Settings>>(STORAGE_KEYS.settings))
        ?? DEFAULT_SETTINGS
      const a = latest.appearance ?? DEFAULT_SETTINGS.appearance

      if (a.sidebarWidth !== undefined && a.sidebarCollapsed !== undefined) {
        skipPersist = true
        return // new settings already complete → no write
      }

      const mergedAppearance = {
        ...a,
        sidebarWidth: a.sidebarWidth ?? lsWidth ?? SIDEBAR_WIDTH_DEFAULT,
        sidebarCollapsed: a.sidebarCollapsed ?? lsCollapsed ?? false,
      }

      const merged: Settings = {
        ...DEFAULT_SETTINGS,
        ...latest,
        appearance: mergedAppearance,
      }

      await persist(storage as never, STORAGE_KEYS.settings, merged)
      persistSucceeded = true
    })
  }
  catch {
    persistSucceeded = false
  }

  // --- Write migration marker --------------------------------------------
  // Only attempt after a successful persist OR when we confirmed new settings
  // are complete (skipPersist). On persist failure we deliberately do NOT
  // mark, so the next launch will retry.
  let markerWritten = false
  if (persistSucceeded || skipPersist) {
    try {
      globalThis.localStorage!.setItem(LS_KEY_MIGRATED, '1')
      markerWritten = true
    }
    catch {
      markerWritten = false
    }
  }

  return {
    persisted: persistSucceeded,
    marked: markerWritten,
    skipped: skipPersist,
    reason: skipPersist
      ? 'new-settings-complete'
      : persistSucceeded
        ? 'persisted'
        : 'persist-failed',
  }
}
