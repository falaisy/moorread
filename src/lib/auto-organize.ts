import type {
  AutoOrganizeField,
  AutoOrganizeOperator,
  AutoOrganizeRule,
  Bookmark,
  Category,
  Settings,
} from './types'
import { parseStoredJson } from './storage-port'

export const AUTO_ORGANIZE_FIELDS: AutoOrganizeField[] = [
  'name',
  'url',
  'domain',
  'description',
  'tag',
]

export const AUTO_ORGANIZE_OPERATORS: AutoOrganizeOperator[] = [
  'contains',
  'equals',
  'startsWith',
]

export interface AutoOrganizePatch {
  categoryId?: string
  tags?: string[]
  inboxAt?: number
}

export interface AutoOrganizePreviewItem {
  bookmark: Bookmark
  rule: AutoOrganizeRule
  patch: AutoOrganizePatch
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value))
    return []
  const collected: string[] = []
  const walk = (items: unknown[]) => {
    for (const item of items) {
      if (Array.isArray(item)) {
        walk(item)
      }
      else {
        const normalized = `${item}`.trim()
        if (normalized)
          collected.push(normalized)
      }
    }
  }
  walk(value)
  return [...new Set(collected)].slice(0, 12)
}

export function normalizeAutoOrganizeRules(value: unknown): AutoOrganizeRule[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null)
      return []
    const item = candidate as Partial<AutoOrganizeRule>
    const field = AUTO_ORGANIZE_FIELDS.includes(item.field as AutoOrganizeField)
      ? item.field as AutoOrganizeField
      : 'url'
    const operator = AUTO_ORGANIZE_OPERATORS.includes(item.operator as AutoOrganizeOperator)
      ? item.operator as AutoOrganizeOperator
      : 'contains'
    const value = item.value?.trim()
    if (!value)
      return []
    return [{
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: item.name?.trim() || value,
      enabled: item.enabled !== false,
      field,
      operator,
      value,
      targetCategoryId: item.targetCategoryId?.trim() || undefined,
      addTags: parseTags(item.addTags),
      clearInbox: item.clearInbox === true,
    }]
  }).slice(0, 50)
}

export interface StoredAutoOrganizeSettings {
  enabled: boolean
  rules: AutoOrganizeRule[]
}

/**
 * 讀取「儲存書籤時自動整理」設定。
 * 正式資料由 @plasmohq/storage 以 JSON 字串寫入，直接讀 chrome.storage 會拿到字串；
 * 空值或格式錯誤時回傳安全預設，且不寫回任何資料（避免覆蓋使用者設定）。
 */
export function readAutoOrganizeSettings(raw: unknown): StoredAutoOrganizeSettings {
  const stored = parseStoredJson<Partial<Settings>>(raw)
  if (!stored || typeof stored !== 'object')
    return { enabled: true, rules: [] }
  return {
    enabled: stored.autoOrganizeOnSave !== false,
    rules: normalizeAutoOrganizeRules(stored.autoOrganizeRules)
      .filter(rule => rule.enabled),
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  }
  catch {
    return ''
  }
}

function valuesForField(bookmark: Bookmark, field: AutoOrganizeField): string[] {
  switch (field) {
    case 'name':
      return [bookmark.name]
    case 'url':
      return [bookmark.url]
    case 'domain':
      return [getDomain(bookmark.url)]
    case 'description':
      return [bookmark.description ?? '']
    case 'tag':
      return bookmark.tags ?? []
    default:
      return []
  }
}

function matchesValue(source: string, operator: AutoOrganizeOperator, expected: string): boolean {
  const normalizedSource = source.trim().toLowerCase()
  const normalizedExpected = expected.trim().toLowerCase()
  if (!normalizedSource || !normalizedExpected)
    return false
  if (operator === 'equals')
    return normalizedSource === normalizedExpected
  if (operator === 'startsWith')
    return normalizedSource.startsWith(normalizedExpected)
  return normalizedSource.includes(normalizedExpected)
}

export function autoOrganizeRuleMatches(bookmark: Bookmark, rule: AutoOrganizeRule): boolean {
  if (!rule.enabled)
    return false
  return valuesForField(bookmark, rule.field)
    .some(value => matchesValue(value, rule.operator, rule.value))
}

export function createAutoOrganizePatch(
  bookmark: Bookmark,
  rule: AutoOrganizeRule,
  categories: Category[],
): AutoOrganizePatch {
  const patch: AutoOrganizePatch = {}
  if (
    rule.targetCategoryId
    && categories.some(category => category.id === rule.targetCategoryId)
    && bookmark.categoryId !== rule.targetCategoryId
  ) {
    patch.categoryId = rule.targetCategoryId
  }
  if (rule.addTags.length > 0) {
    const tags = [...new Set([...(bookmark.tags ?? []), ...rule.addTags])]
    if (tags.join('\n') !== (bookmark.tags ?? []).join('\n'))
      patch.tags = tags
  }
  if (rule.clearInbox && bookmark.inboxAt)
    patch.inboxAt = 0
  return patch
}

export function previewAutoOrganizeRules(
  bookmarks: Bookmark[],
  rules: AutoOrganizeRule[],
  categories: Category[],
): AutoOrganizePreviewItem[] {
  const normalizedRules = normalizeAutoOrganizeRules(rules).filter(rule => rule.enabled)
  return bookmarks.flatMap((bookmark) => {
    const patch: AutoOrganizePatch = {}
    let matchedRule: AutoOrganizeRule | undefined
    for (const rule of normalizedRules) {
      if (!autoOrganizeRuleMatches(bookmark, rule))
        continue
      matchedRule ??= rule
      Object.assign(patch, createAutoOrganizePatch(
        { ...bookmark, ...patch },
        rule,
        categories,
      ))
    }
    return matchedRule && Object.keys(patch).length > 0
      ? [{ bookmark, rule: matchedRule, patch }]
      : []
  })
}
