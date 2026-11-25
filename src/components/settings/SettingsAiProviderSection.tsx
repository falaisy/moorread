import type { Dispatch, SetStateAction } from 'react'
import type { AiSettings } from '~/lib/ai-settings'
import type { Language } from '~/lib/types'
import { Bot, ChevronDown, KeyRound } from 'lucide-react'
import { SettingsAiConnectionFields } from '~/components/settings/SettingsAiConnectionFields'
import { SettingsAiModelFields } from '~/components/settings/SettingsAiModelFields'
import { SettingsAiPromptField } from '~/components/settings/SettingsAiPromptField'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

interface SettingsAiProviderSectionProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AiSettings
  onSettingsChange: Dispatch<SetStateAction<AiSettings>>
  token: string
  onTokenChange: (token: string) => void
  tokenVisible: boolean
  onToggleTokenVisibility: () => void
  models: string[]
  loadingModels: boolean
  onLoadModels: (verified?: boolean) => Promise<void>
  language: Language
  onSave: () => Promise<void>
  onClearToken: () => Promise<void>
}

export function SettingsAiProviderSection({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  token,
  onTokenChange,
  tokenVisible,
  onToggleTokenVisibility,
  models,
  loadingModels,
  onLoadModels,
  language,
  onSave,
  onClearToken,
}: SettingsAiProviderSectionProps) {
  const { t } = useI18n()

  return (
    <section className="rounded-xl border border-border bg-muted/35">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl p-4 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
              <Bot
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {t('aiProvider')}
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                {t('aiProviderDescription')}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-4 pb-4">
          <div className="grid gap-4 border-t border-border pt-4">
            <SettingsAiConnectionFields
              settings={settings}
              onSettingsChange={onSettingsChange}
              token={token}
              onTokenChange={onTokenChange}
              tokenVisible={tokenVisible}
              onToggleTokenVisibility={onToggleTokenVisibility}
            />

            <SettingsAiModelFields
              settings={settings}
              onSettingsChange={onSettingsChange}
              models={models}
              loadingModels={loadingModels}
              onLoadModels={onLoadModels}
            />

            <SettingsAiPromptField
              prompt={settings.prompt}
              language={language}
              onPromptChange={prompt =>
                onSettingsChange(current => ({ ...current, prompt }))}
            />

            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={settings.rememberToken}
                onCheckedChange={value =>
                  onSettingsChange(current => ({
                    ...current,
                    rememberToken: value === true,
                  }))}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">
                  {t('aiRememberToken')}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {t('aiRememberTokenHint')}
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              size="sm"
              onClick={() => void onSave()}
            >
              {t('aiSaveConfiguration')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loadingModels}
              onClick={() => void onLoadModels(true)}
            >
              {t('aiVerifyConfiguration')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void onClearToken()}
            >
              <KeyRound />
              {t('aiClearToken')}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
