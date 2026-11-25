import type { MigrationSummary } from '~/lib/migrate-yunji-storage'
import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { useBookmarkGroupsStore } from '~/lib/bookmark-groups-store'
import {
  inspectLegacyBookmarkGroupMigration,
  migrateLegacyBookmarkGroups,
} from '~/lib/migrate-yunji-storage'
import { useI18n } from '~/lib/use-i18n'

const kilo = 1024

function formatBytes(bytes: number): string {
  if (bytes < kilo)
    return `${bytes} B`
  return `${Math.ceil(bytes / kilo)} KB`
}

export function StorageMigrationPanel() {
  const { t } = useI18n()
  const [summary, setSummary] = useState<MigrationSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [migratedCount, setMigratedCount] = useState(0)
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    let active = true
    void inspectLegacyBookmarkGroupMigration().then((next) => {
      if (active)
        setSummary(next)
    })
    return () => {
      active = false
    }
  }, [])

  const run = async () => {
    if (busy)
      return
    setBusy(true)
    setFeedback(null)
    try {
      const report = await migrateLegacyBookmarkGroups()
      setSummary(report)
      setMigratedCount(report.migrated.length)
      if (report.migrated.length)
        void useBookmarkGroupsStore.getState().load().catch(() => undefined)
      setFeedback(report.failed.length || report.pendingGroupCount > 0 ? 'error' : 'success')
    }
    catch {
      setFeedback('error')
    }
    finally {
      // 重新讀取容量與資料量，畫面不沿用按下按鈕前的估算。
      const fresh = await inspectLegacyBookmarkGroupMigration()
      setSummary(fresh)
      setBusy(false)
    }
  }

  const status = (() => {
    if (!summary)
      return t('migrationPhase1Running')
    if (busy)
      return t('migrationRunning')
    if (summary.reason === 'unavailable')
      return t('migrationUnavailable')
    if (summary.phase2 === 'not-needed')
      return t('migrationNothingToMigrate')
    if (summary.phase2 === 'complete')
      return t('migrationComplete')
    if (summary.phase2 === 'insufficient-space')
      return t('migrationCapacityShort')
    if (summary.phase2 === 'partial')
      return t('migrationPartial')
    if (summary.phase1 === 'partial')
      return t('migrationPhase1Partial')
    if (summary.phase1 === 'complete')
      return t('migrationWaiting')
    return t('migrationPhase1NotStarted')
  })()

  // 容量不足時仍允許按下：按下後會重新讀取資料與容量，狀態可能已經改變。
  const canStart = !busy && !!summary && summary.pendingGroupCount > 0
    && summary.reason !== 'unavailable'

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">{t('storageMigrationTitle')}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('storageMigrationDescription')}
      </p>
      <p className="mt-2 text-sm" role="status">
        {status}
      </p>
      {summary && summary.pendingGroupCount > 0
        ? (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>
                {t('migrationPendingSummary', {
                  groups: summary.pendingGroupCount,
                  bookmarks: summary.pendingBookmarkCount,
                  needed: formatBytes(summary.pendingBytes),
                })}
              </p>
              <p>
                {t('migrationAvailableSummary', {
                  available: formatBytes(summary.availableBytes),
                  quota: formatBytes(summary.quotaBytes),
                })}
              </p>
              {summary.reason === 'insufficient-space'
                ? <p className="text-destructive">{t('migrationCapacityShort')}</p>
                : null}
            </div>
          )
        : null}
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" disabled={!canStart} onClick={() => void run()}>
          {summary?.phase2 === 'partial' || summary?.phase2 === 'insufficient-space'
            ? t('migrationRetry')
            : t('migrationStart')}
        </Button>
        {feedback === 'success' && migratedCount > 0
          ? <span className="text-xs text-muted-foreground">{t('migrationFinished', { count: migratedCount })}</span>
          : null}
        {feedback === 'error'
          ? <span className="text-xs text-destructive">{t('migrationFailed')}</span>
          : null}
      </div>
    </div>
  )
}
