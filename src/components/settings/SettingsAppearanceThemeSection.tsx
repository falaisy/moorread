import type { ThemeMode } from '~/lib/types'
import { THEME_OPTIONS } from '~/components/settings/appearance-options'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

export function SettingsAppearanceThemeSection() {
  const { t } = useI18n()
  const theme = useNavStore(state => state.settings.theme)
  const setTheme = useNavStore(state => state.setTheme)

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('appearanceLightDarkMode')}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {t('appearanceLightDarkModeDescription')}
      </p>
      <ToggleGroup
        type="single"
        value={theme}
        onValueChange={(value) => {
          if (value)
            void setTheme(value as ThemeMode)
        }}
        variant="outline"
        className="mt-3 grid grid-cols-3"
        aria-label={t('appearanceThemeMode')}
      >
        {THEME_OPTIONS.map(({ value, labelKey, shortLabelKey, Icon }) => (
          <ToggleGroupItem key={value} value={value} aria-label={t(labelKey)}>
            <Icon />
            <span className="hidden sm:inline">{t(labelKey)}</span>
            <span className="sm:hidden">{t(shortLabelKey)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  )
}
