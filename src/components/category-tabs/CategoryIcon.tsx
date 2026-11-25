import type { LucideIcon } from 'lucide-react'
import type { Category } from '~/lib/types'

import { Clock3, FileText, Folder, Inbox, Layers, LayoutGrid, ListFilter, Pin, Star, Tag } from 'lucide-react'
import { DEFAULT_CATEGORY_EMOJI } from '~/lib/default-data'
import { cn } from '~/lib/utils'

// Built-in entries and untouched folders share one line-icon set; user-picked emoji still win.
const builtInCategoryIcons: Record<string, LucideIcon> = {
  'all': LayoutGrid,
  'inbox': Inbox,
  'pinned': Pin,
  'frequent': Star,
  'recent': Clock3,
  'untagged': Tag,
  'undescribed': FileText,
  'bookmark-groups': Layers,
}

interface CategoryIconProps {
  category: Category
  active: boolean
  compact?: boolean
}

export function CategoryIcon({ category, active, compact = false }: CategoryIconProps) {
  const isBuiltIn = Boolean(builtInCategoryIcons[category.id])
  const Icon = category.id.startsWith('saved-search:')
    ? ListFilter
    : builtInCategoryIcons[category.id] ?? (category.emoji === DEFAULT_CATEGORY_EMOJI ? Folder : undefined)
  // Collapsed sidebar hides the name, so default folders get a name-initial badge
  // instead of one indistinguishable Folder glyph. Custom emoji stay as-is.
  const showInitialBadge = compact && !isBuiltIn && category.emoji === DEFAULT_CATEGORY_EMOJI
  const chars = Array.from(category.name.trim())
  const initial = chars[0] ?? '·'
  // Keep a trailing latin/digit marker so "專案A" and "專案B" stay distinguishable.
  const tail = chars.length > 1 && /[a-z0-9]$/i.test(chars[chars.length - 1]) ? chars[chars.length - 1] : ''
  return (
    <span data-slot="category-icon" className="flex w-5 shrink-0 items-center justify-center truncate text-base">
      {showInitialBadge
        ? (
            <span
              aria-hidden="true"
              className={cn(
                'flex h-4 min-w-4 items-center justify-center rounded-[4px] px-0.5 text-[9px] font-semibold leading-none',
                active ? 'bg-primary/20 text-primary' : 'bg-muted text-foreground/70',
              )}
            >
              {initial}
              {tail}
            </span>
          )
        : Icon
          ? <Icon aria-hidden="true" strokeWidth={1.75} className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
          : category.emoji}
    </span>
  )
}
