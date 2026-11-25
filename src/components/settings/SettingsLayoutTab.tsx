import { AlignCenter, PanelLeft, PanelTop } from 'lucide-react'
import { APPEARANCE_OPTIONS, optionLabel } from '~/components/settings/appearance-options'
import { SettingsResetControl } from '~/components/settings/SettingsResetControl'
import { RangeSlider } from '~/components/ui/range-slider'
import { Switch } from '~/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '~/lib/appearance'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

const NAV_LAYOUT_OPTIONS = [
  { value: 'sidebar', labelKey: 'sidebar', Icon: PanelLeft },
  { value: 'top', labelKey: 'topbar', Icon: PanelTop },
] as const

const HOME_LAYOUT_OPTIONS = [
  { value: 'centered', labelKey: 'appearanceHomeLayoutCentered', Icon: AlignCenter },
  { value: 'workspace', labelKey: 'appearanceHomeLayoutWorkspace', Icon: PanelTop },
] as const

interface NavigationSwitchProps {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

function NavigationSwitch({
  checked,
  label,
  onCheckedChange,
}: NavigationSwitchProps) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg bg-secondary/45 px-3 py-2.5 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

export function SettingsLayoutTab() {
  const { t } = useI18n()
  const appearance = useNavStore(state => state.settings.appearance)
  const setAppearance = useNavStore(state => state.setAppearance)
  const resetAppearanceSettings = useNavStore(state => state.resetAppearanceSettings)

  return (
    <>
      <SettingsResetControl description={t('settingsResetAppearanceDescription')} onReset={resetAppearanceSettings} />

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <h3 className="text-sm font-semibold">{t('categoryBarPosition')}</h3>
        <ToggleGroup
          type="single"
          value={appearance.navLayout}
          onValueChange={(value) => {
            if (value) {
              void setAppearance({
                navLayout: value as typeof appearance.navLayout,
              })
            }
          }}
          variant="outline"
          className="mt-3 grid grid-cols-2"
          aria-label={t('categoryBarPosition')}
        >
          {NAV_LAYOUT_OPTIONS.map(({ value, labelKey, Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={t(labelKey)}>
              <Icon />
              <span>{t(labelKey)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <h3 className="text-sm font-semibold">{t('appearanceHomeLayout')}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('appearanceHomeLayoutDescription')}
        </p>
        <ToggleGroup
          type="single"
          value={appearance.homeLayout}
          onValueChange={(value) => {
            if (value)
              void setAppearance({ homeLayout: value as typeof appearance.homeLayout })
          }}
          variant="outline"
          className="mt-3 grid grid-cols-2"
          aria-label={t('appearanceHomeLayout')}
        >
          {HOME_LAYOUT_OPTIONS.map(({ value, labelKey, Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={t(labelKey)}>
              <Icon />
              <span>{t(labelKey)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <h3 className="text-sm font-semibold">{t('appearanceContentWidth')}</h3>
        <ToggleGroup
          type="single"
          value={appearance.contentWidth}
          onValueChange={v => v && void setAppearance({ contentWidth: v as typeof appearance.contentWidth })}
          variant="outline"
          className="mt-3 grid grid-cols-3"
          aria-label={t('appearanceContentWidth')}
        >
          {APPEARANCE_OPTIONS.contentWidth.map(option => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {optionLabel(t, option)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <h3 className="text-sm font-semibold">{t('sidebarAppearance')}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('sidebarAppearanceDescription')}
        </p>
        <RangeSlider
          label={t('sidebarWidth')}
          min={SIDEBAR_WIDTH_MIN}
          max={SIDEBAR_WIDTH_MAX}
          step={4}
          value={appearance.sidebarWidth}
          onChange={v => void setAppearance({ sidebarWidth: v })}
          formatValue={v => `${v}px`}
        />
        <div className="mt-3">
          <NavigationSwitch
            label={t('sidebarCollapsedLabel')}
            checked={appearance.sidebarCollapsed}
            onCheckedChange={value => void setAppearance({ sidebarCollapsed: value })}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <h3 className="text-sm font-semibold">{t('navigationAndCategories')}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('navigationAndCategoriesDescription')}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <NavigationSwitch
            label={t('showCounts')}
            checked={appearance.navItems.counts}
            onCheckedChange={value =>
              void setAppearance({ navItems: { counts: value } })}
          />
          <NavigationSwitch
            label={t('smartCategories')}
            checked={appearance.navItems.smartCategories}
            onCheckedChange={value =>
              void setAppearance({ navItems: { smartCategories: value } })}
          />
          <NavigationSwitch
            label={t('savedFilters')}
            checked={appearance.navItems.savedSearches}
            onCheckedChange={value =>
              void setAppearance({ navItems: { savedSearches: value } })}
          />
          <NavigationSwitch
            label={t('categoryTree')}
            checked={appearance.navItems.categoryTree}
            onCheckedChange={value =>
              void setAppearance({ navItems: { categoryTree: value } })}
          />
        </div>
        <p className="mt-2 text-pretty text-xs leading-5 text-muted-foreground">
          {t('categoryTreeHint')}
        </p>
      </section>
    </>
  )
}
