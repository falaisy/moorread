import type { MessageKey } from '~/lib/i18n'
import type { CardStyle } from '~/lib/types'
import { Folder } from 'lucide-react'
import { RangeSlider } from '~/components/ui/range-slider'
import { Switch } from '~/components/ui/switch'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '~/components/ui/toggle-group'
import { AUTO_GRID_COLS, cardStyleClass, radiusClass } from '~/lib/appearance'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

const CARD_STYLE_ITEMS: { value: CardStyle, labelKey: MessageKey }[] = [
  { value: 'soft', labelKey: 'appearanceCardSoft' },
  { value: 'outline', labelKey: 'appearanceCardOutline' },
  { value: 'plain', labelKey: 'appearanceCardPlain' },
]

interface GridColsControlProps {
  labelKey: MessageKey
  value: number
  onChange: (value: number) => void
}

/** 1-8 欄滑桿＋「自動」開關；0 代表自動。 */
function GridColsControl({ labelKey, value, onChange }: GridColsControlProps) {
  const { t } = useI18n()
  const auto = value === 0
  return (
    <div className="grid gap-1.5 text-sm">
      <RangeSlider
        label={t(labelKey)}
        min={1}
        max={8}
        step={1}
        value={auto ? AUTO_GRID_COLS : value}
        onChange={onChange}
        formatValue={v =>
          auto ? t('appearanceGridColsAuto') : `${v} ${t('appearanceColsUnit')}`}
      />
      <label className="flex items-center justify-between gap-3 rounded-lg bg-secondary/45 px-3 py-1.5 text-xs text-muted-foreground">
        <span>{t('appearanceGridColsAuto')}</span>
        <Switch
          checked={auto}
          onCheckedChange={checked => onChange(checked ? 0 : AUTO_GRID_COLS)}
        />
      </label>
    </div>
  )
}

export function SettingsAppearanceCardSection() {
  const { t } = useI18n()
  const appearance = useNavStore(state => state.settings.appearance)
  const setAppearance = useNavStore(state => state.setAppearance)

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('appearanceCardDetails')}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">{t('appearanceCardStyle')}</span>
          <ToggleGroup
            type="single"
            value={appearance.cardStyle}
            onValueChange={v => v && void setAppearance({ cardStyle: v as CardStyle })}
            variant="default"
            size="sm"
            className="justify-start gap-2"
          >
            {CARD_STYLE_ITEMS.map(option => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={t(option.labelKey)}
                title={t(option.labelKey)}
                className={cn(
                  'h-auto min-w-[84px] flex-col gap-1 rounded-lg p-2 data-[state=on]:ring-2 data-[state=on]:ring-ring',
                )}
              >
                <div
                  className={cn(
                    'flex size-10 items-center justify-center',
                    cardStyleClass[option.value],
                    radiusClass[appearance.radius],
                  )}
                >
                  <Folder className="size-4 text-muted-foreground" />
                </div>
                <span className="text-2xs leading-none text-muted-foreground">
                  {t(option.labelKey)}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <GridColsControl
          labelKey="appearanceBookmarkGridCols"
          value={appearance.bookmarkGridCols}
          onChange={v => void setAppearance({ bookmarkGridCols: v })}
        />
        <GridColsControl
          labelKey="appearanceFolderGridCols"
          value={appearance.folderGridCols}
          onChange={v => void setAppearance({ folderGridCols: v })}
        />

        <RangeSlider
          label={t('appearanceIconSize')}
          min={32}
          max={72}
          step={4}
          value={appearance.iconSize}
          onChange={v => void setAppearance({ iconSize: v })}
          formatValue={v => `${v}px`}
        />
        <RangeSlider
          label={t('appearanceRadius')}
          min={4}
          max={16}
          step={4}
          value={appearance.radius}
          onChange={v => void setAppearance({ radius: v })}
          formatValue={v => `${v}px`}
        />
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">{t('appearanceActionButtons')}</span>
          <ToggleGroup
            type="single"
            value={appearance.cardFields.actions}
            onValueChange={v => v && void setAppearance({ cardFields: { actions: v as typeof appearance.cardFields.actions } })}
            variant="outline"
            className="grid grid-cols-2"
            aria-label={t('appearanceActionButtons')}
          >
            <ToggleGroupItem value="hover">{t('appearanceActionsHover')}</ToggleGroupItem>
            <ToggleGroupItem value="always">{t('appearanceActionsAlways')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <RangeSlider
          label={t('appearanceTitleLines')}
          min={1}
          max={2}
          step={1}
          value={appearance.cardFields.titleLines}
          onChange={v => void setAppearance({ cardFields: { titleLines: v as 1 | 2 } })}
          formatValue={v => t('appearanceLineCount', { count: v })}
        />
        <RangeSlider
          label={t('appearanceDescriptionLines')}
          min={1}
          max={3}
          step={1}
          value={appearance.cardFields.descriptionLines}
          onChange={v => void setAppearance({ cardFields: { descriptionLines: v as 1 | 2 | 3 } })}
          formatValue={v => t('appearanceLineCount', { count: v })}
        />
        <RangeSlider
          label={t('appearanceTagCount')}
          min={0}
          max={5}
          step={1}
          value={appearance.cardFields.maxVisibleTags}
          onChange={v => void setAppearance({ cardFields: { maxVisibleTags: v } })}
          formatValue={v => v === 0 ? t('appearanceNotShown') : t('appearanceTagCountValue', { count: v })}
        />
      </div>
    </section>
  )
}
