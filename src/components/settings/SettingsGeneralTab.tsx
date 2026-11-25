import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { AutoOrganizeSettings } from '~/components/AutoOrganizeSettings'
import { CategoryTreePicker } from '~/components/settings/CategoryTreePicker'
import { HeaderWidgetSettingsPanel } from '~/components/settings/HeaderWidgetSettingsPanel'
import { SettingsResetControl } from '~/components/settings/SettingsResetControl'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import { Switch } from '~/components/ui/switch'
import { ALL_CATEGORY, VIRTUAL_CATEGORIES } from '~/lib/default-data'
import { reportExpectedFallback } from '~/lib/diagnostics'
import { homeTabReadyMessage } from '~/lib/home-tabs'
import { languageOptions } from '~/lib/i18n'
import { useCategories, useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

export function SettingsGeneralTab() {
  const { language, t } = useI18n()
  const categories = useCategories()
  const defaultCategoryId = useNavStore(
    state => state.settings.defaultCategoryId,
  )
  const singleHomeTab = useNavStore(state => state.settings.singleHomeTab)
  const groupsEnabled = useNavStore(state => state.settings.bookmarkGroupsEnabled)
  const setGroupsEnabled = useNavStore(state => state.setBookmarkGroupsEnabled)
  const setDefaultCategory = useNavStore(state => state.setDefaultCategory)
  const setSingleHomeTab = useNavStore(state => state.setSingleHomeTab)
  const setLanguage = useNavStore(state => state.setLanguage)
  const resetGeneralSettings = useNavStore(state => state.resetGeneralSettings)
  const [autoRulesOpen, setAutoRulesOpen] = useState(false)

  /**
   * Normalize defaultCategoryId against current categories + virtuals.
   * History: category ids are "cat-{nativeId}" prefixed (see bookmark-tree.ts).
   * Older versions may have stored raw native ids like "5" without prefix,
   * which would never match → Picker always fell back to ALL_CATEGORY.
   * We accept BOTH prefixed "cat-5" and raw "5" forms.
   */
  const allCategoryIds = new Set<string>([
    ...VIRTUAL_CATEGORIES.map(c => c.id),
    ALL_CATEGORY.id,
    ...categories.map(c => c.id),
    ...categories.map(c => c.id.replace(/^cat-/, '')),
  ])
  const defaultCategoryValue
    = defaultCategoryId && allCategoryIds.has(defaultCategoryId)
      // If storage has raw id "5" but native categories use "cat-5",
      // translate to prefixed form so CategoryTreePicker finds the row.
      ? categories.find(c => c.id === `cat-${defaultCategoryId}`)?.id ?? defaultCategoryId
      : ALL_CATEGORY.id

  const updateSingleHomeTab = async (enabled: boolean) => {
    await setSingleHomeTab(enabled)
    if (enabled) {
      await chrome.runtime
        .sendMessage({ type: homeTabReadyMessage })
        .catch(cause => reportExpectedFallback('home-tab.announce', cause))
    }
  }

  return (
    <>
      <SettingsResetControl description={t('settingsResetGeneralDescription')} onReset={resetGeneralSettings} />
      <HeaderWidgetSettingsPanel />
      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <label id="default-category-label" className="text-sm font-semibold">
          {t('defaultFolder')}
        </label>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('defaultFolderDescription')}
        </p>
        <CategoryTreePicker
          value={defaultCategoryValue}
          onChange={id => void setDefaultCategory(id)}
          ariaLabelledBy="default-category-label"
          triggerClassName="mt-3"
        />
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <label htmlFor="interface-language" className="text-sm font-semibold">
          {t('language')}
        </label>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('languageDescription')}
        </p>
        <select
          id="interface-language"
          value={language}
          onChange={event =>
            void setLanguage(event.target.value as typeof language)}
          className="mt-3 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm"
        >
          {languageOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="single-home-tab" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-semibold">
              {t('singleHomeTab')}
            </span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">
              {t('singleHomeTabDescription')}
            </span>
          </label>
          <Switch
            id="single-home-tab"
            checked={singleHomeTab}
            onCheckedChange={value => void updateSingleHomeTab(value)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="bookmark-groups-enabled" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-semibold">{t('bookmarkGroups')}</span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">{t('bookmarkGroupsEnabledHint')}</span>
          </label>
          <Switch id="bookmark-groups-enabled" aria-label={t('bookmarkGroups')} checked={groupsEnabled} onCheckedChange={value => void setGroupsEnabled(value)} />
        </div>
      </section>

      <Collapsible open={autoRulesOpen} onOpenChange={setAutoRulesOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="group w-full justify-between"
          >
            {t('autoOrganizeRules')}
            <ChevronDown
              data-icon="inline-end"
              className="transition-transform group-data-[state=open]:rotate-180"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <AutoOrganizeSettings />
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
