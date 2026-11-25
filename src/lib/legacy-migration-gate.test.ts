import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./migrate-yunji-storage', () => ({ runLegacyStorageMigration: mocks.run }))

async function loadGate() {
  vi.resetModules()
  return import('./legacy-migration-gate')
}

const result = (status: string) => ({ status, migrated: [], failed: [], marked: status === 'migrated', pendingGroups: [], incomplete: false })

beforeEach(() => {
  mocks.run.mockReset()
})

describe('legacy migration gate', () => {
  it('treats migrated / already-migrated / nothing-to-migrate as ready and caches success', async () => {
    for (const status of ['migrated', 'already-migrated', 'nothing-to-migrate']) {
      mocks.run.mockResolvedValueOnce(result(status))
      const gate = await loadGate()
      expect(await gate.legacyMigrationReady()).toBe(true)
      expect(await gate.legacyMigrationReady()).toBe(true)
      expect(mocks.run).toHaveBeenCalledTimes(1)
      mocks.run.mockReset()
    }
  })

  it('does not treat partial or unavailable migrations as ready', async () => {
    for (const status of ['partial', 'unavailable']) {
      mocks.run.mockResolvedValueOnce(result(status))
      const gate = await loadGate()
      expect(await gate.legacyMigrationReady()).toBe(false)
      mocks.run.mockReset()
    }
  })

  it('retries after a failure instead of caching it forever', async () => {
    mocks.run.mockResolvedValueOnce(result('partial'))
    mocks.run.mockResolvedValueOnce(result('migrated'))
    const gate = await loadGate()
    expect(await gate.legacyMigrationReady()).toBe(false)
    expect(await gate.legacyMigrationReady()).toBe(true)
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })

  it('handles a thrown migration as not ready and retries later', async () => {
    mocks.run.mockRejectedValueOnce(new Error('storage-unavailable'))
    mocks.run.mockResolvedValueOnce(result('migrated'))
    const gate = await loadGate()
    expect(await gate.legacyMigrationReady()).toBe(false)
    expect(await gate.legacyMigrationReady()).toBe(true)
  })

  it('single-flights concurrent callers in one context', async () => {
    let release: (value: unknown) => void = () => {}
    mocks.run.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    const gate = await loadGate()
    const first = gate.legacyMigrationReady()
    const second = gate.legacyMigrationReady()
    expect(mocks.run).toHaveBeenCalledTimes(1)
    release(result('migrated'))
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })
})
