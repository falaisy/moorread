import type { JobRecord, NativeSortCriterion, NativeSortDirection, NativeSortField } from '~/lib/bookmark-native-sort'
import type { MessageKey } from '~/lib/i18n'
import type { NativeBookmarkSortSettings, NativeSortScope } from '~/lib/types'
import { ArrowDownAZ, ArrowUpAZ, FolderTree, Minus, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BookmarkFolderPickerDialog } from '~/components/settings/BookmarkFolderPickerDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { MAX_SORT_CRITERIA, nativeSortExecutor, restoreNativeBookmarks, sortNativeBookmarks } from '~/lib/bookmark-native-sort'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

const FIELD_OPTIONS: Array<{ value: NativeSortField, labelKey: MessageKey }> = [
  { value: 'title', labelKey: 'nativeSortFieldTitle' },
  { value: 'url', labelKey: 'nativeSortFieldUrl' },
  { value: 'dateAdded', labelKey: 'nativeSortFieldDateAdded' },
  { value: 'dateLastUsed', labelKey: 'nativeSortFieldDateLastUsed' },
] as const

const DIRECTION_OPTIONS: Array<{ value: NativeSortDirection, labelKey: MessageKey, Icon: typeof ArrowUpAZ }> = [
  { value: 'asc', labelKey: 'nativeSortDirectionAsc', Icon: ArrowUpAZ },
  { value: 'desc', labelKey: 'nativeSortDirectionDesc', Icon: ArrowDownAZ },
] as const

const SCOPE_OPTIONS: Array<{
  value: NativeSortScope
  labelKey: MessageKey
  hintKey: MessageKey
}> = [
  {
    value: 'all',
    labelKey: 'nativeSortScopeAll',
    hintKey: 'nativeSortScopeAllHint',
  },
  {
    value: 'selected-with-sub',
    labelKey: 'nativeSortScopeSelectedWithSub',
    hintKey: 'nativeSortScopeSelectedWithSubHint',
  },
  {
    value: 'children-only',
    labelKey: 'nativeSortScopeChildrenOnly',
    hintKey: 'nativeSortScopeChildrenOnlyHint',
  },
] as const

interface SortRunResult {
  foldersProcessed: number
  movedBookmarks: number
  movedFolders: number
  skipped: number
}

