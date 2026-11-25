import {
  AlignCenter,
  Ellipsis,
  FolderClock,
  HeartPulse,
  History,
  ListTodo,
  PanelTop,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LazyDialogFallback } from '~/components/LazyDialogFallback'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { reportExpectedFallback } from '~/lib/diagnostics'
import { runHomeLayoutTransition } from '~/lib/home-layout-transition'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

const loadActivityDialog = () => import('~/components/ActivityDialog')
function loadBookmarkHealthDialog() {
  return import('~/components/BookmarkHealthDialog')
}
const loadTabSessionsDialog = () => import('~/components/TabSessionsDialog')
const loadTaskCenterDialog = () => import('~/components/TaskCenterDialog')

const ActivityDialog = lazy(() =>
  loadActivityDialog().then(module => ({
    default: module.ActivityDialog,
  })),
)
const BookmarkHealthDialog = lazy(() =>
  loadBookmarkHealthDialog().then(module => ({
    default: module.BookmarkHealthDialog,
  })),
)
const TabSessionsDialog = lazy(() =>
  loadTabSessionsDialog().then(module => ({
    default: module.TabSessionsDialog,
  })),
)
const TaskCenterDialog = lazy(() =>
  loadTaskCenterDialog().then(module => ({
    default: module.TaskCenterDialog,
  })),
)

interface HeaderMoreMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type HeaderTool = 'health' | 'activity' | 'tasks' | 'sessions'

export function HeaderMoreMenu({ open, onOpenChange }: HeaderMoreMenuProps) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<HeaderTool | null>(null)
  const tasks = useNavStore(state => state.tasks)
  const runningCount = tasks.filter(task => task.state === 'running').length
  const errorCount = tasks.filter(task => task.state === 'error').length
  const attentionCount = runningCount + errorCount
  const centered = useNavStore(state => state.settings.appearance.homeLayout === 'centered')
  const setAppearance = useNavStore(state => state.setAppearance)
  const layoutSwitchPendingRef = useRef(false)

  useEffect(() => {
    setActiveTool(current =>
      open ? 'health' : current === 'health' ? null : current,
    )
  }, [open])

  const preloadDialogs = useCallback(() => {
    void Promise.all([
      loadActivityDialog(),
      loadBookmarkHealthDialog(),
      loadTabSessionsDialog(),
      loadTaskCenterDialog(),
    ]).catch(cause => reportExpectedFallback('dialog.preload', cause))
  }, [])

  useEffect(() => {
    if (open)
      preloadDialogs()
  }, [open, preloadDialogs])

  const openTool = (tool: HeaderTool) => {
    setMenuOpen(false)
    setActiveTool(tool)
    if (tool === 'health')
      onOpenChange(true)
  }

  const handleToolOpenChange = (tool: HeaderTool, nextOpen: boolean) => {
    if (!nextOpen)
      setActiveTool(current => (current === tool ? null : current))
    if (tool === 'health')
      onOpenChange(nextOpen)
  }

  const activeToolLabel
    = activeTool === 'health'
      ? t('bookmarkHealth')
      : activeTool === 'activity'
        ? t('trashAndHistory')
        : activeTool === 'tasks'
          ? t('taskCenter')
          : t('tabSessions')

  return (
    <div className="relative">
      <DropdownMenu
        modal={false}
        open={menuOpen}
        onOpenChange={(next) => {
          if (next)
            preloadDialogs()
          setMenuOpen(next)
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('moreActions')}
            onMouseEnter={preloadDialogs}
            onFocus={preloadDialogs}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground shadow-sm ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Ellipsis className="size-5" />
            {attentionCount > 0
              ? (
                  <span
                    className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${errorCount > 0 ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
                  >
                    {attentionCount}
                  </span>
                )
              : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-56"
          onCloseAutoFocus={() => {
            if (!layoutSwitchPendingRef.current)
              return
            layoutSwitchPendingRef.current = false
            runHomeLayoutTransition(() => {
              void setAppearance({ homeLayout: centered ? 'workspace' : 'centered' })
            })
          }}
        >
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {t('managementTools')}
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              aria-label={t('openBookmarkHealth')}
              onSelect={() => openTool('health')}
            >
              <HeartPulse />
              <span>{t('bookmarkHealth')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              aria-label={t('openTrashAndHistory')}
              onSelect={() => openTool('activity')}
            >
              <History />
              <span>{t('trashAndHistory')}</span>
            </DropdownMenuItem>
            {attentionCount > 0
              ? (
                  <DropdownMenuItem
                    aria-label={t('openTaskCenter')}
                    onSelect={() => openTool('tasks')}
                  >
                    <ListTodo />
                    <span>{t('taskCenter')}</span>
                  </DropdownMenuItem>
                )
              : null}
            <DropdownMenuItem
              aria-label={t('manageTabSessions')}
              onSelect={() => openTool('sessions')}
            >
              <FolderClock />
              <span>{t('tabSessions')}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => { layoutSwitchPendingRef.current = true }}>
              {centered ? <PanelTop /> : <AlignCenter />}
              <span>{t(centered ? 'switchToWorkspaceLayout' : 'switchToCenteredLayout')}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Suspense fallback={<LazyDialogFallback label={activeToolLabel} />}>
        {activeTool === 'health'
          ? (
              <BookmarkHealthDialog
                open
                onOpenChange={nextOpen =>
                  handleToolOpenChange('health', nextOpen)}
              />
            )
          : null}
        {activeTool === 'activity'
          ? (
              <ActivityDialog
                open
                onOpenChange={nextOpen =>
                  handleToolOpenChange('activity', nextOpen)}
              />
            )
          : null}
        {activeTool === 'tasks'
          ? (
              <TaskCenterDialog
                open
                onOpenChange={nextOpen => handleToolOpenChange('tasks', nextOpen)}
              />
            )
          : null}
        {activeTool === 'sessions'
          ? (
              <TabSessionsDialog
                open
                onOpenChange={nextOpen =>
                  handleToolOpenChange('sessions', nextOpen)}
              />
            )
          : null}
      </Suspense>
    </div>
  )
}
