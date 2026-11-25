import type { CategoryTreeNode } from '~/lib/category-tree'
import type { Category } from '~/lib/types'
import { ChevronDown } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { buildCategoryTree } from '~/lib/category-tree'
import {
  ALL_CATEGORY,
  categoryOptionLabel,
  VIRTUAL_CATEGORIES,
} from '~/lib/default-data'
import { useCategories } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface CategoryRow {
  id: string
  label: string
  depth: number
}

function flattenTree(nodes: CategoryTreeNode[], depth = 0): CategoryRow[] {
  return nodes.flatMap(node => [
    {
      id: node.category.id,
      label: categoryOptionLabel(node.category.emoji, node.category.name),
      depth,
    },
    ...flattenTree(node.children, depth + 1),
  ])
}

interface CategoryTreePickerProps {
  value: string
  onChange: (id: string) => void
  /** 只允許實體資料夾（批次移動、收件匣整理不可選虛擬分類）。 */
  includeVirtual?: boolean
  /** 預設讀取 store；批次操作可傳入同一份已排序清單。 */
  categories?: Category[]
  id?: string
  ariaLabelledBy?: string
  ariaLabel?: string
  placeholder?: string
  triggerClassName?: string
  disabled?: boolean
}

/** 文件夹选择器：用缩进的树状下拉替代扁平 select，选中行高亮背景。 */
export function CategoryTreePicker({
  value,
  onChange,
  includeVirtual = true,
  categories: categoriesProp,
  id,
  ariaLabelledBy,
  ariaLabel,
  placeholder,
  triggerClassName,
  disabled = false,
}: CategoryTreePickerProps) {
  const { t, categoryName } = useI18n()
  const storeCategories = useCategories()
  const categories = categoriesProp ?? storeCategories
  const virtualRows: CategoryRow[] = includeVirtual
    ? VIRTUAL_CATEGORIES.map(category => ({
        id: category.id,
        label: categoryName(category),
        depth: 0,
      }))
    : []
  const treeRows = flattenTree(buildCategoryTree(categories))
  const allRows = [...virtualRows, ...treeRows]
  const selected
    = allRows.find(row => row.id === value)
      ?? (includeVirtual
        ? virtualRows.find(row => row.id === ALL_CATEGORY.id)
        : undefined)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          id={id}
          disabled={disabled}
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabelledBy ? undefined : ariaLabel}
          className={cn(
            'h-10 w-full justify-between gap-2 font-normal',
            triggerClassName,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="!z-[60] max-h-[min(34rem,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        <DropdownMenuLabel className="px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground">
          {t('smartCategories')}
        </DropdownMenuLabel>
        {virtualRows.map(row => (
          <DropdownMenuItem
            key={row.id}
            onSelect={() => onChange(row.id)}
            className={`cursor-pointer ${value === row.id ? 'bg-accent text-accent-foreground' : ''}`}
          >
            {row.label}
          </DropdownMenuItem>
        ))}
        {treeRows.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground">
              {t('bookmarkCategories')}
            </DropdownMenuLabel>
          </>
        )}
        {treeRows.map(row => (
          <DropdownMenuItem
            key={row.id}
            onSelect={() => onChange(row.id)}
            style={{ paddingLeft: `${2 + row.depth * 1.25}rem` }}
            className={`cursor-pointer ${value === row.id ? 'bg-accent text-accent-foreground' : ''}`}
          >
            {row.depth > 0 && (
              <span
                aria-hidden
                className={`mr-2 shrink-0 leading-none ${
                  row.depth === 1
                    ? 'text-primary'
                    : row.depth === 2
                      ? 'text-secondary'
                      : row.depth === 3
                        ? 'text-muted-foreground'
                        : 'text-muted-foreground/60'
                }`}
              >
                {row.depth === 1
                  ? '⬛'
                  : row.depth === 2
                    ? '◼'
                    : row.depth === 3
                      ? '🔲'
                      : '▪'}
              </span>
            )}
            <span className="truncate">{row.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
