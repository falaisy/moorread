import type { Category } from './types'

export function getCategoryPath(
  categoryId: string,
  categories: Category[],
): string[] | undefined {
  const byId = new Map(categories.map(category => [category.id, category]))
  const path: string[] = []
  const visited = new Set<string>()
  let current = byId.get(categoryId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.name)
    current = byId.get(current.parentId)
  }

  return path.length > 0 ? path : undefined
}

export function buildCategoryPathMap(
  categories: Category[],
): Map<string, string[]> {
  const categoriesById = new Map(
    categories.map(category => [category.id, category]),
  )
  const paths = new Map<string, string[]>()

  for (const category of categories) {
    if (paths.has(category.id))
      continue
    const chain: Category[] = []
    const visited = new Set<string>()
    let current: Category | undefined = category
    while (current && !paths.has(current.id) && !visited.has(current.id)) {
      visited.add(current.id)
      chain.push(current)
      current = categoriesById.get(current.parentId)
    }

    let path = current ? [...(paths.get(current.id) ?? [])] : []
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const item = chain[index]
      path = [...path, item.name]
      paths.set(item.id, path)
    }
  }
  return paths
}

export function findCategoryByPath(
  path: string[] | undefined,
  categories: Category[],
): Category | undefined {
  if (!path?.length)
    return undefined
  let parentId = 'all'
  let match: Category | undefined
  for (const name of path) {
    match = categories.find(
      category => category.parentId === parentId && category.name === name,
    )
    if (!match)
      return undefined
    parentId = match.id
  }
  return match
}

export interface CategorySavePreview {
  /** 實際會寫入的完整資料夾路徑。 */
  path: string[]
  /** true 表示沿用既有同名資料夾；false 表示會建立新資料夾。 */
  existing: boolean
}

/**
 * 書籤編輯器只輸入資料夾名稱時，預覽實際儲存位置。
 * 解析規則與 addCategory 一致：同名沿用既有資料夾，新名稱建在指定父層。
 */
export function resolveCategorySavePreview(
  categoryName: string,
  categories: Category[],
  newCategoryParentId: string,
): CategorySavePreview | undefined {
  const trimmed = categoryName.trim()
  if (!trimmed)
    return undefined
  const existing = categories.find(category => category.name === trimmed)
  if (existing) {
    return {
      path: getCategoryPath(existing.id, categories) ?? [existing.name],
      existing: true,
    }
  }
  const parentPath = getCategoryPath(newCategoryParentId, categories) ?? []
  return { path: [...parentPath, trimmed], existing: false }
}
