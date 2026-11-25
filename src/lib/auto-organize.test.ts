import type { AutoOrganizePatch } from './auto-organize'
import type { AutoOrganizeRule, Bookmark, Category } from './types'
import { describe, expect, it } from 'vitest'
import {
  AUTO_ORGANIZE_FIELDS,
  AUTO_ORGANIZE_OPERATORS,
  autoOrganizeRuleMatches,
  createAutoOrganizePatch,
  normalizeAutoOrganizeRules,
  previewAutoOrganizeRules,
  readAutoOrganizeSettings,
} from './auto-organize'

const categories: Category[] = [
  { id: 'cat-work', name: 'Work', emoji: '💼', parentId: 'all', modifiable: true },
  { id: 'cat-personal', name: 'Personal', emoji: '🏠', parentId: 'all', modifiable: true },
]

const baseBookmark: Bookmark = {
  id: 'b1',
  name: 'Example Bookmark',
  url: 'https://docs.example.com/guide',
  categoryId: 'all',
  tags: ['old'],
  inboxAt: 1000,
}

// --- normalizeAutoOrganizeRules ---

describe('auto-organize — normalizeAutoOrganizeRules', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeAutoOrganizeRules(null as unknown)).toEqual([])
    expect(normalizeAutoOrganizeRules(undefined)).toEqual([])
    expect(normalizeAutoOrganizeRules('not array')).toEqual([])
    expect(normalizeAutoOrganizeRules(42 as unknown)).toEqual([])
  })

  it('filters null, primitives, and non-object entries', () => {
    expect(normalizeAutoOrganizeRules([null, 42, 'str', undefined, { field: 'url', operator: 'contains', value: 'x' }]))
      .toHaveLength(1)
  })

  it('filters rules with empty/whitespace-only value after trim', () => {
    expect(normalizeAutoOrganizeRules([
      { value: '' },
      { value: '   ' },
      { value: 'valid' },
    ])).toHaveLength(1)
  })

  it('defaults unknown field/operator to url/contains', () => {
    const result = normalizeAutoOrganizeRules([
      { field: 'unknown-field', operator: 'unknown-op', value: 'test' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].field).toBe('url')
    expect(result[0].operator).toBe('contains')
  })

  it('preserves known fields and operators', () => {
    AUTO_ORGANIZE_FIELDS.forEach((field) => {
      AUTO_ORGANIZE_OPERATORS.forEach((operator) => {
        const result = normalizeAutoOrganizeRules([
          { field, operator, value: 'test' },
        ])
        expect(result[0]).toMatchObject({ field, operator })
      })
    })
  })

  it('defaults enabled to true', () => {
    const result = normalizeAutoOrganizeRules([{ value: 'x' }])
    expect(result[0].enabled).toBe(true)

    const disabled = normalizeAutoOrganizeRules([{ value: 'x', enabled: false }])
    expect(disabled[0].enabled).toBe(false)
  })

  it('generates id when missing, trims name', () => {
    const result = normalizeAutoOrganizeRules([
      { value: 'example.com', name: '  My Rule  ' },
      { value: 'example.com' },
    ])
    expect(result[0].name).toBe('My Rule')
    expect(result[0].id).toBeTruthy()
    expect(result[1].id).toBeTruthy()
    expect(result[1].id).not.toBe(result[0].id)
    expect(result[1].name).toBe('example.com') // falls back to value
  })

  it('parses and de-duplicates addTags (trim, flatMap, max 12)', () => {
    // Note: product coerces null/undefined via `${tag}` → 'null'/'undefined'
    const result = normalizeAutoOrganizeRules([{
      value: 'x',
      addTags: ['dup', 'dup', '  A  ', '', null, undefined, ['nested', 'nested']],
    }])
    // null/undefined become literal strings via template coercion, empty string filtered
    expect(result[0].addTags).toEqual(['dup', 'A', 'null', 'undefined', 'nested'])

    const tooMany = Array.from({ length: 20 }, (_, i) => `tag-${i}`)
    const limited = normalizeAutoOrganizeRules([{ value: 'x', addTags: tooMany }])
    expect(limited[0].addTags).toHaveLength(12)
  })

  it('caps total rules at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ value: `test${i}` }))
    expect(normalizeAutoOrganizeRules(many)).toHaveLength(50)
  })

  it('trims targetCategoryId and parses clearInbox', () => {
    const result = normalizeAutoOrganizeRules([{
      value: 'x',
      targetCategoryId: '  cat-work  ',
      clearInbox: true,
    }])
    expect(result[0].targetCategoryId).toBe('cat-work')
    expect(result[0].clearInbox).toBe(true)
  })
})

