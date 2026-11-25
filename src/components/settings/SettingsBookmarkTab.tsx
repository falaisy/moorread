import { SettingsAppearanceCardSection } from '~/components/settings/SettingsAppearanceCardSection'
import { SettingsAppearancePresetSection } from '~/components/settings/SettingsAppearancePresetSection'
import { SettingsAppearanceVisibleFieldsSection } from '~/components/settings/SettingsAppearanceVisibleFieldsSection'
import { SettingsResetControl } from '~/components/settings/SettingsResetControl'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

export function SettingsBookmarkTab() {
  const { t } = useI18n()
  const resetAppearanceSettings = useNavStore(state => state.resetAppearanceSettings)

  return (
    <>
      <SettingsResetControl description={t('settingsResetAppearanceDescription')} onReset={resetAppearanceSettings} />
      <SettingsAppearancePresetSection />
      <SettingsAppearanceCardSection />
      <SettingsAppearanceVisibleFieldsSection />
    </>
  )
}
