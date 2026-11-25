import type { MetadataSyncDocument, MetadataSyncResult } from './metadata-sync-document'
import type { BookmarkMeta, Category, CategoryMeta, MetadataSyncScope } from './types'
import { LocalizedError } from './localized-error'
import {
  decryptMetadataText,
  encryptMetadataText,
  isEncryptedMetadataEnvelope,
} from './metadata-crypto'
import {
  byteLength,
  DEVICE_ID_KEY,
  isMetadataSyncWriteQuotaError,
  isRecord,
  LOCAL_DOCUMENT_KEY,
  MAX_ATTEMPTS,
  SYNC_MANIFEST_KEY,
  SYNC_PART_PREFIX,
} from './metadata-sync-constants'
import { mergeMetadataDocuments, withLocalDiff } from './metadata-sync-diff'
import {
  createDocument,
  fitDocumentToBudget,
  materializeMetadataDocument,
  parseDocument,
  splitUtf8,
  syncContentEqual,
} from './metadata-sync-document'

export {
  DEFAULT_METADATA_SYNC_SCOPE,
  isMetadataSyncWriteQuotaError,
  normalizeMetadataSyncScope,
} from './metadata-sync-constants'
export { mergeMetadataDocuments } from './metadata-sync-diff'
export type {
  MaterializedMetadataSyncDocument,
  MetadataSyncDocument,
  MetadataSyncPayload,
  MetadataSyncResult,
} from './metadata-sync-document'
export {
  applyMaterializedBookmarkMetadata,
  createMetadataSyncPayload,
  materializeMetadataDocument,
} from './metadata-sync-document'

interface MetadataSyncManifest {
  schemaVersion: 2 | 3
  partCount: number
  updatedAt: number
  deviceId: string
  encrypted?: boolean
}

async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(DEVICE_ID_KEY)
  if (typeof stored[DEVICE_ID_KEY] === 'string')
    return stored[DEVICE_ID_KEY]
  const deviceId = crypto.randomUUID()
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceId })
  return deviceId
}

async function readRemoteDocument(
  run: <T>(task: () => Promise<T>) => Promise<T>,
  passphrase?: string,
): Promise<MetadataSyncDocument | undefined> {
  const manifestValue = await run(() => chrome.storage.sync.get(SYNC_MANIFEST_KEY))
  const manifest = manifestValue[SYNC_MANIFEST_KEY]
  if (!isRecord(manifest) || typeof manifest.partCount !== 'number' || manifest.partCount < 1)
    return undefined
  const keys = Array.from({ length: manifest.partCount }, (_, index) => `${SYNC_PART_PREFIX}${index}`)
  const values = await run(() => chrome.storage.sync.get(keys))
  const serialized = keys.map(key => values[key]).join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  }
  catch {
    return undefined
  }
  if (!isEncryptedMetadataEnvelope(parsed))
    return parseDocument(parsed)
  if (!passphrase)
    throw new LocalizedError('runtimeMetadataRemotePassphraseRequired')
  try {
    return parseDocument(JSON.parse(await decryptMetadataText(parsed, passphrase)))
  }
  catch {
    throw new LocalizedError('runtimeMetadataDecryptFailed')
  }
}

async function writeRemoteDocument(
  document: MetadataSyncDocument,
  run: <T>(task: () => Promise<T>) => Promise<T>,
  passphrase?: string,
): Promise<number> {
  const serialized = passphrase
    ? JSON.stringify(await encryptMetadataText({
        plaintext: JSON.stringify(document),
        passphrase,
        updatedAt: document.updatedAt,
        deviceId: document.deviceId,
      }))
    : JSON.stringify(document)
  const parts = splitUtf8(serialized)
  const values = Object.fromEntries(parts.map((part, index) => [`${SYNC_PART_PREFIX}${index}`, part]))
  const manifest: MetadataSyncManifest = {
    schemaVersion: passphrase ? 3 : 2,
    partCount: parts.length,
    updatedAt: document.updatedAt,
    deviceId: document.deviceId,
    encrypted: Boolean(passphrase),
  }
  // A multi-item set is a single write operation. Keeping the parts and manifest
  // together halves Chrome Sync write pressure and avoids exposing a new manifest
  // before all of its parts have been stored.
  await run(() => chrome.storage.sync.set({
    ...values,
    [SYNC_MANIFEST_KEY]: manifest,
  }))
  return byteLength(serialized)
}

export function markLocalMetadataChanged(): Promise<void> {
  // The current values are diffed against the local shadow during the next sync.
  return Promise.resolve()
}

export async function synchronizeMetadata(input: {
  meta: Record<string, BookmarkMeta>
  categoryMeta: Record<string, CategoryMeta>
  categories: Category[]
  scope?: Partial<MetadataSyncScope>
  encryptionPassphrase?: string
}): Promise<MetadataSyncResult> {
  let retryCount = 0
  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await task()
      }
      catch (cause) {
        lastError = cause
        // Frequency quotas recover over minutes or hours. Immediate retries only
        // add more pressure, so let the outer scheduler apply a long backoff.
        if (isMetadataSyncWriteQuotaError(cause))
          throw cause
        if (attempt === MAX_ATTEMPTS - 1)
          break
        retryCount += 1
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt))
      }
    }
    throw lastError
  }

  const [deviceId, localValue, remote] = await Promise.all([
    getDeviceId(),
    chrome.storage.local.get(LOCAL_DOCUMENT_KEY),
    readRemoteDocument(run, input.encryptionPassphrase?.trim() || undefined),
  ])
  const shadow = parseDocument(localValue[LOCAL_DOCUMENT_KEY])
  const updatedAt = Date.now()
  const current = createDocument({ ...input, deviceId, updatedAt })
  const local = withLocalDiff(shadow, current, input.scope)
  const merged = remote ? mergeMetadataDocuments(local, remote, deviceId) : local
  merged.updatedAt = Math.max(updatedAt, merged.updatedAt)
  const remoteContributed = Boolean(remote && !syncContentEqual(local, merged))
  const needsUpload = !remote || !syncContentEqual(remote, merged)
  const payload = fitDocumentToBudget(merged)

  const encryptionPassphrase = input.encryptionPassphrase?.trim() || undefined
  const byteCount = needsUpload
    ? await writeRemoteDocument(payload.document, run, encryptionPassphrase)
    : payload.byteCount
  await chrome.storage.local.set({ [LOCAL_DOCUMENT_KEY]: payload.document })

  const direction: MetadataSyncResult['direction'] = needsUpload
    ? remoteContributed ? 'merged' : 'uploaded'
    : remoteContributed ? 'downloaded' : 'unchanged'
  return {
    direction,
    document: materializeMetadataDocument(payload.document, input.scope),
    omittedBookmarkCount: payload.omittedBookmarkCount,
    omittedBookmarkUrls: payload.omittedBookmarkUrls,
    byteCount,
    syncedAt: payload.document.updatedAt,
    retryCount,
  }
}

export const metadataSyncManifestKey = SYNC_MANIFEST_KEY

export async function clearMetadataSyncStorage(): Promise<void> {
  const all = await chrome.storage.sync.get(null)
  const keys = Object.keys(all).filter(key =>
    key === SYNC_MANIFEST_KEY || key.startsWith(SYNC_PART_PREFIX))
  if (keys.length > 0)
    await chrome.storage.sync.remove(keys)
  await chrome.storage.local.remove(LOCAL_DOCUMENT_KEY)
}
