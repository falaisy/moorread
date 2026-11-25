import type { ComponentProps, ComponentType, LazyExoticComponent } from 'react'
import type { Bookmark, Category, Language } from '~/lib/types'

import { Suspense } from 'react'
import { LazyDialogFallback } from '~/components/LazyDialogFallback'
import { translate } from '~/lib/i18n'

type BookmarkDialogComponent = LazyExoticComponent<ComponentType<ComponentProps<typeof import('~/components/BookmarkDialog')['BookmarkDialog']>>>
type CategoryDialogComponent = LazyExoticComponent<ComponentType<ComponentProps<typeof import('~/components/CategoryDialog')['CategoryDialog']>>>
type CommandPaletteComponent = LazyExoticComponent<ComponentType<ComponentProps<typeof import('~/components/CommandPalette')['CommandPalette']>>>

interface NewtabDialogsProps {
  /** Lazily loaded dialogs stay owned by the caller so their Suspense boundary keeps its place. */
  bookmarkDialog: BookmarkDialogComponent
  categoryDialog: CategoryDialogComponent
  commandPalette: CommandPaletteComponent
  language: Language
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  editingBookmark: Bookmark | null
  editingCategory: Category | null
  closeCategoryDialog: () => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
  onAddBookmark: () => void
  onOpenHealth: () => void
}

/** One Suspense boundary mounting the bookmark, category and command dialogs. */
export function NewtabDialogs({
  bookmarkDialog: BookmarkDialog,
  categoryDialog: CategoryDialog,
  commandPalette: CommandPalette,
  language,
  dialogOpen,
  onDialogOpenChange,
  editingBookmark,
  editingCategory,
  closeCategoryDialog,
  commandOpen,
  onCommandOpenChange,
  onAddBookmark,
  onOpenHealth,
}: NewtabDialogsProps) {
  return (
    <Suspense
      fallback={
        <LazyDialogFallback label={translate(language, 'brandName')} />
      }
    >
      {dialogOpen
        ? (
            <BookmarkDialog
              open={dialogOpen}
              onOpenChange={onDialogOpenChange}
              bookmark={editingBookmark}
            />
          )
        : null}
      {editingCategory
        ? (
            <CategoryDialog
              open
              onOpenChange={(nextOpen) => {
                if (!nextOpen)
                  closeCategoryDialog()
              }}
              category={editingCategory}
            />
          )
        : null}
      {commandOpen
        ? (
            <CommandPalette
              open
              onOpenChange={onCommandOpenChange}
              onAddBookmark={onAddBookmark}
              onOpenHealth={onOpenHealth}
            />
          )
        : null}
    </Suspense>
  )
}
