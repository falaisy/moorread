import { Switch } from '~/components/ui/switch'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

interface AppearanceSwitchProps {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

function AppearanceSwitch({
  checked,
  label,
  onCheckedChange,
}: AppearanceSwitchProps) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg bg-secondary/45 px-3 py-2.5 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

export function SettingsAppearanceVisibleFieldsSection() {
  const { t } = useI18n()
  const appearance = useNavStore(state => state.settings.appearance)
  const setAppearance = useNavStore(state => state.setAppearance)

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('appearanceVisibleFields')}</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <AppearanceSwitch
          label={t('appearanceFieldCardIcon')}
          checked={appearance.cardFields.websiteIcon}
          onCheckedChange={value =>
            void setAppearance({
              cardFields: { websiteIcon: value },
            })}
        />
        <AppearanceSwitch
          label={t('appearanceMenuIcons')}
          checked={appearance.navItems.icons}
          onCheckedChange={value =>
            void setAppearance({ navItems: { icons: value } })}
        />
        <AppearanceSwitch
          label={t('appearanceFieldDescription')}
          checked={appearance.cardFields.description}
          onCheckedChange={value =>
            void setAppearance({
              cardFields: { description: value },
            })}
        />
        <AppearanceSwitch
          label={t('appearanceFieldTags')}
          checked={appearance.cardFields.tags}
          onCheckedChange={value =>
            void setAppearance({
              cardFields: { tags: value },
            })}
        />
        <AppearanceSwitch
          label={t('appearanceFieldSearchPath')}
          checked={appearance.cardFields.categoryPath}
          onCheckedChange={value =>
            void setAppearance({
              cardFields: { categoryPath: value },
            })}
        />
        <AppearanceSwitch
          label={t('appearanceFieldCategoryCards')}
          checked={appearance.cardFields.categoryCards}
          onCheckedChange={value =>
            void setAppearance({
              cardFields: { categoryCards: value },
            })}
        />
      </div>
    </section>
  )
}
