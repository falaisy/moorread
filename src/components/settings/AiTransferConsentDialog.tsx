import type { AiTransferConsentKind } from '~/lib/ai-consent'
import { AI_CONSENT_DISCLOSED_FIELDS } from '~/components/settings/ai-consent-fields'
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
import { getAiConsentHost } from '~/lib/ai-consent'
import { useI18n } from '~/lib/use-i18n'

interface AiTransferConsentDialogProps {
  open: boolean
  kind: AiTransferConsentKind
  baseUrl: string
  onGranted: () => void
  onDenied: () => void
}

function displayHost(baseUrl: string): string {
  try {
    return getAiConsentHost(baseUrl)
  }
  catch {
    return baseUrl.trim()
  }
}

/**
 * 傳輸前的獨立同意視窗。只有按下同意按鈕才會建立授權；
 * 取消、關閉、Esc 或對話框未能顯示時都不會產生同意。
 */
export function AiTransferConsentDialog({
  open,
  kind,
  baseUrl,
  onGranted,
  onDenied,
}: AiTransferConsentDialogProps) {
  const { t } = useI18n()
  const host = displayHost(baseUrl)
  const classification = kind === 'classification'

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
          <AlertDialogTitle>
            {t(
              classification
                ? 'aiConsentClassificationTitle'
                : 'aiConsentConnectionTitle',
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {classification
                ? (
                    <>
                      <p>{t('aiConsentPurpose')}</p>
                      <p>{t('aiConsentDestination', { host })}</p>
                      <p>{t('aiConsentFieldsIntro')}</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {AI_CONSENT_DISCLOSED_FIELDS.map(({ field, labelKey }) => (
                          <li key={field}>{t(labelKey)}</li>
                        ))}
                      </ul>
                      <p>{t('aiConsentNotSent')}</p>
                      <p>{t('aiConsentToken')}</p>
                      <p>{t('aiConsentRetry')}</p>
                    </>
                  )
                : <p>{t('aiConsentConnectionBody', { host })}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDenied}>
            {t('aiConsentCancel')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onGranted}>
            {t(
              classification ? 'aiConsentAccept' : 'aiConsentConnectionAccept',
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