export function SettingsNativeSortTab() {
  const { t } = useI18n()
  const settings = useNavStore(state => state.settings.nativeBookmarkSort)
  const setSettings = useNavStore(state => state.setNativeBookmarkSort)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SortRunResult | null>(null)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [ignorePickerOpen, setIgnorePickerOpen] = useState(false)
  const [job, setJob] = useState<JobRecord | null>(null)

  // 輪詢執行器工作狀態（SW 休眠/重啟後的中斷工作需要讓使用者看見並處置）
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const j = await nativeSortExecutor.getJob()
      if (!cancelled)
        setJob(j)
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const update = (patch: Partial<NativeBookmarkSortSettings>) => {
    void setSettings(patch)
  }

  const handlePickerConfirm = (ids: string[]) => {
    update({ targetFolderIds: ids })
  }

  const handleIgnorePickerConfirm = (ids: string[]) => {
    update({ ignoreFolderIds: ids })
  }

  /** 新增一個排序依據（預設 title asc） */
  const addCriterion = () => {
    if (settings.sortCriteria.length >= MAX_SORT_CRITERIA)
      return
    const next: NativeSortCriterion = { field: 'title', direction: 'asc' }
    update({ sortCriteria: [...settings.sortCriteria, next] })
  }

  /** 刪除第 index 個排序依據 */
  const removeCriterion = (index: number) => {
    if (settings.sortCriteria.length <= 1)
      return
    const next = [...settings.sortCriteria]
    next.splice(index, 1)
    update({ sortCriteria: next })
  }

  /** 更新第 index 個排序依據的欄位 */
  const setCriterionField = (index: number, field: NativeSortField) => {
    const next = settings.sortCriteria.map((c, i) =>
      i === index ? { ...c, field } : c,
    )
    update({ sortCriteria: next })
  }

  /** 更新第 index 個排序依據的方向 */
  const setCriterionDirection = (index: number, direction: NativeSortDirection) => {
    const next = settings.sortCriteria.map((c, i) =>
      i === index ? { ...c, direction } : c,
    )
    update({ sortCriteria: next })
  }

  /** scope 改變時，同步更新舊欄位確保降版不壞 */
  const handleScopeChange = (scope: NativeSortScope) => {
    const patch: Partial<NativeBookmarkSortSettings> = { scope }
    // 雙寫舊欄位（deprecated）
    if (scope === 'all') {
      patch.targetMode = 'all'
      patch.includeSubfolders = true
    }
    else {
      patch.targetMode = 'selected'
      patch.includeSubfolders = true
      if (scope === 'children-only') {
        patch.sortSelf = false
      }
    }
    update(patch)
  }

  const needsFolderSelection = settings.scope !== 'all'

  const runSort = async () => {
    setError('')
    setResult(null)
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      setError(t('nativeSortNoApi'))
      return
    }
    if (needsFolderSelection && settings.targetFolderIds.length === 0) {
      setError(t('nativeSortNothingToDo'))
      return
    }
    setConfirmOpen(false)
    setRunning(true)
    try {
      const res = await sortNativeBookmarks({
        scope: settings.scope ?? 'all',
        targetFolderIds: needsFolderSelection ? settings.targetFolderIds : [],
        ignoreFolderIds: settings.ignoreFolderIds,
        sortCriteria: settings.sortCriteria,
        sortSelf: settings.sortSelf,
        sortMode: settings.sortMode,
        randomSeed: settings.randomSeed,
        pinnedTop: settings.pinnedTop,
        pinnedBottom: settings.pinnedBottom,
        foldersFirst: settings.foldersFirst,
        folderRules: settings.folderRules,
      })
      const summary: SortRunResult = {
        foldersProcessed: res.foldersProcessed,
        movedBookmarks: res.movedBookmarks,
        movedFolders: res.movedFolders,
        skipped: res.skipped.length,
      }
      // 只有 status === 'completed' 才能宣稱成功；其餘一律顯示錯誤。
      if (res.status !== 'completed') {
        setResult(null)
        const message = res.error
          ?? (res.verificationFailures > 0
            ? t('nativeSortVerifyFailed', { folders: res.verificationFailures })
            : res.status)
        setError(t('nativeSortFailed', { message }))
        return
      }
      setResult(summary)
      if (res.movedBookmarks === 0 && res.foldersProcessed === 0) {
        setError(t('nativeSortNothingToDo'))
      }
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(t('nativeSortFailed', { message }))
    }
    finally {
      setRunning(false)
    }
  }

  return (
    <>
      {/* 啟用 */}
      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="native-sort-enable" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-semibold">{t('nativeSort')}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {t('nativeSortDescription')}
            </span>
          </label>
          <Switch
            id="native-sort-enable"
            checked={settings.enabled}
            onCheckedChange={value => update({ enabled: value })}
          />
        </div>
      </section>

      {settings.enabled
        ? (
            <>
              {/* 中斷工作橫幅（SW 休眠/重啟、外部變動、失敗） */}
              {job && job.status !== 'completed' && (
                <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        {job.kind === 'restore'
                          ? job.status === 'active'
                            ? t('nativeSortJobActiveRestore')
                            : t('nativeSortJobPendingRestore')
                          : job.status === 'active'
                            ? t('nativeSortJobActiveSort')
                            : t('nativeSortJobPendingSort')}
                      </p>
                      <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
                        {job.status === 'awaiting-user'
                          ? t('nativeSortJobAwaitingUser')
                          : job.status === 'stopped-external'
                            ? t('nativeSortJobStoppedExternal')
                            : job.status === 'failed'
                              ? t('nativeSortFailed', { message: job.error ?? '' })
                              : t('nativeSortJobProcessing')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {job.status === 'awaiting-user' && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void nativeSortExecutor.resumeAfterRestart()
                          }}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          {t('nativeSortJobResume')}
                        </Button>
                      )}
                      {job.status !== 'active' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void restoreNativeBookmarks()
                          }}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          {t('nativeSortJobRestore')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void nativeSortExecutor.discardJob()
                        }}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t('nativeSortJobDiscard')}
                      </Button>
                    </div>
                  </div>
                </section>
              )}

              {/* 排什麼（scope 三選一） */}
              <section className="rounded-xl border border-border bg-muted/35 p-4">
                <h3 className="text-sm font-semibold">{t('nativeSortScopeTitle')}</h3>
                <div className="mt-3 space-y-2">
                  {SCOPE_OPTIONS.map((opt) => {
                    const selected = (settings.scope ?? 'all') === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => handleScopeChange(opt.value)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          selected
                            ? 'border-primary bg-primary/5'
                            : 'border-border/60 bg-background/60 hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                            selected
                              ? 'border-primary'
                              : 'border-muted-foreground/40'
                          }`}
                        >
                          {selected && (
                            <span className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {t(opt.labelKey)}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {t(opt.hintKey)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* 選資料夾按鈕（scope !== 'all' 時顯示） */}
                {needsFolderSelection && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/60 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {settings.targetFolderIds.length > 0
                        ? t('nativeSortSelectedCount', { count: settings.targetFolderIds.length })
                        : t('nativeSortNoSelection')}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerOpen(true)}
                    >
                      <FolderTree className="mr-1.5 size-3.5" />
                      {t('nativeSortSelectFolders')}
                    </Button>
                  </div>
                )}

                {/* 永不排序的資料夾（黑名單，不管什麼 scope 都生效） */}
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/50 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    {settings.ignoreFolderIds.length > 0
                      ? t('nativeSortExcludedCount', { count: settings.ignoreFolderIds.length })
                      : t('nativeSortExcludeFoldersDescription')}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIgnorePickerOpen(true)}
                  >
                    <FolderTree className="mr-1.5 size-3.5" />
                    {t('nativeSortExcludeFolders')}
                  </Button>
                </div>

                {/* sortSelf 獨立開關 */}
                {settings.scope !== 'children-only' && (
                  <div className="mt-3 flex items-center justify-between gap-4 rounded-md border border-border/50 bg-background/40 px-3 py-2.5">
                    <label htmlFor="native-sort-self" className="min-w-0 cursor-pointer">
                      <span className="block text-xs font-medium">
                        {t('nativeSortSortSelf')}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        {t('nativeSortSortSelfDescription')}
                      </span>
                    </label>
                    <Switch
                      id="native-sort-self"
                      checked={settings.sortSelf}
                      onCheckedChange={value => update({ sortSelf: value })}
                    />
                  </div>
                )}
              </section>

              {/* 怎麼排（排序依據） */}
              <section className="rounded-xl border border-border bg-muted/35 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t('nativeSortCriteria')}</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addCriterion}
                    disabled={settings.sortCriteria.length >= MAX_SORT_CRITERIA}
                    className="h-7 gap-1"
                  >
                    <Plus className="size-3.5" />
                    {t('nativeSortAddCriterion')}
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {settings.sortCriteria.map((criterion, index) => (
                    <div
                      key={index}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/60 p-2.5"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <select
                        value={criterion.field}
                        onChange={event =>
                          setCriterionField(index, event.target.value as NativeSortField)}
                        className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-sm shadow-sm"
                      >
                        {FIELD_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </select>
                      <ToggleGroup
                        type="single"
                        value={criterion.direction}
                        onValueChange={(value) => {
                          if (value)
                            setCriterionDirection(index, value as NativeSortDirection)
                        }}
                        variant="outline"
                        size="sm"
                        className="grid shrink-0 grid-cols-2"
                      >
                        {DIRECTION_OPTIONS.map(({ value, Icon }) => (
                          <ToggleGroupItem key={value} value={value} aria-label={value}>
                            <Icon className="size-3.5" />
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCriterion(index)}
                        disabled={settings.sortCriteria.length <= 1}
                        className="h-8 w-8 shrink-0 px-0"
                        aria-label={t('nativeSortRemoveCriterion')}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('nativeSortCriteriaHint', { max: MAX_SORT_CRITERIA })}
                </p>
              </section>

              {/* 自動重排 + 執行 */}
              <section className="rounded-xl border border-border bg-muted/35 p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="native-sort-autosort" className="min-w-0 cursor-pointer">
                    <span className="block text-sm font-medium">
                      {t('nativeSortAutoSort')}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t('nativeSortAutoSortDescription')}
                    </span>
                  </label>
                  <Switch
                    id="native-sort-autosort"
                    checked={settings.autoSort}
                    onCheckedChange={value => update({ autoSort: value })}
                  />
                </div>

                <Button
                  type="button"
                  className="w-full shadow-sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={
                    running
                    || (needsFolderSelection && settings.targetFolderIds.length === 0)
                  }
                >
                  <Play className="mr-2 h-4 w-4" />
                  {running ? t('nativeSortRunning') : t('nativeSortRun')}
                </Button>

                {needsFolderSelection && settings.targetFolderIds.length === 0 && !running && (
                  <p className="text-xs text-muted-foreground">
                    {t('nativeSortNoSelection')}
                  </p>
                )}

                {result
                  ? (
                      <div className="rounded-md border border-border/60 bg-background/60 px-3 py-2">
                        <p className="text-sm">
                          {result.skipped > 0
                            ? t('nativeSortPartial', {
                                folders: result.foldersProcessed,
                                bookmarks: result.movedBookmarks,
                                movedFolders: result.movedFolders,
                                skipped: result.skipped,
                              })
                            : t('nativeSortSuccess', {
                                folders: result.foldersProcessed,
                                bookmarks: result.movedBookmarks,
                                movedFolders: result.movedFolders,
                              })}
                        </p>
                      </div>
                    )
                  : null}

                {error
                  ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                        <p className="text-sm text-destructive">{error}</p>
                      </div>
                    )
                  : null}
              </section>
            </>
          )
        : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('nativeSortRun')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('nativeSortWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSort()} disabled={running}>
              {running ? t('nativeSortRunning') : t('nativeSortRun')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BookmarkFolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialIds={settings.targetFolderIds}
        onConfirm={handlePickerConfirm}
      />

      <BookmarkFolderPickerDialog
        open={ignorePickerOpen}
        onOpenChange={setIgnorePickerOpen}
        initialIds={settings.ignoreFolderIds}
        onConfirm={handleIgnorePickerConfirm}
        titleKey="nativeSortExcludeFolders"
        descriptionKey="nativeSortExcludeFoldersDescription"
      />
    </>
  )
}
