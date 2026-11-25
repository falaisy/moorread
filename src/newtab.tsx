import { lazy } from 'react'

import { BookmarkDragDropProvider } from '~/components/BookmarkDragDropProvider'
import { Header } from '~/components/Header'
import { NewtabDialogs } from '~/components/newtab/NewtabDialogs'
import { NewtabWorkspace } from '~/components/newtab/NewtabWorkspace'
import { useNewtabPage } from '~/components/newtab/use-newtab-page'
import { UndoDeletionToast } from '~/components/UndoDeletionToast'
import { backgroundStyleClass } from '~/lib/appearance'
import { bootstrapTheme } from '~/lib/theme-boot'
import { cn } from '~/lib/utils'
import '~main.css'

// 在 React 首次繪製前套用上次主題，避免深色使用者先看到整頁淺色 UI。
bootstrapTheme()

const loadBookmarkDialog = () => import('~/components/BookmarkDialog')
const loadCategoryDialog = () => import('~/components/CategoryDialog')
const loadCommandPalette = () => import('~/components/CommandPalette')

const BookmarkDialog = lazy(() =>
  loadBookmarkDialog().then(module => ({
    default: module.BookmarkDialog,
  })),
)
const CategoryDialog = lazy(() =>
  loadCategoryDialog().then(module => ({
    default: module.CategoryDialog,
  })),
)
const CommandPalette = lazy(() =>
  loadCommandPalette().then(module => ({
    default: module.CommandPalette,
  })),
)

const BookmarkGroupsView = lazy(() => import('~/components/BookmarkGroupsView').then(module => ({ default: module.BookmarkGroupsView })))

export default function NewTab() {
  const page = useNewtabPage()

  return (
    <BookmarkDragDropProvider>
      <div
        data-newtab-ready={page.bookmarksReady || undefined}
        data-home-layout={page.appearance.homeLayout}
        style={page.backgroundUrl ? { backgroundImage: `url("${page.backgroundUrl}")` } : undefined}
        className={cn(
          'newtab-shell min-h-dvh',
          backgroundStyleClass[page.appearance.backgroundStyle],
          page.backgroundUrl && 'bg-cover bg-center bg-no-repeat bg-fixed',
        )}
      >
        <Header
          onAdd={page.openAddBookmark}
          onOpenCommand={page.openCommandPalette}
          healthOpen={page.healthOpen}
          onHealthOpenChange={page.onHealthOpenChange}
          searchDocked={page.searchDocked}
        />

        <NewtabWorkspace
          appearance={page.appearance}
          language={page.language}
          weatherBackground={page.weatherBackground}
          bookmarksReady={page.bookmarksReady}
          startupError={page.startupError}
          onRetryStartup={page.retryStartup}
          groupsOpen={page.groupsOpen}
          groupsEnabled={page.groupsEnabled}
          groupsActive={page.groupsActive}
          pinnedGroupsOnly={page.pinnedGroupsOnly}
          groupsView={BookmarkGroupsView}
          onOpenCommand={page.openCommandPalette}
          onDockedChange={page.onDockedChange}
          onAddBookmark={page.openAddBookmark}
          onEditBookmark={page.openEditBookmark}
          onEditCategory={page.openCategoryEditor}
          onSelectGroups={page.selectGroups}
          onSelectCategoryView={page.selectCategoryView}
        />

        <NewtabDialogs
          bookmarkDialog={BookmarkDialog}
          categoryDialog={CategoryDialog}
          commandPalette={CommandPalette}
          language={page.language}
          dialogOpen={page.dialogOpen}
          onDialogOpenChange={page.onDialogOpenChange}
          editingBookmark={page.editingBookmark}
          editingCategory={page.editingCategory}
          closeCategoryDialog={page.closeCategoryDialog}
          commandOpen={page.commandOpen}
          onCommandOpenChange={page.onCommandOpenChange}
          onAddBookmark={page.openAddBookmark}
          onOpenHealth={page.openHealthDialog}
        />
        <UndoDeletionToast />
      </div>
    </BookmarkDragDropProvider>
  )
}
