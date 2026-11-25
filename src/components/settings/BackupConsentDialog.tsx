import type { MessageKey, TranslationParams } from '~/lib/i18n'
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
import { useI18n } from '~/lib/use-i18n'

interface Props {
  open: boolean
  titleKey: MessageKey
  destinationKey: MessageKey
  destinationParams?: TranslationParams
  credentialsKey: MessageKey
  actionKey: MessageKey
  /** 傳輸內容說明；預設為完整快照，讀取／測試入口改用讀取說明。 */
  dataKey?: MessageKey
  /** 自動備份額外需要說明的觸發行為。 */
  extraKey?: MessageKey
  onGranted: () => void
  onDenied: () => void
}

/**
 * 首次傳輸前的揭露與明示同意。內容固定包含：目的地、完整快照的資料類型、
 * 憑證儲存／同步方式，以及「開發者不接收不等於沒有第三方傳輸」。
 */
export function BackupConsentDialog({
  open,
  titleKey,
  destinationKey,
  destinationParams,
  credentialsKey,
  actionKey,
  dataKey = 'backupConsentSnapshot',
  extraKey,
  onGranted,
  onDenied,
}: Props) {
  const { t } = useI18n()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next)
          onDenied()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{t(dataKey)}</p>
              <p>{t(destinationKey, destinationParams)}</p>
              <p>{t(credentialsKey)}</p>
              {extraKey ? <p>{t(extraKey)}</p> : null}
              <p>{t('backupConsentNoDeveloper')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDenied}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onGranted}>{t(actionKey)}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
