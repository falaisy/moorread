import type { MetaField } from './metadata-sync-constants'
import type { BookmarkMeta, Category, CategoryMeta, MetadataSyncScope } from './types'
import { getCategoryPath } from './category-path'
import {
  byteLength,
  enabledMetaFields,
  isRecord,
  MAX_PART_BYTES,
  MAX_SYNC_BYTES,
  META_FIELDS,
  normalizeMetadataSyncScope,
  valuesEqual,
} from './metadata-sync-constants'

export interface VersionedValue {
  value?: unknown
  deleted?: true
  updatedAt: number
  deviceId: string
}

export interface VersionedBookmarkMeta {
  fields: Partial<Record<MetaField, VersionedValue>>
}

export interface MetadataSyncDocument {
  schemaVersion: 2
  updatedAt: number
  deviceId: string
  bookmarkMeta: Record<string, VersionedBookmarkMeta>
  categoryMeta: Record<string, VersionedValue>
}

export interface MaterializedMetadataSyncDocument {
  bookmarkMeta: Record<string, BookmarkMeta>
  categoryMeta: Array<{ path: string[], emoji: string }>
}

export interface MetadataSyncPayload {
  document: MetadataSyncDocument
  omittedBookmarkCount: number
  omittedBookmarkUrls: string[]
  byteCount: number
}

export interface MetadataSyncResult {
  direction: 'downloaded' | 'uploaded' | 'merged' | 'unchanged'
  document: MaterializedMetadataSyncDocument
  omittedBookmarkCount: number
  omittedBookmarkUrls: string[]
  byteCount: number
  syncedAt: number
  retryCount: number
}

export function syncContentEqual(left: MetadataSyncDocument, right: MetadataSyncDocument): boolean {
  return valuesEqual(left.bookmarkMeta, right.bookmarkMeta)
    && valuesEqual(left.categoryMeta, right.categoryMeta)
}

export function splitUtf8(value: string, maxBytes = MAX_PART_BYTES): string[] {
  const parts: string[] = []
  let part = ''
  let partBytes = 0
  for (const character of value) {
    const characterBytes = byteLength(character)
    if (part && partBytes + characterBytes > maxBytes) {
      parts.push(part)
      part = ''
      partBytes = 0
    }
    part += character
    partBytes += characterBytes
  }
  if (part)
    parts.push(part)
  return parts
}

function encodePath(path: string[]): string {
  return JSON.stringify(path)
}

function decodePath(value: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string')
      ? parsed
      : undefined
  }
  catch {
    return undefined
  }
}

export function createVersionedValue(value: unknown, updatedAt: number, deviceId: string): VersionedValue {
  return value === undefined
    ? { deleted: true, updatedAt, deviceId }
    : { value, updatedAt, deviceId }
}

function parseVersionedValue(value: unknown): VersionedValue | undefined {
  if (!isRecord(value) || typeof value.updatedAt !== 'number' || typeof value.deviceId !== 'string')
    return undefined
  return {
    value: value.value,
    deleted: value.deleted === true ? true : undefined,
    updatedAt: value.updatedAt,
    deviceId: value.deviceId,
  }
}

