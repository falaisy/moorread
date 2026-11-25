import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { revokeBackupConsent } from '~/lib/backup-consent'
import { useI18n } from '~/lib/use-i18n'

/**
 * 撤回所有備份傳輸同意。撤回後 gate 立即視為未同意：
 * 自動備份停止、手動上傳與讀取都會重新詢問；既有設定與憑證保留。
 */
export function BackupConsentControls() {
  const { t } = useI18n()
  const [confirming, setConfirming] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  // 只有 storage 真正移除成功才顯示成功；失敗時保留原同意狀態並讓使用者重試。
  const revoke = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await revokeBackupConsent()
      setRevoked(true)
      setConfirming(false)
    }
    catch {
      setFailed(true)
    }
    finally {
      setBusy(false)
    }
  }

  const cancelConfirm = () => {
    setFailed(false)
    setConfirming(false)
  }

  return (
    <div className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">{t('backupConsentManageTitle')}</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('backupConsentManageBody')}</p>
      {confirming
        ? (
            <div role="group" aria-label={t('backupConsentRevokeConfirm')} className="mt-3 space-y-2">
              <p role="alert" className="text-xs text-destructive">{t('backupConsentRevokeConfirm')}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke()}>
                  {t('backupConsentRevokeAction')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelConfirm}>
                  {t('cancel')}
                </Button>
              </div>
              {failed ? <p role="alert" className="text-xs text-destructive">{t('backupConsentRevokeFailed')}</p> : null}
            </div>
          )
        : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setRevoked(false)
                setConfirming(true)
              }}
            >
              {t('backupConsentRevoke')}
            </Button>
          )}
      {revoked ? <p role="status" className="mt-3 text-xs text-muted-foreground">{t('backupConsentRevoked')}</p> : null}
    </div>
  )
}
