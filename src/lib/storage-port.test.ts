import { describe, expect, it } from 'vitest'
import { parseStoredJson, parseStoredRecord } from './storage-port'

describe('storage-port — parseStoredJson', () => {
  it('parses the JSON string written by @plasmohq/storage', () => {
    expect(parseStoredJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns undefined when there is no value', () => {
    expect(parseStoredJson(undefined)).toBeUndefined()
    expect(parseStoredJson(null)).toBeUndefined()
  })

  it('passes through legacy non-string values unchanged', () => {
    const legacy = { a: 1 }
    expect(parseStoredJson<{ a: number }>(legacy)).toBe(legacy)
  })

  it('returns undefined instead of throwing on malformed JSON', () => {
    expect(parseStoredJson('{"a":1')).toBeUndefined()
    expect(parseStoredJson('')).toBeUndefined()
  })
})

describe('storage-port — parseStoredRecord（meta 損壞保護）', () => {
  it('parses a valid serialized record', () => {
    expect(parseStoredRecord<{ tags: string[] }>('{"https://a.test/":{"tags":["x"]}}'))
      .toEqual({ 'https://a.test/': { tags: ['x'] } })
  })

  it('treats a missing value as "no data" (safe to initialise)', () => {
    expect(parseStoredRecord(undefined)).toBeUndefined()
    expect(parseStoredRecord(null)).toBeUndefined()
  })

  it('treats malformed JSON as damaged', () => {
    expect(parseStoredRecord('{"https://a.test/":')).toBeUndefined()
  })

  it('treats valid JSON of the wrong shape as damaged', () => {
    expect(parseStoredRecord('[]')).toBeUndefined()
    expect(parseStoredRecord('[{"tags":["x"]}]')).toBeUndefined()
    expect(parseStoredRecord('"text"')).toBeUndefined()
    expect(parseStoredRecord('5')).toBeUndefined()
    expect(parseStoredRecord('null')).toBeUndefined()
  })

  it('accepts legacy plain-object records', () => {
    expect(parseStoredRecord<{ tags: string[] }>({ a: { tags: ['x'] } }))
      .toEqual({ a: { tags: ['x'] } })
  })

  it('rejects legacy arrays', () => {
    expect(parseStoredRecord([{ tags: ['x'] }])).toBeUndefined()
  })
})
