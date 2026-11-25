import type { GistBackupConfig, GistErrorCode } from '~/lib/gist-backup'
import type { MessageKey } from '~/lib/i18n'
import type { ImportPreview } from '~/lib/import-preview'
import type { GistBackupSettings as GistBackupSettingsType } from '~/lib/types'
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { BackupConsentDialog } from '~/components/settings/BackupConsentDialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { runWithManualConsent } from '~/lib/backup-consent'
import {
  downloadFromGist,
  gistErrorCode,
  testGistToken,
  uploadToGist,
} from '~/lib/gist-backup'
import { createImportPreview } from '~/lib/import-preview'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

const errorMessageKeys: Record<GistErrorCode, MessageKey> = {
  token: 'gistErrorToken',
  api: 'gistErrorApi',
  decrypt: 'gistErrorDecrypt',
  empty: 'gistErrorApi',
}

interface Props {
  bookmarks: Array<{ url: string }>
  onRestore: (raw: string, preview: ImportPreview) => void
}

export function GistBackupSettings({ bookmarks, onRestore }: Props) {
  const { t } = useI18n()
  const settings = useNavStore(state => state.settings.gistBackup)
  const setSettings = useNavStore(state => state.setGistBackup)
  const exportFullBackup = useNavStore(state => state.exportFullBackup)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [lastGistId, setLastGistId] = useState<string>(settings.gistId)
  const [consentKind, setConsentKind] = useState<'upload' | 'read' | null>(null)
  const consentResolverRef = useRef<((granted: boolean) => void) | null>(null)

  const update = async (patch: Partial<GistBackupSettingsType>) => {
    try {
      await setSettings(patch)
      // 失敗提示只在恢復成功後清除，其他錯誤訊息維持原樣。
      setError(current => (current === 'gistSaveFailed' ? null : current))
    }
    catch {
      // 樂觀值保留在畫面上（不讓使用者重打），但必須明確告知尚未寫入。
      setError('gistSaveFailed')
    }
  }

  // 操作當下直接讀 store 的最新值，避免輸入後立刻點擊時拿到舊的 render 狀態。
  const latestConfig = (): GistBackupConfig => {
    const latest = useNavStore.getState().settings.gistBackup
    return {
      token: latest.token,
      gistId: latest.gistId || undefined,
      encrypt: latest.encrypt,
      passphrase: latest.encrypt ? latest.passphrase : undefined,
    }
  }

  // 上傳與讀取/測試分別同意；拒絕時完全不做任何事（不匯出、不發出請求）。
  const askConsent = (kind: 'upload' | 'read') => new Promise<boolean>((resolve) => {
    consentResolverRef.current = resolve
    setConsentKind(kind)
  })

  const settleConsent = (granted: boolean) => {
    setConsentKind(null)
    const resolve = consentResolverRef.current
    consentResolverRef.current = null
    resolve?.(granted)
  }

  const performUpload = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const config = latestConfig()
      const data = await exportFullBackup()
      const newGistId = await uploadToGist(config, data)
      setLastGistId(newGistId)
      if (newGistId !== useNavStore.getState().settings.gistBackup.gistId)
        await setSettings({ gistId: newGistId })
      setMessage('gistUploaded')
    }
    catch (cause) {
      setError(errorMessageKeys[gistErrorCode(cause)])
    }
    finally {
      setBusy(false)
    }
  }

  const performDownload = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const raw = await downloadFromGist(latestConfig())
      const preview = createImportPreview(
        raw,
        bookmarks.map(b => b.url),
        'full',
      )
      setMessage('gistDownloaded')
      onRestore(raw, preview)
    }
    catch (cause) {
      setError(errorMessageKeys[gistErrorCode(cause)])
    }
    finally {
      setBusy(false)
    }
  }

  const performTest = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      await testGistToken(latestConfig().token)
      setMessage('webdavConnected')
    }
    catch (cause) {
      setError(errorMessageKeys[gistErrorCode(cause)])
    }
    finally {
      setBusy(false)
    }
  }

  const handleUpload = async () => {
    if (!useNavStore.getState().settings.gistBackup.token.trim()) {
      setError('gistErrorToken')
      return
    }
    await runWithManualConsent('gist', () => askConsent('upload'), performUpload)
  }

  const handleDownload = async () => {
    const latest = useNavStore.getState().settings.gistBackup
    if (!latest.token.trim()) {
      setError('gistErrorToken')
      return
    }
    if (!latest.gistId.trim()) {
      setError('gistErrorApi')
      return
    }
    await runWithManualConsent('gist-read', () => askConsent('read'), performDownload)
  }

  const handleTest = async () => {
    if (!useNavStore.getState().settings.gistBackup.token.trim()) {
      setError('gistErrorToken')
      return
    }
    await runWithManualConsent('gist-read', () => askConsent('read'), performTest)
  }

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">{t('gistTitle')}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {t('gistTokenHint')}
      </p>
      <fieldset disabled={busy} className="mt-4 space-y-3">
        <label className="block space-y-1.5 text-sm">
          <span>{t('gistToken')}</span>
          <Input
            type="password"
            value={settings.token}
            onChange={e => void update({ token: e.target.value })}
            placeholder="ghp_..."
            autoComplete="off"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={settings.encrypt}
            onCheckedChange={c => void update({ encrypt: c === true })}
          />
          <span>{t('gistEncrypt')}</span>
        </label>
        {settings.encrypt && (
          <label className="block space-y-1.5 text-sm">
            <span>{t('gistPassphrase')}</span>
            <Input
              type="password"
              value={settings.passphrase}
              onChange={e => void update({ passphrase: e.target.value })}
              autoComplete="new-password"
            />
          </label>
        )}
        {lastGistId && (
          <p className="text-xs text-muted-foreground">
            {'Gist ID: '}
            <code className="font-mono">{lastGistId}</code>
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleTest()}
          >
            {t('gistTest')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleUpload()}
          >
            {t('gistUpload')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!settings.gistId.trim()}
            onClick={() => void handleDownload()}
          >
            {t('gistDownload')}
          </Button>
        </div>
      </fieldset>
      {busy && <Loader2 className="mt-3 h-4 w-4 animate-spin" aria-label={t('saving')} />}
      {message && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">{t(message)}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">{t(error)}</p>
      )}
      <BackupConsentDialog
        open={consentKind !== null}
        titleKey={consentKind === 'read' ? 'gistReadConsentTitle' : 'gistConsentTitle'}
        destinationKey={consentKind === 'read' ? 'gistReadConsentDestination' : 'gistConsentDestination'}
        credentialsKey="gistConsentCredentials"
        actionKey={consentKind === 'read' ? 'gistReadConsentAction' : 'gistConsentAction'}
        dataKey={consentKind === 'read' ? 'backupConsentReadData' : undefined}
        onGranted={() => settleConsent(true)}
        onDenied={() => settleConsent(false)}
      />
    </div>
  )
}
