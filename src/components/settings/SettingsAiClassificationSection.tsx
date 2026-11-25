import type { AiClassificationRecovery } from '~/lib/ai-classification-apply'
import type { AiClassificationJobSnapshot } from '~/lib/ai-classification-job'
import { RotateCcw, ShieldCheck, Sparkles, Square } from 'lucide-react'
import { resolveAiErrorMessageKey } from '~/components/settings/settings-ai-error-message'
import { Button } from '~/components/ui/button'
import {
  pauseAiClassificationJob,
  terminateAiClassificationJob,
} from '~/lib/ai-classification-job'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface SettingsAiClassificationSectionProps {
  job: AiClassificationJobSnapshot
  jobActive: boolean
  jobControllable: boolean
  status: string
  error: string
  recovery: AiClassificationRecovery | null
  bookmarkCount: number
  onGeneratePreview: () => Promise<void>
  onResumePreview: () => Promise<void>
  onShowSavedPreview: () => void
  onUndo: () => Promise<void>
}

export function SettingsAiClassificationSection({
  job,
  jobActive,
  jobControllable,
  status,
  error,
  recovery,
  bookmarkCount,
  onGeneratePreview,
  onResumePreview,
  onShowSavedPreview,
  onUndo,
}: SettingsAiClassificationSectionProps) {
  const { t } = useI18n()

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t('aiClassification')}</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {t('aiClassificationDescription')}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-background p-3 ring-1 ring-border/70">
        <div className="flex items-start gap-2">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium">{t('aiPrivacyNotice')}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('aiPrivacyDescription')}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {job.status === 'idle'
              ? t('aiPreviewOnly')
              : t('aiGeneratingPreview', {
                  completed: job.completed,
                  total: job.total,
                })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('aiProgressPersists')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {jobActive && jobControllable
            ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={pauseAiClassificationJob}
                >
                  {job.status === 'pausing' ? t('aiPausing') : t('aiPause')}
                </Button>
              )
            : null}
          {(job.status === 'paused'
            || (job.status === 'error' && job.completed < job.total))
            ? (
                <Button type="button" onClick={() => void onResumePreview()}>
                  <Sparkles />
                  {t('aiResume')}
                </Button>
              )
            : null}
          {jobControllable
            && ['running', 'pausing', 'paused'].includes(job.status)
            ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => terminateAiClassificationJob()}
                >
                  <Square />
                  {t('aiTerminate')}
                </Button>
              )
            : null}
          {job.suggestions.length > 0
            && ['completed', 'terminated', 'error'].includes(job.status)
            ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onShowSavedPreview}
                >
                  {t('aiViewPreview')}
                </Button>
              )
            : null}
          {!jobActive && job.status !== 'paused'
            ? (
                <Button
                  type="button"
                  disabled={bookmarkCount === 0}
                  onClick={() => void onGeneratePreview()}
                >
                  <Sparkles />
                  {t('aiGeneratePreview')}
                </Button>
              )
            : null}
        </div>
      </div>

      {job.total > 0 && job.status !== 'idle'
        ? (
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={job.total}
              aria-valuenow={job.completed}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.min(100, (job.completed / job.total) * 100)}%`,
                }}
              />
            </div>
          )
        : null}

      <p
        className={cn(
          'mt-2 min-h-5 text-sm',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
        role={error ? 'alert' : 'status'}
        aria-live="polite"
      >
        {error
          || (jobActive && job.retryAttempt > 0
            ? t('aiRetryingRequest', {
                attempt: job.retryAttempt,
                max: job.retryMax,
              })
            : '')
          || (job.status === 'error'
            ? t(resolveAiErrorMessageKey(new Error(job.error)))
            : '')
          || (job.status === 'paused' ? t('aiPaused') : '')
          || (job.status === 'terminated' ? t('aiTerminated') : '')
          || (job.status === 'completed' && job.suggestions.length === 0
            ? t('aiNoSuggestions')
            : '')
          || status}
      </p>

      {recovery
        ? (
            <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {t('aiUndoAvailable')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onUndo()}
              >
                <RotateCcw />
                {t('aiUndo')}
              </Button>
            </div>
          )
        : null}
    </section>
  )
}
