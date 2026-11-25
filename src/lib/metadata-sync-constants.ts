import type { BookmarkMeta, MetadataSyncScope } from './types'

export const SYNC_MANIFEST_KEY = 'moorread:metadata-sync:manifest'
export const SYNC_PART_PREFIX = 'moorread:metadata-sync:part:'
export const LOCAL_DOCUMENT_KEY = 'moorread:metadata-sync:local-document'
export const DEVICE_ID_KEY = 'moorread:metadata-sync:device-id'
export const MAX_PART_BYTES = 6_500
export const MAX_SYNC_BYTES = 90_000
export const MAX_ATTEMPTS = 3
export const META_FIELDS = [
  'description',
  'icon',
  'alternateUrls',
  'pinnedAt',
  'pinnedOrder',
  'tags',
  'inboxAt',
] as const satisfies ReadonlyArray<keyof BookmarkMeta>

export type MetaField = typeof META_FIELDS[number]

export const DEFAULT_METADATA_SYNC_SCOPE: MetadataSyncScope = {
  description: true,
  icon: true,
  alternateUrls: true,
  pinnedAt: true,
  tags: true,
  inboxAt: true,
  categoryIcons: true,
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(normalize)
    if (!isRecord(value))
      return value
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalize(value[key])]),
    )
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

export function isMetadataSyncWriteQuotaError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /MAX_(?:SUSTAINED_)?WRITE_OPERATIONS|write operations.{0,40}quota|quota.{0,40}write operations/i.test(message)
}

export function normalizeMetadataSyncScope(scope?: Partial<MetadataSyncScope>): MetadataSyncScope {
  return {
    ...DEFAULT_METADATA_SYNC_SCOPE,
    ...scope,
  }
}

export function enabledMetaFields(scope?: Partial<MetadataSyncScope>): MetaField[] {
  const normalized = normalizeMetadataSyncScope(scope)
  return META_FIELDS.filter(field => normalized[field === 'pinnedOrder' ? 'pinnedAt' : field])
}
