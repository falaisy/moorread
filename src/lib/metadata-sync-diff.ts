import type { MetadataSyncDocument, VersionedBookmarkMeta, VersionedValue } from './metadata-sync-document'
import type { MetadataSyncScope } from './types'
import {
  enabledMetaFields,
  META_FIELDS,
  normalizeMetadataSyncScope,
  valuesEqual,
} from './metadata-sync-constants'
import { createVersionedValue } from './metadata-sync-document'

function newerValue(left: VersionedValue | undefined, right: VersionedValue | undefined): VersionedValue | undefined {
  if (!left)
    return right
  if (!right)
    return left
  if (left.updatedAt !== right.updatedAt)
    return left.updatedAt > right.updatedAt ? left : right
  return left.deviceId >= right.deviceId ? left : right
}

export function withLocalDiff(
  shadow: MetadataSyncDocument | undefined,
  current: MetadataSyncDocument,
  scope?: Partial<MetadataSyncScope>,
): MetadataSyncDocument {
  if (!shadow)
    return current
  const fieldsToSync = enabledMetaFields(scope)
  const next: MetadataSyncDocument = structuredClone(shadow)
  next.updatedAt = current.updatedAt
  next.deviceId = current.deviceId
  const urls = new Set([...Object.keys(shadow.bookmarkMeta), ...Object.keys(current.bookmarkMeta)])
  for (const url of urls) {
    const existing = shadow.bookmarkMeta[url]?.fields ?? {}
    const currentFields = current.bookmarkMeta[url]?.fields ?? {}
    const fields = { ...existing }
    for (const field of fieldsToSync) {
      const previousValue = existing[field]?.deleted ? undefined : existing[field]?.value
      const currentValue = currentFields[field]?.value
      if (!valuesEqual(previousValue, currentValue))
        fields[field] = createVersionedValue(currentValue, current.updatedAt, current.deviceId)
    }
    next.bookmarkMeta[url] = { fields }
  }
  if (!normalizeMetadataSyncScope(scope).categoryIcons)
    return next
  const paths = new Set([...Object.keys(shadow.categoryMeta), ...Object.keys(current.categoryMeta)])
  for (const path of paths) {
    const previousValue = shadow.categoryMeta[path]?.deleted ? undefined : shadow.categoryMeta[path]?.value
    const currentValue = current.categoryMeta[path]?.value
    if (!valuesEqual(previousValue, currentValue))
      next.categoryMeta[path] = createVersionedValue(currentValue, current.updatedAt, current.deviceId)
  }
  return next
}

export function mergeMetadataDocuments(
  left: MetadataSyncDocument,
  right: MetadataSyncDocument,
  deviceId = left.deviceId,
): MetadataSyncDocument {
  const merged: MetadataSyncDocument = {
    schemaVersion: 2,
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    deviceId,
    bookmarkMeta: {},
    categoryMeta: {},
  }
  const urls = new Set([...Object.keys(left.bookmarkMeta), ...Object.keys(right.bookmarkMeta)])
  for (const url of urls) {
    const fields: VersionedBookmarkMeta['fields'] = {}
    for (const field of META_FIELDS) {
      const value = newerValue(left.bookmarkMeta[url]?.fields[field], right.bookmarkMeta[url]?.fields[field])
      if (value)
        fields[field] = value
    }
    merged.bookmarkMeta[url] = { fields }
  }
  const paths = new Set([...Object.keys(left.categoryMeta), ...Object.keys(right.categoryMeta)])
  for (const path of paths) {
    const value = newerValue(left.categoryMeta[path], right.categoryMeta[path])
    if (value)
      merged.categoryMeta[path] = value
  }
  return merged
}
