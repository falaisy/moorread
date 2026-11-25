import type { ChromeBookmarkCandidate } from '~/lib/chrome-bookmark-sync'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { exportToChromeBookmarks, importFromChromeBookmarks } from '~/lib/chrome-bookmark-sync'
import { useBookmarks } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

interface Props {
  onImportConfirm: (items: ChromeBookmarkCandidate[]) => Promise<void>
}

export function ChromeBookmarkSyncSettings({ onImportConfirm }: Props) {
  const { t } = useI18n()
  const bookmarks = useBookmarks()

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<{
    items: ChromeBookmarkCandidate[]
    added: number
    skipped: number
  } | null>(null)

  const handleImport = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const { items, added, skipped } = await importFromChromeBookmarks(
        bookmarks.map(b => ({ url: b.url, name: b.name })),
      )
      setPendingImport({ items, added, skipped })
    }
    catch {
      setError(t('chromeSyncErrorPermission'))
    }
    finally {
      setBusy(false)
    }
  }

  const confirmImport = async () => {
    if (!pendingImport)
      return
    setBusy(true)
    try {
      await onImportConfirm(pendingImport.items)
      setMessage(
        t('chromeSyncImportedCount', {
          added: pendingImport.added,
          skipped: pendingImport.skipped,
        }),
      )
      setPendingImport(null)
    }
    finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const { created } = await exportToChromeBookmarks(
        bookmarks.map(b => ({ url: b.url, name: b.name })),
      )
      setMessage(t('chromeSyncExportedCount', { created }))
    }
    catch {
      setError(t('chromeSyncErrorPermission'))
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">{t('chromeSyncTitle')}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('chromeSyncExportFolderHint')}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void handleImport()}
        >
          {t('chromeSyncImport')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void handleExport()}
        >
          {t('chromeSyncExport')}
        </Button>
      </div>
      {pendingImport && (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="text-sm font-semibold">
            {t('chromeSyncImportedCount', {
              added: pendingImport.added,
              skipped: pendingImport.skipped,
            })}
          </p>
          {pendingImport.items.length > 0 && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {`共 ${pendingImport.items.length} 筆，確認匯入嗎？`}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void confirmImport()}
                >
                  {t('confirmImport')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPendingImport(null)}
                >
                  {t('cancel')}
                </Button>
              </div>
            </>
          )}
          {pendingImport.items.length === 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPendingImport(null)}
            >
              {t('cancel')}
            </Button>
          )}
        </div>
      )}
      {busy && <Loader2 className="mt-3 h-4 w-4 animate-spin" aria-label={t('saving')} />}
      {message && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
