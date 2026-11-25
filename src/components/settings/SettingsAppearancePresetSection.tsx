import type { StylePreset } from '~/components/settings/appearance-presets'
import { findStylePreset, STYLE_PRESETS } from '~/components/settings/appearance-presets'
import { Badge } from '~/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

export function SettingsAppearancePresetSection() {
  const { t } = useI18n()
  const appearance = useNavStore(state => state.settings.appearance)
  const setAppearance = useNavStore(state => state.setAppearance)
  const appearancePreset = findStylePreset(appearance)

  const applyPreset = (preset: StylePreset) => {
    void setAppearance(STYLE_PRESETS[preset].settings)
  }

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t('appearanceOverallStyle')}</h3>
            <Badge variant="outline" className={cn(!appearancePreset ? '' : 'invisible')}>
              {t('appearanceCustomized')}
            </Badge>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {t('appearanceOverallStyleDescription')}
          </p>
        </div>
      </div>
      <ToggleGroup
        type="single"
        value={appearancePreset}
        onValueChange={(value) => {
          if (value)
            applyPreset(value as StylePreset)
        }}
        variant="outline"
        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        aria-label={t('appearanceOverallStyle')}
      >
        {(
          Object.entries(STYLE_PRESETS) as Array<
            [StylePreset, (typeof STYLE_PRESETS)[StylePreset]]
          >
        ).map(([value, preset]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={t(preset.labelKey)}
            className={cn(
              'h-full min-h-20 w-full flex-col items-start justify-start gap-1 px-3 py-3 text-left',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              {t(preset.labelKey)}
              {preset.badgeKey
                ? <Badge variant="secondary">{t(preset.badgeKey)}</Badge>
                : null}
            </span>
            <span className="text-xs font-normal leading-5 text-muted-foreground">
              {t(preset.descriptionKey)}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {t('appearancePresetScopeDescription')}
      </p>
    </section>
  )
}
