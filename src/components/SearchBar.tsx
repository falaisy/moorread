import type { FormEvent, KeyboardEvent } from 'react'
import type { SearchBarResultItem } from '~/lib/search-bar-results'
import {
  BookOpen,
  ChevronDown,
  Command,
  FolderOpen,
  Globe2,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { SearchEngineIcon } from '~/components/SearchEngineIcon'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { openBookmarkUrl } from '~/lib/bookmark-urls'
import { reportExpectedFallback } from '~/lib/diagnostics'
import { formatShortcut } from '~/lib/keyboard-shortcuts'
import { getNavigationDerivedData } from '~/lib/navigation-derived'
import {
  buildSearchBarResults,
  EMPTY_SEARCH_BAR_RESULTS,
} from '~/lib/search-bar-results'
import {
  getAvailableSearchEngines,
  resolveSearchIntent,
} from '~/lib/search-engines'
import {
  useBookmarks,
  useCategories,
  useNavStore,
} from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

// 简单判断输入是否为网址（形如 example.com/path）
function looksLikeUrl(s: string): boolean {
  return /^[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/.test(s) && !s.includes(' ')
}

interface SearchBarProps {
  onOpenCommand: () => void
  variant?: 'header' | 'hero'
  /** Shown temporarily in the header while the centered hero is scrolled away. */
  docked?: boolean
}

type SearchMode = 'bookmarks' | 'web'
const BROWSER_DEFAULT_ENGINE_ID = 'browser-default'

export function SearchBar({ onOpenCommand, variant = 'header', docked = false }: SearchBarProps) {
  const inputId = docked ? 'moorread-search-docked' : 'moorread-search'
  const { t } = useI18n()
  const settings = useNavStore(s => s.settings)
  const query = useNavStore(s => s.bookmarkSearchQuery)
  const setBookmarkSearchQuery = useNavStore(s => s.setBookmarkSearchQuery)

  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<SearchMode>('bookmarks')
  const [webQuery, setWebQuery] = useState('')
  const [engineId, setEngineId] = useState(BROWSER_DEFAULT_ENGINE_ID)
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [resultsDismissed, setResultsDismissed] = useState(false)
  const savedBookmarkQueryRef = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingSubmitRef = useRef<MutationObserver | null>(null)
  const bookmarks = useBookmarks()
  const categories = useCategories()
  const setActiveCategory = useNavStore(s => s.setActiveCategory)
  const recordBookmarkOpen = useNavStore(s => s.recordBookmarkOpen)

  const engines = getAvailableSearchEngines(settings.customSearchEngines)
  const engine = engines.find(item => item.id === engineId)
  const selectedEngineId = engine?.id ?? BROWSER_DEFAULT_ENGINE_ID
  const engineName = engine?.name ?? t('browserDefaultSearchEngine')
  const activeQuery = mode === 'bookmarks' ? query : webQuery
  const commandShortcut = formatShortcut(
    settings.keyboardShortcuts.openCommandPalette,
  )

  // 書籤與資料夾共用同一份索引（getNavigationDerivedData 內有快取），
  // 每次輸入只重新計分，不重建索引。
  const resultQuery = mode === 'bookmarks' ? query.trim() : ''
  const results = useMemo(() => {
    if (!resultQuery)
      return EMPTY_SEARCH_BAR_RESULTS
    const derived = getNavigationDerivedData(bookmarks, categories)
    return buildSearchBarResults({
      query: resultQuery,
      entries: derived.searchEntries,
      categories,
      categoryPathMap: derived.categoryPathMap,
    })
  }, [bookmarks, categories, resultQuery])
  const resultsId = `${inputId}-results`
  const resultsOpen = resultQuery.length > 0 && !resultsDismissed
  const activeResult = resultsOpen
    ? results.items[activeResultIndex]
    : undefined

  // 查詢改變就回到「未選取」，並讓 Escape 的關閉狀態失效。
  useEffect(() => {
    setActiveResultIndex(-1)
    setResultsDismissed(false)
  }, [resultQuery])

  // 进入主页自动聚焦搜索框
  useEffect(() => {
    // Only the first mount decides; a docked bar must not steal focus while scrolling.
    if (!docked)
      inputRef.current?.focus()
    return () => pendingSubmitRef.current?.disconnect()
  }, [])

  // Typing keeps landing in a visible box: focus follows the search into the header and back.
  useLayoutEffect(() => {
    if (!docked)
      return
    const input = inputRef.current
    if (document.activeElement?.id === 'moorread-search')
      input?.focus({ preventScroll: true })
    return () => {
      if (document.activeElement === input)
        document.getElementById('moorread-search')?.focus({ preventScroll: true })
    }
  }, [docked])

  const cancelPendingSubmit = () => {
    pendingSubmitRef.current?.disconnect()
    pendingSubmitRef.current = null
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    cancelPendingSubmit()
    if (mode === 'bookmarks') {
      const submittedQuery = useNavStore.getState().bookmarkSearchQuery
      if (!submittedQuery.trim())
        return
      const form = e.currentTarget
      const searchState = document.querySelector<HTMLElement>('[data-bookmark-search-query]')
      const openCurrentResult = () => {
        if (
          useNavStore.getState().bookmarkSearchQuery !== submittedQuery
          || !form.isConnected
          || !form.contains(document.activeElement)
          || (searchState && !searchState.isConnected)
        ) {
          return true
        }
        // Deferred rendering may still show the previous query's directories.
        if (searchState && searchState.dataset.bookmarkSearchQuery !== submittedQuery)
          return false
        cancelPendingSubmit()
        const firstVisibleItem = Array.from(
          document.querySelectorAll<HTMLElement>('[data-nav-item]'),
        ).find(item => item.offsetParent !== null)
        firstVisibleItem?.click()
        return true
      }
      if (!openCurrentResult()) {
        pendingSubmitRef.current = new MutationObserver(() => {
          if (openCurrentResult())
            cancelPendingSubmit()
        })
        pendingSubmitRef.current.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-bookmark-search-query'],
          childList: true,
          subtree: true,
        })
      }
      return
    }

    const q = webQuery.trim()
    if (!q)
      return
    if (looksLikeUrl(q)) {
      window.location.href = q.startsWith('http') ? q : `https://${q}`
      return
    }
    const intent = resolveSearchIntent(q, engines, selectedEngineId)
    if (!intent.engine) {
      void chrome.search.query({
        text: intent.query,
        disposition: chrome.search.Disposition.CURRENT_TAB,
      })
      return
    }
    window.location.href = intent.engine.url.replace(
      '%s',
      encodeURIComponent(intent.query),
    )
  }

  const changeMode = (nextMode: SearchMode) => {
    if (nextMode === mode)
      return
    cancelPendingSubmit()
    if (nextMode === 'web') {
      savedBookmarkQueryRef.current = query
      setWebQuery(query)
      setBookmarkSearchQuery('')
    }
    else {
      setBookmarkSearchQuery(savedBookmarkQueryRef.current)
    }
    setMode(nextMode)
    inputRef.current?.focus()
  }

  const clearQuery = () => {
    if (mode === 'bookmarks')
      setBookmarkSearchQuery('')
    else setWebQuery('')
    inputRef.current?.focus()
  }

  const openResult = (item: SearchBarResultItem) => {
    if (item.kind === 'folder') {
      setActiveCategory(item.category.id)
      setBookmarkSearchQuery('')
      setActiveResultIndex(-1)
      inputRef.current?.focus()
      return
    }
    setResultsDismissed(true)
    setActiveResultIndex(-1)
    void recordBookmarkOpen(item.bookmark.url)
      .catch(cause => reportExpectedFallback('usage.record', cause))
    void openBookmarkUrl(item.bookmark)
  }

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文輸入法組字中的 Enter / 方向鍵交給 IME，不當成選取操作。
    if (mode !== 'bookmarks' || event.nativeEvent.isComposing)
      return
    if (event.key === 'Escape') {
      if (!resultsOpen)
        return
      event.preventDefault()
      cancelPendingSubmit()
      setResultsDismissed(true)
      setActiveResultIndex(-1)
      return
    }
    if (!resultsOpen || results.items.length === 0)
      return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveResultIndex(index =>
        index + 1 >= results.items.length ? 0 : index + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveResultIndex(index =>
        index <= 0 ? results.items.length - 1 : index - 1)
      return
    }
    if (event.key === 'Enter' && activeResult) {
      // 只有使用者用方向鍵選取後才接管 Enter；否則交給表單，
      // 沿用原本「Enter 開啟第一個結果」的 MutationObserver 流程。
      event.preventDefault()
      cancelPendingSubmit()
      openResult(activeResult)
    }
  }

  const renderResult = (item: SearchBarResultItem, index: number) => {
    const active = index === activeResultIndex
    const subtitle = item.kind === 'bookmark'
      ? item.path || item.bookmark.url
      : item.path.join(' / ')
    return (
      <button
        key={item.id}
        id={`${resultsId}-${index}`}
        type="button"
        role="option"
        aria-selected={active}
        data-search-result-active={active || undefined}
        onMouseEnter={() => setActiveResultIndex(index)}
        onClick={() => openResult(item)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/60',
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70 text-muted-foreground ring-1 ring-border/60">
          {item.kind === 'bookmark'
            ? <BookOpen className="size-3.5" />
            : <FolderOpen className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {item.kind === 'bookmark' ? item.bookmark.name : subtitle}
          {item.kind === 'bookmark'
            ? (
                <>
                  {' '}
                  <span className="text-xs text-muted-foreground">{subtitle}</span>
                </>
              )
            : null}
        </span>
      </button>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        // Hero 面板在文件流內展開；焦點先落在卡片操作按鈕時，等這次點擊完成後再收合，
        // 避免面板即時收合造成按鈕在 mousedown 與 mouseup 之間位移、點擊落空。
        const keepsResultsForCardAction = variant === 'hero' && nextTarget instanceof Element && Boolean(nextTarget.closest('[data-card-key]'))
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          if (keepsResultsForCardAction) {
            const form = event.currentTarget
            const dismissAfterCardAction = () => {
              document.removeEventListener('click', dismissAfterCardAction, true)
              // 使用者已回到搜尋框時不再收合，避免影響新的查詢。
              if (document.activeElement instanceof Node && form.contains(document.activeElement))
                return
              queueMicrotask(() => {
                cancelPendingSubmit()
                setResultsDismissed(true)
                setActiveResultIndex(-1)
              })
            }
            document.addEventListener('click', dismissAfterCardAction, true)
            return
          }
          cancelPendingSubmit()
          setResultsDismissed(true)
          setActiveResultIndex(-1)
        }
      }}
      data-morph="search"
      data-docked={docked || undefined}
      className="relative w-full max-w-[42rem]"
    >
      <label htmlFor={inputId} className="sr-only">
        {t('searchOrEnterUrl')}
      </label>
      <div
        data-search-field
        className={cn(
          'flex h-11 items-center rounded-xl border border-border/70 bg-card/90 backdrop-blur-xs shadow-xs transition-all duration-200 focus-within:border-ring/40 focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring',
          variant === 'hero' && 'h-[3.25rem] rounded-2xl bg-card px-1 shadow-[0_14px_36px_-18px_hsl(var(--foreground)/0.28)]',
        )}
      >
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value)
              changeMode(value as SearchMode)
          }}
          aria-label={t('searchScope')}
          size="sm"
          className="ml-1 shrink-0 rounded-lg bg-secondary/60 p-0.5"
        >
          <ToggleGroupItem
            value="bookmarks"
            aria-label={t('searchBookmarks')}
            title={t('searchBookmarks')}
            className="rounded-md px-2 py-1 text-xs"
          >
            <BookOpen className="size-3.5" />
            <span className="hidden sm:inline">{t('bookmarks')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="web"
            aria-label={t('searchWeb')}
            title={t('searchWeb')}
            className="rounded-md px-2 py-1 text-xs"
          >
            <Globe2 className="size-3.5" />
            <span className="hidden sm:inline">{t('web')}</span>
          </ToggleGroupItem>
        </ToggleGroup>

        {/* 搜索引擎切换 */}
        {mode === 'web'
          ? (
              <DropdownMenu
                modal={false}
                open={menuOpen}
                onOpenChange={setMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('selectSearchEngine')}
                    className="flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-[color,background-color] hover:bg-accent/70 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SearchEngineIcon engine={engine} />
                    <span className="hidden sm:inline">{engineName}</span>
                    <ChevronDown className="size-3 text-muted-foreground/70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="w-52 shadow-md"
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    inputRef.current?.focus()
                  }}
                >
                  <DropdownMenuRadioGroup
                    value={selectedEngineId}
                    onValueChange={setEngineId}
                  >
                    <DropdownMenuRadioItem value={BROWSER_DEFAULT_ENGINE_ID}>
                      <SearchEngineIcon />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {t('browserDefaultSearchEngine')}
                      </span>
                    </DropdownMenuRadioItem>
                    {engines.map(item => (
                      <DropdownMenuRadioItem key={item.id} value={item.id}>
                        <SearchEngineIcon engine={item} />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {item.name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.keyword}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          : null}

        <div className="h-4 w-px bg-border/70" />

        {/* 搜索输入 */}
        <input
          id={inputId}
          ref={inputRef}
          value={activeQuery}
          onChange={(event) => {
            cancelPendingSubmit()
            if (mode === 'bookmarks')
              setBookmarkSearchQuery(event.target.value)
            else setWebQuery(event.target.value)
          }}
          onFocus={() => setResultsDismissed(false)}
          onKeyDown={onSearchKeyDown}
          role={mode === 'bookmarks' ? 'combobox' : undefined}
          aria-autocomplete={mode === 'bookmarks' ? 'list' : undefined}
          aria-expanded={mode === 'bookmarks' ? resultsOpen : undefined}
          aria-controls={resultsOpen ? resultsId : undefined}
          aria-activedescendant={
            activeResult ? `${resultsId}-${activeResultIndex}` : undefined
          }
          aria-label={
            mode === 'bookmarks'
              ? t('searchBookmarksAndFolders')
              : t('searchWebOrEnterUrl')
          }
          placeholder={
            mode === 'bookmarks'
              ? t('searchBookmarksAndFolders')
              : engine
                ? t('enterUrlOrKeyword', { keyword: engine.keyword })
                : t('searchWebOrEnterUrl')
          }
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />

        {activeQuery.length > 0
          ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearQuery}
                aria-label={t('clearSearch')}
                title={t('clearSearch')}
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X data-icon="inline-start" className="size-3.5" />
              </Button>
            )
          : null}

        <button
          type="button"
          onClick={onOpenCommand}
          aria-label={t('openCommandPalette')}
          title={`${t('openCommandPalette')} (${commandShortcut})`}
          className="mr-1 hidden h-6 shrink-0 items-center gap-1 rounded-[6px] border border-border/70 bg-muted/50 px-1.5 text-2xs font-mono font-medium text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
        >
          <Command className="h-3 w-3 md:hidden" />
          <span className="hidden md:inline">{commandShortcut}</span>
        </button>

        {/* 提交按钮 */}
        <button
          type="submit"
          aria-label={
            mode === 'bookmarks' ? t('openFirstBookmarkResult') : t('searchWeb')
          }
          title={
            mode === 'bookmarks'
              ? t('openFirstResult')
              : t('searchWithEngine', { engine: engineName })
          }
          className="flex h-11 w-10 items-center justify-center rounded-r-xl text-muted-foreground/70 ring-offset-background transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {resultsOpen
        ? (
            <div
              id={resultsId}
              role="listbox"
              aria-label={t('searchResultsList')}
              onMouseDown={event => event.preventDefault()}
              className={cn(
                'mt-2 max-h-[min(20rem,60vh)] overflow-y-auto rounded-xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-popover',
                // Hero 搜尋：面板留在文件流內，展開時把下方內容推開，避免覆蓋分類卡操作按鈕。
                // Docked 搜尋位於 sticky header，維持原本的浮層行為。
                variant === 'hero' ? 'relative' : 'absolute inset-x-0 top-full z-dropdown',
              )}
            >
              {results.items.length === 0
                ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t('noMatches')}
                    </div>
                  )
                : (
                    <>
                      {results.bookmarks.length > 0
                        ? (
                            <div role="group" aria-label={t('bookmarks')}>
                              <div
                                role="presentation"
                                className="px-2.5 py-1 text-2xs font-medium text-muted-foreground"
                              >
                                {t('bookmarks')}
                              </div>
                              {results.bookmarks.map((item, index) =>
                                renderResult(item, index))}
                            </div>
                          )
                        : null}
                      {results.folders.length > 0
                        ? (
                            <div role="group" aria-label={t('folder')}>
                              <div
                                role="presentation"
                                className={cn(
                                  'px-2.5 py-1 text-2xs font-medium text-muted-foreground',
                                  results.bookmarks.length > 0 && 'mt-1',
                                )}
                              >
                                {t('folder')}
                              </div>
                              {results.folders.map((item, index) =>
                                renderResult(item, results.bookmarks.length + index))}
                            </div>
                          )
                        : null}
                    </>
                  )}
            </div>
          )
        : null}
    </form>
  )
}
