import type { Dispatch, SetStateAction } from 'react'
import type { AiSettings } from '~/lib/ai-settings'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '~/components/ui/input'
import { useI18n } from '~/lib/use-i18n'

interface SettingsAiConnectionFieldsProps {
  settings: AiSettings
  onSettingsChange: Dispatch<SetStateAction<AiSettings>>
  token: string
  onTokenChange: (token: string) => void
  tokenVisible: boolean
  onToggleTokenVisibility: () => void
}

export function SettingsAiConnectionFields({
  settings,
  onSettingsChange,
  token,
  onTokenChange,
  tokenVisible,
  onToggleTokenVisibility,
}: SettingsAiConnectionFieldsProps) {
  const { t } = useI18n()

  return (
    <>
      <label className="grid gap-1.5 text-sm font-medium">
        {t('aiBaseUrl')}
        <Input
          type="url"
          value={settings.baseUrl}
          onChange={event =>
            onSettingsChange(current => ({
              ...current,
              baseUrl: event.target.value,
            }))}
          placeholder="https://api.openai.com/v1"
          spellCheck={false}
        />
      </label>

      <div className="grid gap-1.5">
        <label htmlFor="ai-token" className="text-sm font-medium">
          {t('aiToken')}
        </label>
        <span className="relative block">
          <Input
            id="ai-token"
            type={tokenVisible ? 'text' : 'password'}
            value={token}
            onChange={event => onTokenChange(event.target.value)}
            placeholder="sk-..."
            className="pr-11"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            aria-label={t(tokenVisible ? 'aiHideToken' : 'aiShowToken')}
            className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onToggleTokenVisibility}
          >
            {tokenVisible
              ? (
                  <EyeOff className="size-4" />
                )
              : (
                  <Eye className="size-4" />
                )}
          </button>
        </span>
      </div>
    </>
  )
}
