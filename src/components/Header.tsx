import { Plus, Settings } from 'lucide-react'
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import logoUrl from 'url:~assets/brand-mark.png'
import { HeaderMoreMenu } from '~/components/HeaderMoreMenu'
import { HeaderWidget } from '~/components/HeaderWidget'
import { LazyDialogFallback } from '~/components/LazyDialogFallback'
import { SearchBar } from '~/components/SearchBar'
import { Button } from '~/components/ui/button'
import { formatShortcut } from '~/lib/keyboard-shortcuts'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

const loadSettingsDialog = () => import('~/components/SettingsDialog')
const SettingsDialog = lazy(() =>
  loadSettingsDialog().then(module => ({
    default: module.SettingsDialog,
  })),
)

interface HeaderProps {
  onAdd: () => void
  onOpenCommand: () => void
  healthOpen: boolean
  onHealthOpenChange: (open: boolean) => void
  /** The centered hero's search has scrolled under the header. */
  searchDocked?: boolean
}

export function Header({
  onAdd,
  onOpenCommand,
  healthOpen,
  onHealthOpenChange,
  searchDocked = false,
}: HeaderProps) {
  const { t } = useI18n()
  const addBookmarkShortcut = useNavStore(
    state => state.settings.keyboardShortcuts.addBookmark,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The centered home layout moves search and time into the page hero.
  const centered = useNavStore(
    state => state.settings.appearance.homeLayout === 'centered',
  )
  const headerRef = useRef<HTMLElement>(null)
  // The top category bar sticks right below the header, whose height changes with layout, docking and wrapping.
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header)
      return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--header-height', `${header.offsetHeight}px`))
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  const docked = centered && searchDocked
  const dockedMotion = 'animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none'

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md transition-colors">
      <div className="grid min-h-brand-h grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-5 lg:flex lg:flex-nowrap lg:gap-3 lg:px-5 lg:py-0">
        <div className="flex min-w-0 items-center lg:w-[13.25rem]">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={logoUrl} alt="" className="size-9 shrink-0 object-contain drop-shadow-xs" />
            <h1 className="truncate whitespace-nowrap text-brand font-semibold leading-5 tracking-[-0.01em]">
              {t('brandName')}
            </h1>
          </div>
        </div>

        {centered && !docked
          ? <div className="hidden lg:block lg:flex-1" />
          : (
              <div className={cn('col-span-2 row-start-2 flex w-full min-w-0 justify-center lg:order-none lg:col-auto lg:row-auto lg:flex-1', docked && dockedMotion)}>
                <SearchBar onOpenCommand={onOpenCommand} docked={docked} />
              </div>
            )}

        <div className="col-start-2 row-start-1 ml-auto flex shrink-0 items-center gap-2 lg:col-auto lg:row-auto">
          {centered && !docked ? null : <span className={cn('contents', docked && '[&>*]:animate-in [&>*]:fade-in-0 [&>*]:slide-in-from-top-1 [&>*]:duration-200 motion-reduce:[&>*]:animate-none')}><HeaderWidget docked={docked} /></span>}
          <Button
            type="button"
            onClick={onAdd}
            aria-label={t('addBookmark')}
            title={`${t('addBookmark')} (${formatShortcut(addBookmarkShortcut)})`}
            size="sm"
            variant={centered ? 'outline' : 'default'}
            className="shrink-0"
          >
            <Plus data-icon="inline-start" className={cn(centered && 'text-primary')} />
            <span className="hidden xl:inline">{t('addBookmark')}</span>
          </Button>
          <button
            type="button"
            aria-label={t('openSettings')}
            title={t('settings')}
            onClick={() => setSettingsOpen(true)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground shadow-sm ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Settings className="size-5" />
          </button>
          <HeaderMoreMenu open={healthOpen} onOpenChange={onHealthOpenChange} />
        </div>
      </div>

      <Suspense fallback={<LazyDialogFallback label={t('settings')} />}>
        {settingsOpen
          ? (
              <SettingsDialog
                open
                onOpenChange={setSettingsOpen}
              />
            )
          : null}
      </Suspense>
    </header>
  )
}
