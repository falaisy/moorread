import type { Dispatch, SetStateAction } from 'react'
import type { AiSettings } from '~/lib/ai-settings'
import { RefreshCw } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface SettingsAiModelFieldsProps {
  settings: AiSettings
  onSettingsChange: Dispatch<SetStateAction<AiSettings>>
  models: string[]
  loadingModels: boolean
  onLoadModels: (verified?: boolean) => Promise<void>
}

export function SettingsAiModelFields({
  settings,
  onSettingsChange,
  models,
  loadingModels,
  onLoadModels,
}: SettingsAiModelFieldsProps) {
  const { t } = useI18n()

  return (
    <>
      <div className="grid gap-1.5">
        <label htmlFor="ai-model" className="text-sm font-medium">
          {t('aiModel')}
        </label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            id="ai-model"
            list="ai-model-options"
            value={settings.model}
            onChange={event =>
              onSettingsChange(current => ({
                ...current,
                model: event.target.value,
              }))}
            placeholder="gpt-4.1-mini"
            spellCheck={false}
          />
          <datalist id="ai-model-options">
            {models.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingModels}
            onClick={() => void onLoadModels()}
          >
            <RefreshCw className={cn(loadingModels && 'animate-spin')} />
            {loadingModels ? t('aiFetchingModels') : t('aiFetchModels')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('aiManualModelHint')}
        </p>
      </div>

      <label className="grid gap-1.5 text-sm font-medium">
        {t('aiBatchSize')}
        <Input
          type="number"
          min={1}
          max={200}
          value={settings.batchSize}
          onChange={event =>
            onSettingsChange(current => ({
              ...current,
              batchSize: Number(event.target.value),
            }))}
          className="max-w-40"
        />
        <span className="text-xs font-normal leading-5 text-muted-foreground">
          {t('aiBatchSizeHint')}
        </span>
      </label>
    </>
  )
}
