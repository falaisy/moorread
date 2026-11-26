import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { AdditionalGridItem } from '~/components/bookmark-grid/BookmarkGridItems'
import type { AppearanceSettings, Bookmark, Category, Language } from '~/lib/types'

import * as Popover from '@radix-ui/react-popover'
import { ChevronLeft, ChevronRight, Settings2, X } from 'lucide-react'
import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'

import { BookmarkGridLoadingState } from '~/components/bookmark-grid/BookmarkGridLoadingState'
import { BookmarkGrid } from '~/components/BookmarkGrid'
import { CategoryTabs } from '~/components/CategoryTabs'
import { HomeHero } from '~/components/HomeHero'
import { Button } from '~/components/ui/button'
import { TooltipProvider } from '~/components/ui/tooltip'
import { WeatherBackdrop } from '~/components/WeatherBackdrop'
import {
  contentWidthClass,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '~/lib/appearance'
import { translate } from '~/lib/i18n'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface GroupsViewProps {
  pinnedOnly?: boolean
  renderCards?: (cards: AdditionalGridItem[], count: number) => ReactNode
}

interface NewtabWorkspaceProps {
  appearance: AppearanceSettings
  language: Language
  weatherBackground: boolean
  bookmarksReady: boolean
  startupError: boolean
  onRetryStartup: () => void
  groupsOpen: boolean
  groupsEnabled: boolean
  groupsActive: boolean
  pinnedGroupsOnly: boolean
  /** The lazily loaded groups view, kept by the caller so its Suspense boundary does not move. */
  groupsView: LazyExoticComponent<ComponentType<GroupsViewProps>>
  onOpenCommand: () => void
  onDockedChange: (docked: boolean) => void
  onAddBookmark: () => void
  onEditBookmark: (bookmark: Bookmark) => void
  onEditCategory: (category: Category) => void
  onSelectGroups: () => void
  onSelectCategoryView: () => void
}

interface DragSession {
  pointerId: number
  startX: number
  startWidth: number
  dragStartWidth: number
  startCollapsed: boolean
}

/** 首屏資料讀取失敗時顯示；不覆蓋既有書籤，提供明確重試入口。 */
function BookmarkStartupErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      data-newtab-startup-error
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6"
    >
      <p className="text-sm leading-relaxed text-foreground">{t('runtimeStartupLoadFailed')}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t('runtimeStartupRetry')}
      </Button>
    </div>
  )
}