// --- autoOrganizeRuleMatches ---

describe('auto-organize — autoOrganizeRuleMatches', () => {
  const bookmark: Bookmark = {
    id: 'b1',
    name: 'GitHub Documentation',
    url: 'https://docs.github.com/en/actions',
    description: 'Official docs for GitHub Actions',
    tags: ['dev', 'docs'],
    categoryId: 'all',
  }

  it('returns false when rule is disabled', () => {
    const rule: AutoOrganizeRule = {
      id: 'r1',
      name: 'X',
      enabled: false,
      field: 'url',
      operator: 'contains',
      value: 'github',
      addTags: [],
      clearInbox: false,
    }
    expect(autoOrganizeRuleMatches(bookmark, rule)).toBe(false)
  })

  it('matches equals (case-insensitive, trim)', () => {
    const rule: AutoOrganizeRule = {
      id: 'r1',
      name: 'X',
      enabled: true,
      field: 'name',
      operator: 'equals',
      value: '  github documentation  ',
      addTags: [],
      clearInbox: false,
    }
    expect(autoOrganizeRuleMatches(bookmark, rule)).toBe(true)
  })

  it('matches contains across all field types', () => {
    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'name',
      operator: 'contains',
      value: 'github',
      addTags: [],
      clearInbox: false,
    })).toBe(true)

    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'domain',
      operator: 'contains',
      value: 'github.com',
      addTags: [],
      clearInbox: false,
    })).toBe(true)

    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'description',
      operator: 'contains',
      value: 'official',
      addTags: [],
      clearInbox: false,
    })).toBe(true)

    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'tag',
      operator: 'contains',
      value: 'docs',
      addTags: [],
      clearInbox: false,
    })).toBe(true)
  })

  it('matches startsWith on domain', () => {
    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'domain',
      operator: 'startsWith',
      value: 'docs',
      addTags: [],
      clearInbox: false,
    })).toBe(true)

    expect(autoOrganizeRuleMatches(bookmark, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'domain',
      operator: 'startsWith',
      value: 'www',
      addTags: [],
      clearInbox: false,
    })).toBe(false)
  })

  it('returns false for non-matching empty source/expected', () => {
    const bm = { ...bookmark, name: '' }
    expect(autoOrganizeRuleMatches(bm, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'name',
      operator: 'contains',
      value: 'x',
      addTags: [],
      clearInbox: false,
    })).toBe(false)
  })

  it('handles invalid URL gracefully (domain returns empty string)', () => {
    const bm = { ...bookmark, url: 'not-a-valid-url' }
    expect(autoOrganizeRuleMatches(bm, {
      id: 'r',
      name: '',
      enabled: true,
      field: 'domain',
      operator: 'contains',
      value: 'anything',
      addTags: [],
      clearInbox: false,
    })).toBe(false)
  })
})

// --- createAutoOrganizePatch ---