export function parseDocument(value: unknown): MetadataSyncDocument | undefined {
  if (!isRecord(value) || typeof value.updatedAt !== 'number'
    || typeof value.deviceId !== 'string' || !isRecord(value.bookmarkMeta)) {
    return undefined
  }

  if (value.schemaVersion === 1 && Array.isArray(value.categoryMeta)) {
    const bookmarkMeta: MetadataSyncDocument['bookmarkMeta'] = {}
    for (const [url, rawMeta] of Object.entries(value.bookmarkMeta)) {
      if (!isRecord(rawMeta))
        continue
      const fields: VersionedBookmarkMeta['fields'] = {}
      for (const field of META_FIELDS) {
        if (rawMeta[field] !== undefined)
          fields[field] = createVersionedValue(rawMeta[field], value.updatedAt, value.deviceId)
      }
      bookmarkMeta[url] = { fields }
    }
    const categoryMeta: MetadataSyncDocument['categoryMeta'] = {}
    for (const item of value.categoryMeta) {
      if (isRecord(item) && Array.isArray(item.path)
        && item.path.every(part => typeof part === 'string')
        && typeof item.emoji === 'string') {
        categoryMeta[encodePath(item.path as string[])] = createVersionedValue(
          item.emoji,
          value.updatedAt,
          value.deviceId,
        )
      }
    }
    return {
      schemaVersion: 2,
      updatedAt: value.updatedAt,
      deviceId: value.deviceId,
      bookmarkMeta,
      categoryMeta,
    }
  }

  if (value.schemaVersion !== 2 || !isRecord(value.categoryMeta))
    return undefined
  const bookmarkMeta: MetadataSyncDocument['bookmarkMeta'] = {}
  for (const [url, rawEntry] of Object.entries(value.bookmarkMeta)) {
    if (!isRecord(rawEntry) || !isRecord(rawEntry.fields))
      continue
    const fields: VersionedBookmarkMeta['fields'] = {}
    for (const field of META_FIELDS) {
      const parsed = parseVersionedValue(rawEntry.fields[field])
      if (parsed)
        fields[field] = parsed
    }
    bookmarkMeta[url] = { fields }
  }
  const categoryMeta: MetadataSyncDocument['categoryMeta'] = {}
  for (const [path, rawValue] of Object.entries(value.categoryMeta)) {
    const parsed = parseVersionedValue(rawValue)
    if (parsed && decodePath(path))
      categoryMeta[path] = parsed
  }
  return {
    schemaVersion: 2,
    updatedAt: value.updatedAt,
    deviceId: value.deviceId,
    bookmarkMeta,
    categoryMeta,
  }
}

export function materializeMetadataDocument(
  document: MetadataSyncDocument,
  scope?: Partial<MetadataSyncScope>,
): MaterializedMetadataSyncDocument {
  const fields = enabledMetaFields(scope)
  const bookmarkMeta: Record<string, BookmarkMeta> = {}
  for (const [url, entry] of Object.entries(document.bookmarkMeta)) {
    const meta: BookmarkMeta = {}
    for (const field of fields) {
      const versioned = entry.fields[field]
      if (versioned && !versioned.deleted && versioned.value !== undefined)
        Object.assign(meta, { [field]: versioned.value })
    }
    if (Object.keys(meta).length > 0)
      bookmarkMeta[url] = meta
  }
  const categoryMeta = normalizeMetadataSyncScope(scope).categoryIcons
    ? Object.entries(document.categoryMeta).flatMap(([encodedPath, versioned]) => {
        const path = decodePath(encodedPath)
        return path && !versioned.deleted && typeof versioned.value === 'string'
          ? [{ path, emoji: versioned.value }]
          : []
      })
    : []
  return { bookmarkMeta, categoryMeta }
}

export function applyMaterializedBookmarkMetadata(
  local: Record<string, BookmarkMeta>,
  synchronized: Record<string, BookmarkMeta>,
  scope?: Partial<MetadataSyncScope>,
  options?: {
    baseline?: Record<string, BookmarkMeta>
    omittedUrls?: Iterable<string>
  },
): Record<string, BookmarkMeta> {
  const fields = enabledMetaFields(scope)
  const omittedUrls = new Set(options?.omittedUrls)
  const urls = new Set([...Object.keys(local), ...Object.keys(synchronized)])
  const applied: Record<string, BookmarkMeta> = {}
  for (const url of urls) {
    const next: BookmarkMeta = { ...(local[url] ?? {}) }
    for (const field of fields) {
      if (omittedUrls.has(url))
        continue
      if (options?.baseline
        && !valuesEqual(options.baseline[url]?.[field], local[url]?.[field])) {
        continue
      }
      const synchronizedValue = synchronized[url]?.[field]
      if (synchronizedValue === undefined)
        delete next[field]
      else
        Object.assign(next, { [field]: structuredClone(synchronizedValue) })
    }
    if (Object.keys(next).length > 0)
      applied[url] = next
  }
  return applied
}