/** Category rail plus the main column that hosts the hero and the bookmark grid. */
export function NewtabWorkspace({
  appearance,
  language,
  weatherBackground,
  bookmarksReady,
  startupError,
  onRetryStartup,
  groupsOpen,
  groupsEnabled,
  groupsActive,
  pinnedGroupsOnly,
  groupsView,
  onOpenCommand,
  onDockedChange,
  onAddBookmark,
  onEditBookmark,
  onEditCategory,
  onSelectGroups,
  onSelectCategoryView,
}: NewtabWorkspaceProps) {
  const { t } = useI18n()
  const GroupsView = groupsView
  const showGroupsView = groupsOpen || pinnedGroupsOnly
  const pinnedOnly = !groupsOpen && pinnedGroupsOnly
  const loadingLabel = `${translate(language, 'bookmarks')}…`

  const sidebarWidth = appearance.sidebarWidth
  const sidebarCollapsed = appearance.sidebarCollapsed
  const setAppearance = useNavStore(state => state.setAppearance)

  const sidebarLayout = appearance.navLayout === 'sidebar'
  const sidebarVisible = sidebarLayout
  // --- Drag state -------------------------------------------------------
  const [isDragging, setIsDragging] = useState(false)
  const [dragWidth, setDragWidth] = useState<number>(sidebarWidth)
  const localWidthRef = useRef<number>(sidebarWidth)
  const sessionRef = useRef<DragSession | null>(null)
  const handleElRef = useRef<HTMLButtonElement | null>(null)
  const activeWidth = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : isDragging ? dragWidth : sidebarWidth

  useEffect(() => {
    if (!isDragging && sidebarWidth !== localWidthRef.current) {
      localWidthRef.current = sidebarWidth
      setDragWidth(sidebarWidth)
    }
  }, [sidebarWidth, isDragging])

  const endDrag = useCallback((kind: 'commit' | 'cancel') => {
    const session = sessionRef.current
    if (!session)
      return
    sessionRef.current = null
    try {
      handleElRef.current?.releasePointerCapture(session.pointerId)
    }
    catch { /* already released */ }
    if (kind === 'cancel') {
      localWidthRef.current = session.startWidth
      setDragWidth(session.startWidth)
      if (session.startCollapsed) {
        void setAppearance({
          sidebarCollapsed: true,
          sidebarWidth: session.startWidth,
        })
      }
    }
    else {
      const next = Math.round(localWidthRef.current)
      const clamped = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, next))
      localWidthRef.current = clamped
      setDragWidth(clamped)
      void setAppearance({ sidebarWidth: clamped })
    }
    setIsDragging(false)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [setAppearance])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (sidebarCollapsed) {
      void setAppearance({ sidebarCollapsed: false, sidebarWidth: SIDEBAR_WIDTH_DEFAULT })
      localWidthRef.current = SIDEBAR_WIDTH_DEFAULT
      setDragWidth(SIDEBAR_WIDTH_DEFAULT)
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebarWidth,
        dragStartWidth: SIDEBAR_WIDTH_DEFAULT,
        startCollapsed: true,
      }
    }
    else {
      localWidthRef.current = sidebarWidth
      setDragWidth(sidebarWidth)
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebarWidth,
        dragStartWidth: sidebarWidth,
        startCollapsed: false,
      }
    }
    setIsDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    try {
      handleElRef.current?.setPointerCapture(event.pointerId)
    }
    catch { /* touch may not support; move/up still bubble */ }
    event.preventDefault()
  }, [sidebarCollapsed, sidebarWidth, setAppearance])

  useEffect(() => {
    if (!isDragging)
      return

    const onMove = (event: PointerEvent) => {
      const session = sessionRef.current
      if (!session)
        return
      const delta = event.clientX - session.startX
      const next = Math.round(session.dragStartWidth + delta)
      localWidthRef.current = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, next))
      setDragWidth(localWidthRef.current)
    }
    const onUp = () => {
      endDrag('commit')
    }
    const onCancel = () => {
      endDrag('cancel')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        endDrag('cancel')
      }
    }
    const onWindowBlur = () => {
      endDrag('commit')
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onWindowBlur)
      if (sessionRef.current) {
        try {
          handleElRef.current?.releasePointerCapture(sessionRef.current.pointerId)
        }
        catch { /* ignore */ }
        sessionRef.current = null
      }
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, endDrag, setAppearance])

  // --- Collapsed popover state -----------------------------------------
  const popoverHeadingId = useId()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const gridStyle = sidebarVisible
    ? { gridTemplateColumns: `${activeWidth}px minmax(0,1fr)` }
    : undefined

  const collapsedPopoverContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 [&_nav]:lg:!h-auto [&_nav]:lg:!overflow-x-hidden">
      <CategoryTabs
        onEditCategory={onEditCategory}
        groupsActive={groupsActive}
        onSelectGroups={onSelectGroups}
        onSelectCategory={onSelectCategoryView}
        compact={false}
      />
    </div>
  )

  // --- JSX -------------------------------------------------------------
  const sidebarCollapsedContent = (
    <aside
      className={cn(
        'flex items-center gap-1 border-b border-border/60 bg-background/45 px-2 py-1.5',
        'lg:sticky lg:top-[var(--header-height)] lg:h-[calc(100dvh-var(--header-height))] lg:border-b-0 lg:border-r',
        'lg:overflow-hidden lg:px-1 lg:py-3',
        'lg:transition-[width] lg:duration-200',
        'lg:flex lg:flex-col lg:items-center',
      )}
    >
      <TooltipProvider delayDuration={400} skipDelayDuration={0} disableHoverableContent>
        {/* Top row: expand button (clearly visible, always present) */}
        <div className="flex shrink-0 items-center justify-center gap-1 lg:mb-2 lg:w-full">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setPopoverOpen(false)
              void setAppearance({ sidebarCollapsed: false })
            }}
            aria-label={t('sidebarExpand')}
            title={t('sidebarExpand')}
            className="flex size-8 items-center justify-center rounded-md border border-border-strong text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Category tabs — each icon is its own button with tooltip (no outer wrapper!) */}
        <div className="min-w-0 flex-1 overflow-y-auto lg:flex lg:flex-col lg:items-center [&>nav]:lg:flex-col [&>nav]:lg:items-center [&>nav]:lg:gap-1 [&>nav_*]:lg:mx-auto [&_[data-category-tab]]:lg:justify-center [&_[data-category-tab]]:lg:w-full [&_[data-category-tab]_button]:lg:justify-center">
          <CategoryTabs
            onEditCategory={onEditCategory}
            groupsActive={groupsActive}
            onSelectGroups={onSelectGroups}
            onSelectCategory={onSelectCategoryView}
            compact
          />
        </div>

        {/* Bottom: manage-button popover trigger (click for full-expanded category UI) */}
        <div className="flex shrink-0 items-center justify-center gap-1 lg:mt-2 lg:w-full">
          <Popover.Root
            open={popoverOpen}
            onOpenChange={setPopoverOpen}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={t('sidebarManage')}
                title={t('sidebarManage')}
                className="flex size-8 items-center justify-center rounded-md border border-border-strong text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 className="size-4" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                aria-labelledby={popoverHeadingId}
                role="group"
                side="right"
                sideOffset={8}
                alignOffset={0}
                avoidCollisions
                collisionPadding={8}
                className={cn(
                  'z-popover flex h-fit max-h-[calc(100dvh-40px)] w-[300px] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg outline-none',
                  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
                )}
                onOpenAutoFocus={(event) => { event.preventDefault() }}
                onCloseAutoFocus={() => { /* keep focus on trigger */ }}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2.5">
                  <h2 id={popoverHeadingId} className="text-sm font-semibold text-foreground/90">{t('bookmarkCategories')}</h2>
                  <button
                    type="button"
                    onClick={() => setPopoverOpen(false)}
                    aria-label={t('close')}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {collapsedPopoverContent}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </TooltipProvider>
    </aside>
  )

  const sidebarExpandedContent = (
    <aside
      className={cn(
        'border-b border-border/60 bg-background/45 lg:sticky lg:top-[var(--header-height)] lg:h-[calc(100dvh-var(--header-height))] lg:border-b-0 lg:border-r',
        'lg:px-3 lg:py-5',
        'lg:transition-[width] lg:duration-200',
      )}
    >
      <div className="flex items-center gap-1 lg:mb-2">
        <button
          type="button"
          onClick={() => void setAppearance({ sidebarCollapsed: true })}
          aria-label={t('sidebarCollapse')}
          title={t('sidebarCollapse')}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="hidden lg:flex min-w-0 flex-1" />
      </div>

      <CategoryTabs
        onEditCategory={onEditCategory}
        groupsActive={groupsActive}
        onSelectGroups={onSelectGroups}
        onSelectCategory={onSelectCategoryView}
        compact={false}
      />
    </aside>
  )

  return (
    <div
      data-nav-layout={appearance.navLayout}
      className={cn(
        'workspace-layout relative',
        sidebarVisible
          ? 'lg:grid'
          : 'flex flex-col',
      )}
      style={gridStyle}
    >
      {sidebarVisible
        ? sidebarCollapsed
          ? sidebarCollapsedContent
          : sidebarExpandedContent
        : (
            <aside
              className="sticky top-[var(--header-height,var(--brand-h))] z-30 border-b border-border/60 bg-background/95 px-3 py-2 sm:px-5 lg:top-[var(--header-height)] lg:px-6"
            >
              <CategoryTabs onEditCategory={onEditCategory} groupsActive={groupsActive} onSelectGroups={onSelectGroups} onSelectCategory={onSelectCategoryView} />
            </aside>
          )}

      {sidebarVisible
        ? (
            <button
              ref={handleElRef}
              type="button"
              aria-label={t('sidebarResize')}
              aria-hidden={isDragging ? undefined : true}
              tabIndex={-1}
              onPointerDown={handleResizeStart}
              onDoubleClick={() => {
                void setAppearance({ sidebarCollapsed: !sidebarCollapsed })
              }}
              className={cn(
                'hidden lg:block absolute top-0 bottom-0 z-10 w-[3px] translate-x-[-50%] cursor-col-resize',
                'bg-transparent transition-colors',
                'hover:bg-primary-foreground/20',
                isDragging && 'bg-ring',
              )}
              style={{ left: activeWidth }}
            />
          )
        : null}

      <main className="relative min-w-0 px-3 py-5 sm:px-5 sm:py-6 lg:px-8 lg:py-8 xl:px-12">
        {appearance.homeLayout === 'centered' && appearance.colorTheme === 'sky' && weatherBackground ? <WeatherBackdrop /> : null}
        <div
          className={cn(
            'relative',
            contentWidthClass[appearance.contentWidth],
          )}
        >
          {appearance.homeLayout === 'centered' ? <HomeHero onOpenCommand={onOpenCommand} onDockedChange={onDockedChange} /> : null}
          <div data-morph="grid">
            {startupError
              ? <BookmarkStartupErrorState onRetry={onRetryStartup} />
              : showGroupsView
                ? (
                    <Suspense fallback={<BookmarkGridLoadingState label={loadingLabel} />}>
                      <GroupsView
                        key={pinnedOnly ? 'pinned-groups' : 'all-groups'}
                        pinnedOnly={pinnedOnly || undefined}
                        renderCards={groupsEnabled && !pinnedOnly
                          ? undefined
                          : (cards, count) => (
                              <BookmarkGrid
                                loading={!bookmarksReady}
                                additionalItems={cards}
                                additionalItemCount={count}
                                onEdit={onEditBookmark}
                                onEditCategory={onEditCategory}
                                onAdd={onAddBookmark}
                              />
                            )}
                      />
                    </Suspense>
                  )
                : (
                    <BookmarkGrid
                      loading={!bookmarksReady}
                      onEdit={onEditBookmark}
                      onEditCategory={onEditCategory}
                      onAdd={onAddBookmark}
                    />
                  )}
          </div>
        </div>
      </main>
    </div>
  )
}