describe('auto-organize — createAutoOrganizePatch', () => {
  const bookmark: Bookmark = { ...baseBookmark }

  const rule: AutoOrganizeRule = {
    id: 'r1',
    name: 'Move to Work',
    enabled: true,
    field: 'domain',
    operator: 'contains',
    value: 'example.com',
    targetCategoryId: 'cat-work',
    addTags: ['docs', 'important'],
    clearInbox: true,
  }

  it('produces full patch when all effects apply', () => {
    expect(createAutoOrganizePatch(bookmark, rule, categories))
      .toEqual({
        categoryId: 'cat-work',
        tags: ['old', 'docs', 'important'],
        inboxAt: 0,
      })
  })

  it('does not set categoryId when targetCategoryId not in categories list', () => {
    const invalidRule = { ...rule, targetCategoryId: 'nonexistent' }
    expect(createAutoOrganizePatch(bookmark, invalidRule, categories))
      .toEqual({
        tags: ['old', 'docs', 'important'],
        inboxAt: 0,
      })
  })

  it('does not set tags when addTags already all present', () => {
    const existingTags = { ...bookmark, tags: ['old', 'docs', 'important'] }
    expect(createAutoOrganizePatch(existingTags, rule, categories))
      .toEqual({ categoryId: 'cat-work', inboxAt: 0 })
  })

  it('de-duplicates tags across bookmark + rule', () => {
    // Product does NOT lowercase tags; 'old' and 'Old' are distinct strings
    const dupRule = { ...rule, addTags: ['docs', 'docs', 'fresh'] }
    const result = createAutoOrganizePatch(bookmark, dupRule, categories)
    // 'docs' already in bookmark.tags? No — bookmark tags are ['old'], rule adds ['docs','docs','fresh']
    expect(result.tags).toEqual(['old', 'docs', 'fresh'])
  })

  it('does not set inboxAt when clearInbox=true but bookmark has no inboxAt', () => {
    const noInbox = { ...bookmark, inboxAt: undefined }
    expect(createAutoOrganizePatch(noInbox, rule, categories))
      .not
      .toHaveProperty('inboxAt')
  })

  it('returns empty patch when no effects apply', () => {
    const noEffects: AutoOrganizeRule = {
      id: 'r',
      name: '',
      enabled: true,
      field: 'url',
      operator: 'contains',
      value: 'x',
      addTags: [],
      clearInbox: false,
    }
    expect(createAutoOrganizePatch(bookmark, noEffects, categories))
      .toEqual({})
  })
})

// --- previewAutoOrganizeRules ---

describe('auto-organize — previewAutoOrganizeRules (integration)', () => {
  it('applies multiple rules cumulatively on one bookmark', () => {
    const bookmark: Bookmark = {
      id: 'b1',
      name: 'GitHub Actions Guide',
      url: 'https://docs.github.com/actions',
      categoryId: 'all',
      tags: [],
      inboxAt: 500,
    }
    const rules = [
      {
        id: 'r1',
        name: 'GitHub',
        enabled: true,
        field: 'domain' as const,
        operator: 'contains' as const,
        value: 'github.com',
        targetCategoryId: 'cat-work',
        addTags: ['dev'],
        clearInbox: false,
      },
      {
        id: 'r2',
        name: 'Clear inbox',
        enabled: true,
        field: 'url' as const,
        operator: 'contains' as const,
        value: 'docs.github',
        addTags: ['docs'],
        clearInbox: true,
      },
    ]
    const result = previewAutoOrganizeRules([bookmark], rules, categories)
    expect(result).toHaveLength(1)
    expect(result[0].patch).toEqual({
      categoryId: 'cat-work', // from r1
      tags: ['dev', 'docs'], // from both
      inboxAt: 0, // from r2 (applied because r1 first sets categoryId via patch chain)
    })
  })

  it('skips bookmarks with empty patch (no-op)', () => {
    const bookmark: Bookmark = {
      id: 'b',
      name: 'Already there',
      url: 'https://example.com',
      categoryId: 'cat-work',
      tags: ['docs'],
    }
    const rules = [{
      id: 'r1',
      name: 'X',
      enabled: true,
      field: 'domain' as const,
      operator: 'contains' as const,
      value: 'example.com',
      targetCategoryId: 'cat-work',
      addTags: ['docs'],
      clearInbox: false,
    }]
    expect(previewAutoOrganizeRules([bookmark], rules, categories)).toEqual([])
  })
})

// --- readAutoOrganizeSettings ---

