const suppressionStorageKey = 'moorread:bookmark-deletion-suppression'
const suppressionTtlMs = 30_000
const SUPPRESSION_LOCK_KEY = suppressionStorageKey

type SuppressionMap = Record<string, number>

// Multi-tab sessions race when each tab does read-modify-write on the same
// session-storage key. Guard the whole operation with a Web Lock where
// available, falling back to a serialized Promise queue.
let suppressionWriteQueue: Promise<unknown> = Promise.resolve()

async function withSuppressionLock<T>(commit: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(SUPPRESSION_LOCK_KEY, commit)

  const pending = suppressionWriteQueue.then(commit, commit)
  suppressionWriteQueue = pending.catch(() => undefined)
  return pending
}

async function readSuppressions(): Promise<SuppressionMap> {
  const stored = await chrome.storage.session.get(suppressionStorageKey)
  const value = stored[suppressionStorageKey]
  return typeof value === 'object' && value !== null
    ? value as SuppressionMap
    : {}
}

export async function suppressBookmarkDeletionArchive(ids: string[]): Promise<void> {
  await withSuppressionLock(async () => {
    const suppressions = await readSuppressions()
    const expiresAt = Date.now() + suppressionTtlMs
    for (const id of ids)
      suppressions[id] = expiresAt
    await chrome.storage.session.set({ [suppressionStorageKey]: suppressions })
  })
}

export async function releaseBookmarkDeletionArchive(ids: string[]): Promise<void> {
  await withSuppressionLock(async () => {
    const suppressions = await readSuppressions()
    for (const id of ids)
      delete suppressions[id]
    await chrome.storage.session.set({ [suppressionStorageKey]: suppressions })
  })
}

export async function consumeBookmarkDeletionSuppression(id: string): Promise<boolean> {
  return await withSuppressionLock(async () => {
    const suppressions = await readSuppressions()
    const expiresAt = suppressions[id]
    delete suppressions[id]
    for (const [candidateId, candidateExpiresAt] of Object.entries(suppressions)) {
      if (candidateExpiresAt <= Date.now())
        delete suppressions[candidateId]
    }
    await chrome.storage.session.set({ [suppressionStorageKey]: suppressions })
    return typeof expiresAt === 'number' && expiresAt > Date.now()
  })
}
