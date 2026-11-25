import type { MetadataSyncDocument } from './metadata-sync-document'
import { describe, expect, it } from 'vitest'
import { mergeMetadataDocuments, withLocalDiff } from './metadata-sync-diff'
import {
  materializeMetadataDocument,
  parseDocument,
} from './metadata-sync-document'

const url = 'https://example.test/page'

function v2Document(
  deviceId: string,
  updatedAt: number,
  fields: MetadataSyncDocument['bookmarkMeta'][string]['fields'],
): MetadataSyncDocument {
  return {
    schemaVersion: 2,
    updatedAt,
    deviceId,
    bookmarkMeta: { [url]: { fields } },
    categoryMeta: {},
  }
}

/** 種子必須先通過 `parseDocument`，否則測試可能在錯誤的資料形狀上假綠。 */
function seeded(document: MetadataSyncDocument): MetadataSyncDocument {
  const parsed = parseDocument(JSON.parse(JSON.stringify(document)))
  if (!parsed)
    throw new Error('test seed is not a valid v2 metadata document')
  return parsed
}

describe('inboxAt 同步：清除後不得被舊值復活', () => {
  it('j-a 有本地影子文件時，清除會產生較新的墓碑並勝過遠端舊值', () => {
    const shadow = seeded(v2Document('device-a', 1000, {
      inboxAt: { value: 1000, updatedAt: 1000, deviceId: 'device-a' },
    }))
    const current = seeded(v2Document('device-local', 2000, {}))
    const remote = seeded(v2Document('device-remote', 1500, {
      inboxAt: { value: 1000, updatedAt: 1500, deviceId: 'device-remote' },
    }))

    const localDiff = withLocalDiff(shadow, current)
    expect(localDiff.bookmarkMeta[url].fields.inboxAt).toEqual({
      deleted: true,
      updatedAt: 2000,
      deviceId: 'device-local',
    })

    const merged = mergeMetadataDocuments(localDiff, remote)
    expect(merged.bookmarkMeta[url].fields.inboxAt).toEqual({
      deleted: true,
      updatedAt: 2000,
      deviceId: 'device-local',
    })

    const materialized = materializeMetadataDocument(merged)
    expect(materialized.bookmarkMeta[url]).toBeUndefined()
  })

  it('j-b 負向控制：沒有本地影子文件時不會產生墓碑，舊遠端值會復活（R1 風險，必須靠影子文件避免）', () => {
    const current = seeded(v2Document('device-local', 2000, {}))
    const remote = seeded(v2Document('device-remote', 1500, {
      inboxAt: { value: 1000, updatedAt: 1500, deviceId: 'device-remote' },
    }))

    const localDiff = withLocalDiff(undefined, current)
    expect(localDiff.bookmarkMeta[url].fields.inboxAt).toBeUndefined()

    const merged = mergeMetadataDocuments(localDiff, remote)
    const materialized = materializeMetadataDocument(merged)
    expect(materialized.bookmarkMeta[url]).toEqual({ inboxAt: 1000 })
  })

  it('j-c 負向控制：遠端時鐘較快時，遠端值仍會勝過本地墓碑（R2 風險，屬既有時鐘約定）', () => {
    const shadow = seeded(v2Document('device-a', 1000, {
      inboxAt: { value: 1000, updatedAt: 1000, deviceId: 'device-a' },
    }))
    const current = seeded(v2Document('device-local', 3000, {}))
    const remote = seeded(v2Document('device-remote', 5000, {
      inboxAt: { value: 1000, updatedAt: 5000, deviceId: 'device-remote' },
    }))

    const merged = mergeMetadataDocuments(withLocalDiff(shadow, current), remote)
    expect(materializeMetadataDocument(merged).bookmarkMeta[url]).toEqual({ inboxAt: 1000 })
  })
})

describe('j2 種子形狀防偽', () => {
  it('只有 bookmarks 的舊式種子不是合法 v2 文件', () => {
    expect(parseDocument({ bookmarks: { [url]: { inboxAt: 1 } } })).toBeUndefined()
    expect(parseDocument({ schemaVersion: 2, updatedAt: 1, deviceId: 'd' })).toBeUndefined()
  })

  it('完整 v2 文件可解析並保留 inboxAt 版本資訊', () => {
    const parsed = parseDocument({
      schemaVersion: 2,
      updatedAt: 1500,
      deviceId: 'device-remote',
      bookmarkMeta: {
        [url]: { fields: { inboxAt: { value: 1000, updatedAt: 1500, deviceId: 'device-remote' } } },
      },
      categoryMeta: {},
    })
    expect(parsed).toBeDefined()
    expect(parsed?.bookmarkMeta[url].fields.inboxAt).toEqual({
      value: 1000,
      updatedAt: 1500,
      deviceId: 'device-remote',
    })
  })
})
