import { SettingsAppearanceBackgroundSection } from '~/components/settings/SettingsAppearanceBackgroundSection'
import { SettingsAppearanceFontSection } from '~/components/settings/SettingsAppearanceFontSection'
import { SettingsAppearancePaletteSection } from '~/components/settings/SettingsAppearancePaletteSection'
import { SettingsAppearanceThemeSection } from '~/components/settings/SettingsAppearanceThemeSection'

export function SettingsVisualTab() {
  return (
    <>
      <SettingsAppearanceThemeSection />
      <SettingsAppearancePaletteSection />
      <SettingsAppearanceBackgroundSection />
      <SettingsAppearanceFontSection />
    </>
  )
}
