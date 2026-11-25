import type { FontOption } from '~/lib/fonts'
import type { MessageKey } from '~/lib/i18n'
import type { AppearanceFontWeight } from '~/lib/types'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { RangeSlider } from '~/components/ui/range-slider'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { detectAvailableFonts } from '~/lib/fonts'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

const FONT_WEIGHT_LABELS: Record<AppearanceFontWeight, MessageKey> = {
  regular: 'appearanceFontWeightRegular',
  medium: 'appearanceFontWeightMedium',
  bold: 'appearanceFontWeightBold',
}

const FONT_WEIGHT_ORDER: AppearanceFontWeight[] = ['regular', 'medium', 'bold']

// 只提供本機免費下載來源；不打包、不遠端載入任何字體檔。
const MORE_FONTS_URLS = [
  { href: 'https://fonts.google.com/?subset=chinese-traditional', key: 'appearanceFontMoreLink' as const },
  { href: 'https://fonts.net.cn/', key: 'appearanceFontMoreCn' as const },
]

export function SettingsAppearanceFontSection() {
  const { t } = useI18n()
  const appearance = useNavStore(state => state.settings.appearance)
  const setAppearance = useNavStore(state => state.setAppearance)
  // 量測需要真實瀏覽器；不支援 canvas 時只留「跟隨系統」。
  const [availableFonts] = useState<FontOption[]>(() => detectAvailableFonts())

  const selectedFont = availableFonts.find(
    font =>
      font.family === appearance.fontFamily
      || font.aliases.includes(appearance.fontFamily),
  )
  const selectedMissing = appearance.fontFamily !== '' && !selectedFont

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('appearanceFont')}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {t('appearanceFontDescription')}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t('appearanceFontFamily')}</span>
          <select
            value={appearance.fontFamily}
            onChange={event => void setAppearance({ fontFamily: event.target.value })}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-sm"
          >
            <option value="">{t('appearanceFontFollowSystem')}</option>
            {availableFonts.map(font => (
              <option key={font.family} value={font.family}>
                {font.label}
              </option>
            ))}
            {selectedMissing
              ? (
                  <option value={appearance.fontFamily}>
                    {appearance.fontFamily + t('appearanceFontMissing')}
                  </option>
                )
              : null}
          </select>
        </label>
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">{t('appearanceFontWeight')}</span>
          <ToggleGroup
            type="single"
            value={appearance.fontWeight}
            onValueChange={(value) => {
              if (value)
                void setAppearance({ fontWeight: value as AppearanceFontWeight })
            }}
            variant="outline"
            className="grid grid-cols-3"
            aria-label={t('appearanceFontWeight')}
          >
            {FONT_WEIGHT_ORDER.map(weight => (
              <ToggleGroupItem
                key={weight}
                value={weight}
                aria-label={t(FONT_WEIGHT_LABELS[weight])}
              >
                {t(FONT_WEIGHT_LABELS[weight])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <RangeSlider
          label={t('appearanceFontSizeScale')}
          min={-30}
          max={50}
          step={5}
          value={appearance.fontSizeScale}
          onChange={v => void setAppearance({ fontSizeScale: v })}
          formatValue={v => (v === 0 ? t('appearanceFontScaleAuto') : `${v > 0 ? '+' : ''}${v}%`)}
          className="sm:col-span-2"
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t('appearanceFontMoreHint')}
        {' '}
        {MORE_FONTS_URLS.map((link, idx) => (
          <span key={link.href}>
            {idx > 0 && ' / '}
            <a
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t(link.key)}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </span>
        ))}
      </p>
    </section>
  )
}