describe('auto-organize — readAutoOrganizeSettings', () => {
  // 正式儲存格式：@plasmohq/storage 以 JSON.stringify 寫入 chrome.storage
  const serialized = JSON.stringify({
    autoOrganizeOnSave: true,
    autoOrganizeRules: [{
      id: 'on-save-rule',
      enabled: true,
      name: 'example → Work',
      field: 'domain',
      operator: 'contains',
      value: 'example.com',
      targetCategoryId: 'cat-work',
      addTags: ['auto'],
      clearInbox: true,
    }],
  })

  const savedBookmark: Bookmark = {
    id: 'b-saved',
    name: 'Saved Page',
    url: 'https://docs.example.com/guide',
    categoryId: 'all',
    tags: ['old'],
    inboxAt: 1000,
  }

  function autoOrganizePatchFor(raw: unknown, bookmark: Bookmark): AutoOrganizePatch {
    const { enabled, rules } = readAutoOrganizeSettings(raw)
    if (!enabled)
      return {}
    return rules.reduce<AutoOrganizePatch>((patch, rule) => {
      if (!autoOrganizeRuleMatches({ ...bookmark, ...patch }, rule))
        return patch
      return Object.assign(patch, createAutoOrganizePatch({ ...bookmark, ...patch }, rule, categories))
    }, {})
  }

  it('parses rules out of the production JSON string', () => {
    const { enabled, rules } = readAutoOrganizeSettings(serialized)
    expect(enabled).toBe(true)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'on-save-rule',
      field: 'domain',
      operator: 'contains',
      value: 'example.com',
      targetCategoryId: 'cat-work',
      addTags: ['auto'],
      clearInbox: true,
    })
  })

  it('still accepts legacy plain-object values stored without serialization', () => {
    const { rules } = readAutoOrganizeSettings(JSON.parse(serialized))
    expect(rules).toHaveLength(1)
    expect(rules[0].targetCategoryId).toBe('cat-work')
  })

  it('defaults to enabled with no rules when the key is missing', () => {
    expect(readAutoOrganizeSettings(undefined)).toEqual({ enabled: true, rules: [] })
    expect(readAutoOrganizeSettings(null)).toEqual({ enabled: true, rules: [] })
  })

  it('falls back safely on malformed JSON instead of throwing', () => {
    expect(readAutoOrganizeSettings('{"autoOrganizeOnSave":false,')).toEqual({
      enabled: true,
      rules: [],
    })
  })

  it('treats non-object payloads as empty settings', () => {
    expect(readAutoOrganizeSettings(42)).toEqual({ enabled: true, rules: [] })
    expect(readAutoOrganizeSettings('null')).toEqual({ enabled: true, rules: [] })
    expect(readAutoOrganizeSettings('"text"')).toEqual({ enabled: true, rules: [] })
  })

  it('reports the toggle as disabled when autoOrganizeOnSave is false', () => {
    const { enabled, rules } = readAutoOrganizeSettings(JSON.stringify({
      autoOrganizeOnSave: false,
      autoOrganizeRules: [{ enabled: true, value: 'example.com', targetCategoryId: 'cat-work' }],
    }))
    expect(enabled).toBe(false)
    expect(rules).toHaveLength(1)
  })

  it('drops rules that are disabled', () => {
    const { rules } = readAutoOrganizeSettings(JSON.stringify({
      autoOrganizeRules: [
        { enabled: false, value: 'example.com', targetCategoryId: 'cat-work' },
        { enabled: true, value: 'example.com', targetCategoryId: 'cat-personal' },
      ],
    }))
    expect(rules.map(rule => rule.targetCategoryId)).toEqual(['cat-personal'])
  })

  it('produces the move/tag patch for a saved bookmark when enabled with a valid rule', () => {
    expect(autoOrganizePatchFor(serialized, savedBookmark)).toEqual({
      categoryId: 'cat-work',
      tags: ['old', 'auto'],
      inboxAt: 0,
    })
  })

  it('produces no patch when auto-organize is switched off', () => {
    const switchedOff = JSON.stringify({
      autoOrganizeOnSave: false,
      autoOrganizeRules: JSON.parse(serialized).autoOrganizeRules,
    })
    expect(autoOrganizePatchFor(switchedOff, savedBookmark)).toEqual({})
  })

  it('regression: reading the serialized value as an object loses every rule (pre-fix behaviour)', () => {
    const legacyRead = (serialized as unknown as { autoOrganizeRules?: unknown }).autoOrganizeRules
    expect(legacyRead).toBeUndefined()
    expect(normalizeAutoOrganizeRules(legacyRead)).toEqual([])
  })
})
