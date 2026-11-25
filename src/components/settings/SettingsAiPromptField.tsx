import type { Language } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { getDefaultAiClassificationPrompt } from '~/lib/ai-settings'
import { useI18n } from '~/lib/use-i18n'

interface SettingsAiPromptFieldProps {
  prompt: string
  language: Language
  onPromptChange: (prompt: string) => void
}

export function SettingsAiPromptField({
  prompt,
  language,
  onPromptChange,
}: SettingsAiPromptFieldProps) {
  const { t } = useI18n()

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="ai-prompt" className="text-sm font-medium">
          {t('aiPrompt')}
        </label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onPromptChange(getDefaultAiClassificationPrompt(language))}
        >
          {t('aiResetPrompt')}
        </Button>
      </div>
      <textarea
        id="ai-prompt"
        value={prompt}
        onChange={event => onPromptChange(event.target.value)}
        rows={5}
        className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm leading-6 shadow-sm ring-offset-background transition-colors placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
