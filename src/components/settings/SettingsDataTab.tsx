import type { ImportPreview } from '~/lib/import-preview'
import type { BackupImportResult, FullBackupRestoreResult } from '~/lib/store'
import { Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BackupConsentControls } from '~/components/settings/BackupConsentControls'
import { ChromeBookmarkSyncSettings } from '~/components/settings/ChromeBookmarkSyncSettings'
import { GistBackupSettings } from '~/components/settings/GistBackupSettings'
import { StorageMigrationPanel } from '~/components/settings/StorageMigrationPanel'
import { WebdavBackupSettings } from '~/components/settings/WebdavBackupSettings'
import { Button } from '~/components/ui/button'
import { createImportPreview } from '~/lib/import-preview'
import { useBookmarks, useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

export function SettingsDataTab() {
  const { t } = useI18n()
  const bookmarks = useBookmarks()
  const exportBackup = useNavStore(state => state.exportBackup)
  const importBackup = useNavStore(state => state.importBackup)
  const exportFullBackup = useNavStore(state => state.exportFullBackup)
  const restoreFullBackup = useNavStore(state => state.restoreFullBackup)
  const importInputRef = useRef<HTMLInputElement>(null)
  const fullRestoreInputRef = useRef<HTMLInputElement>(null)
  const [backupResult, setBackupResult] = useState<BackupImportResult | null>(
    null,
  )
  const [fullRestoreResult, setFullRestoreResult]
    = useState<FullBackupRestoreResult | null>(null)
  const [backupError, setBackupError] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const [importing, setImporting] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [pendingImport, setPendingImport] = useState<{
    raw: string
    preview: ImportPreview
  } | null>(null)
  const [importStrategy, setImportStrategy] = useState<
    'merge' | 'replace' | 'skip'
  >('merge')
  const [legacyConfirmPending, setLegacyConfirmPending] = useState(false)

  useEffect(() => {
    if (pendingImport)
      previewRef.current?.scrollIntoView({ block: 'nearest' })
  }, [pendingImport])

  const downloadBackup = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `moorread-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const prepareImport = async (
    file: File | undefined,
    kind: 'metadata' | 'full',
  ) => {
    if (!file)
      return
    setBackupResult(null)
    setBackupError('')
    setLegacyConfirmPending(false)
    try {
      const raw = await file.text()
      setPendingImport({
        raw,
        preview: createImportPreview(
          raw,
          bookmarks.map(bookmark => bookmark.url),
          kind,
        ),
      })
    }
    catch {
      setBackupError(t('backupPreviewFailed'))
    }
    finally {
      if (importInputRef.current)
        importInputRef.current.value = ''
      if (fullRestoreInputRef.current)
        fullRestoreInputRef.current.value = ''
    }
  }

  const cancelImport = () => {
    setPendingImport(null)
    setLegacyConfirmPending(false)
  }

  const confirmImport = async () => {
    if (!pendingImport || importing)
      return
    setImporting(true)
    setBackupError('')
    setRestoreProgress(null)
    try {
      if (pendingImport.preview.kind === 'metadata')
        setBackupResult(await importBackup(pendingImport.raw, importStrategy))
      else
        setFullRestoreResult(await restoreFullBackup(pendingImport.raw, (done, total) => setRestoreProgress({ done, total })))
      setPendingImport(null)
      setLegacyConfirmPending(false)
    }
    catch {
      setBackupError(t('backupImportFailed'))
    }
    finally {
      setRestoreProgress(null)
      setImporting(false)
    }
  }

  // 舊版備份在真正寫入前要再確認一次；取消時不呼叫任何還原動作。
  const requestImport = () => {
    if (!pendingImport || importing)
      return
    if (pendingImport.preview.legacy && !legacyConfirmPending) {
      setLegacyConfirmPending(true)
      return
    }
    void confirmImport()
  }

  const downloadFullBackup = async () => {
    setBackupError('')
    try {
      const blob = new Blob([await exportFullBackup()], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `moorread-full-snapshot-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    }
    catch {
      setBackupError(t('fullSnapshotExportFailed'))
    }
  }

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('dataBackup')}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {t('dataBackupDescription')}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={downloadBackup}>
          <Download className="mr-2 h-4 w-4" />
          {t('exportJson')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => importInputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t('importJson')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void downloadFullBackup()}
        >
          <Download className="mr-2 h-4 w-4" />
          {t('fullSnapshot')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => fullRestoreInputRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t('restoreSnapshot')}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          aria-label={t('chooseMetadataJson')}
          accept="application/json,.json"
          className="sr-only"
          onChange={event =>
            void prepareImport(event.target.files?.[0], 'metadata')}
        />
        <input
          ref={fullRestoreInputRef}
          type="file"
          aria-label={t('chooseFullSnapshotJson')}
          accept="application/json,.json"
          className="sr-only"
          onChange={event =>
            void prepareImport(event.target.files?.[0], 'full')}
        />
      </div>
      <WebdavBackupSettings onRestore={(raw) => {
        setBackupResult(null)
        setFullRestoreResult(null)
        setBackupError('')
        setLegacyConfirmPending(false)
        setPendingImport({ raw, preview: createImportPreview(raw, bookmarks.map(bookmark => bookmark.url), 'full') })
      }}
      />
      <GistBackupSettings
        bookmarks={bookmarks}
        onRestore={(raw, preview) => {
          setBackupResult(null)
          setFullRestoreResult(null)
          setBackupError('')
          setLegacyConfirmPending(false)
          setPendingImport({ raw, preview })
        }}
      />
      <ChromeBookmarkSyncSettings
        onImportConfirm={async () => { /* Chrome 書籤已存在，只需刷新顯示 */ }}
      />
      <BackupConsentControls />
      <StorageMigrationPanel />
      {pendingImport
        ? (
            <div ref={previewRef} className="mt-3 rounded-md border border-border bg-background p-3">
              <p className="text-sm font-semibold">{t('importPreview')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('importPreviewSummary', {
                  bookmarks: pendingImport.preview.bookmarkCount,
                  categories: pendingImport.preview.categoryCount,
                  conflicts: pendingImport.preview.conflictCount,
                })}
              </p>
              {pendingImport.preview.legacy
                ? (
                    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
                      <p className="text-xs font-semibold">{t('legacyBackupBadge')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('legacyBackupDescription')}
                      </p>
                    </div>
                  )
                : null}
              {pendingImport.preview.kind === 'metadata'
                ? (
                    <select
                      value={importStrategy}
                      disabled={importing}
                      onChange={event =>
                        setImportStrategy(event.target.value as typeof importStrategy)}
                      className="mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      aria-label={t('importConflictStrategy')}
                    >
                      <option value="merge">{t('mergeKeepLocalFields')}</option>
                      <option value="replace">{t('replaceWithBackup')}</option>
                      <option value="skip">{t('skipConflicts')}</option>
                    </select>
                  )
                : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('fullSnapshotRestoreDescription')}
                    </p>
                  )}
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={importing}
                  onClick={cancelImport}
                >
                  {t('cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={importing || legacyConfirmPending}
                  onClick={requestImport}
                >
                  {t('confirmImport')}
                </Button>
              </div>
              {legacyConfirmPending
                ? (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-background p-3">
                      <p className="text-xs text-muted-foreground">
                        {t('legacyBackupConfirmDescription')}
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={importing}
                          onClick={cancelImport}
                        >
                          {t('cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={importing}
                          onClick={() => void confirmImport()}
                        >
                          {t('legacyBackupConfirmAction')}
                        </Button>
                      </div>
                    </div>
                  )
                : null}
              {restoreProgress
                ? (
                    <p
                      className="mt-2 text-xs text-muted-foreground"
                      role="status"
                    >
                      {t('fullSnapshotRestoring', {
                        done: restoreProgress.done,
                        total: restoreProgress.total,
                      })}
                    </p>
                  )
                : null}
            </div>
          )
        : null}
      {backupResult
        ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('metadataRestoreSummary', {
                bookmarks: backupResult.bookmarkMetaCount,
                categories: backupResult.categoryMetaCount,
                usage: backupResult.usageCount,
              })}
            </p>
          )
        : null}
      {fullRestoreResult
        ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('fullRestoreSummary', {
                count: fullRestoreResult.restoredNodeCount,
                folder: fullRestoreResult.restoredFolderName,
              })}
            </p>
          )
        : null}
      {backupError
        ? (
            <p className="mt-3 text-xs text-destructive">{backupError}</p>
          )
        : null}
    </section>
  )
}