export function createDocument(input: {
  meta: Record<string, BookmarkMeta>
  categoryMeta: Record<string, CategoryMeta>
  categories: Category[]
  updatedAt: number
  deviceId: string
  scope?: Partial<MetadataSyncScope>
}): MetadataSyncDocument {
  const fieldsToSync = enabledMetaFields(input.scope)
  const bookmarkMeta: MetadataSyncDocument['bookmarkMeta'] = {}
  for (const [url, meta] of Object.entries(input.meta)) {
    const fields: VersionedBookmarkMeta['fields'] = {}
    for (const field of fieldsToSync) {
      if (meta[field] !== undefined)
        fields[field] = createVersionedValue(meta[field], input.updatedAt, input.deviceId)
    }
    bookmarkMeta[url] = { fields }
  }
  const categoryMeta: MetadataSyncDocument['categoryMeta'] = {}
  if (normalizeMetadataSyncScope(input.scope).categoryIcons) {
    for (const [categoryId, meta] of Object.entries(input.categoryMeta)) {
      const path = getCategoryPath(categoryId, input.categories)
      if (path && meta.emoji) {
        categoryMeta[encodePath(path)] = createVersionedValue(
          meta.emoji,
          input.updatedAt,
          input.deviceId,
        )
      }
    }
  }
  return {
    schemaVersion: 2,
    updatedAt: input.updatedAt,
    deviceId: input.deviceId,
    bookmarkMeta,
    categoryMeta,
  }
}

export function fitDocumentToBudget(document: MetadataSyncDocument): MetadataSyncPayload {
  const materialized = materializeMetadataDocument(document).bookmarkMeta
  const entries = Object.entries(document.bookmarkMeta).sort(([leftUrl, left], [rightUrl, right]) => {
    const priority = (url: string, entry: VersionedBookmarkMeta) => {
      const allDeleted = Object.values(entry.fields).every(value => value?.deleted)
      const meta = materialized[url]
      return (allDeleted ? 10 : 0) + (meta?.pinnedAt ? 2 : 0)
        + (meta?.inboxAt ? 2 : 0) + (meta?.tags?.length ? 1 : 0)
    }
    return priority(rightUrl, right) - priority(leftUrl, left)
  })
  const fitted: MetadataSyncDocument = { ...document, bookmarkMeta: {} }
  let currentBytes = byteLength(JSON.stringify(fitted))
  let omittedBookmarkCount = 0
  const omittedBookmarkUrls: string[] = []
  const includedUrls: string[] = []
  for (const [url, entry] of entries) {
    const entryBytes = byteLength(JSON.stringify(url))
      + byteLength(JSON.stringify(entry)) + 2
    if (currentBytes + entryBytes > MAX_SYNC_BYTES) {
      omittedBookmarkCount += 1
      omittedBookmarkUrls.push(url)
      continue
    }
    fitted.bookmarkMeta[url] = entry
    includedUrls.push(url)
    currentBytes += entryBytes
  }
  let serialized = JSON.stringify(fitted)
  while (byteLength(serialized) > MAX_SYNC_BYTES && includedUrls.length > 0) {
    const url = includedUrls.pop()
    if (url)
      delete fitted.bookmarkMeta[url]
    if (url)
      omittedBookmarkUrls.push(url)
    omittedBookmarkCount += 1
    serialized = JSON.stringify(fitted)
  }
  return {
    document: fitted,
    omittedBookmarkCount,
    omittedBookmarkUrls,
    byteCount: byteLength(serialized),
  }
}

export function createMetadataSyncPayload(input: {
  meta: Record<string, BookmarkMeta>
  categoryMeta: Record<string, CategoryMeta>
  categories: Category[]
  updatedAt: number
  deviceId: string
  scope?: Partial<MetadataSyncScope>
}): MetadataSyncPayload {
  return fitDocumentToBudget(createDocument(input))
}
