import type { MessageKey, TranslationParams } from '~/lib/i18n'
import type { ThemeMode } from '~/lib/types'
import { Monitor, Moon, Sun } from 'lucide-react'

export const APPEARANCE_OPTIONS = {
  contentWidth: [
    { value: 'standard', labelKey: 'appearanceWidthStandard' },
    { value: 'wide', labelKey: 'appearanceWidthWide' },
    { value: 'full', labelKey: 'appearanceWidthFull' },
  ],
  gridDensity: [
    { value: 'comfortable', labelKey: 'appearanceDensityComfortable' },
    { value: 'dense', labelKey: 'appearanceDensityDense' },
  ],
  cardSize: [
    { value: 'compact', labelKey: 'appearanceCardSizeCompact' },
    { value: 'comfortable', labelKey: 'appearanceCardSizeComfortable' },
    { value: 'spacious', labelKey: 'appearanceCardSizeSpacious' },
  ],
  fontSizeScale: [
    { value: 'auto', labelKey: 'appearanceFontSizeAuto' },
    { value: '-10', labelKey: 'appearanceFontSizeSmaller' },
    { value: '10', labelKey: 'appearanceFontSizeLarger' },
    { value: '20', labelKey: 'appearanceFontSizeXL' },
    { value: '30', labelKey: 'appearanceFontSizeXXL' },
  ],
  cardStyle: [
    { value: 'soft', labelKey: 'appearanceCardSoft' },
    { value: 'outline', labelKey: 'appearanceCardOutline' },
    { value: 'plain', labelKey: 'appearanceCardPlain' },
  ],
  iconSize: [
    { value: 'sm', labelKey: 'appearanceSizeSmall' },
    { value: 'md', labelKey: 'appearanceSizeMedium' },
    { value: 'lg', labelKey: 'appearanceSizeLarge' },
  ],
  radius: [
    { value: 'sm', labelKey: 'appearanceRadiusSmall' },
    { value: 'md', labelKey: 'appearanceRadiusMedium' },
    { value: 'lg', labelKey: 'appearanceRadiusLarge' },
  ],
  accentColor: [
    { value: 'neutral', labelKey: 'appearanceAccentNeutral' },
    { value: 'blue', labelKey: 'appearanceAccentBlue' },
    { value: 'green', labelKey: 'appearanceAccentGreen' },
    { value: 'orange', labelKey: 'appearanceAccentOrange' },
    { value: 'rose', labelKey: 'appearanceAccentRose' },
  ],
  colorTheme: [
    { value: 'default', labelKey: 'appearanceColorDefault' },
    { value: 'sky', labelKey: 'appearanceColorSky' },
    { value: 'graphite', labelKey: 'appearanceColorGraphite' },
    { value: 'meadow', labelKey: 'appearanceColorMeadow' },
    { value: 'dawn', labelKey: 'appearanceColorDawn' },
    { value: 'berry', labelKey: 'appearanceColorBerry' },
  ],
  backgroundStyle: [
    { value: 'flat', labelKey: 'appearanceBackgroundFlat' },
    { value: 'subtle', labelKey: 'appearanceBackgroundSubtle' },
    { value: 'panel', labelKey: 'appearanceBackgroundPanel' },
  ],
  titleLines: [
    { value: 1, labelKey: 'appearanceLineCount', params: { count: 1 } },
    { value: 2, labelKey: 'appearanceLineCount', params: { count: 2 } },
  ],
  descriptionLines: [
    { value: 1, labelKey: 'appearanceLineCount', params: { count: 1 } },
    { value: 2, labelKey: 'appearanceLineCount', params: { count: 2 } },
    { value: 3, labelKey: 'appearanceLineCount', params: { count: 3 } },
  ],
  maxVisibleTags: [
    { value: 0, labelKey: 'appearanceNotShown' },
    { value: 1, labelKey: 'appearanceTagCountValue', params: { count: 1 } },
    { value: 2, labelKey: 'appearanceTagCountValue', params: { count: 2 } },
    { value: 3, labelKey: 'appearanceTagCountValue', params: { count: 3 } },
    { value: 5, labelKey: 'appearanceTagCountValue', params: { count: 5 } },
  ],
} as const

export const THEME_OPTIONS: Array<{
  value: ThemeMode
  labelKey: MessageKey
  shortLabelKey: MessageKey
  Icon: typeof Sun
}> = [
  { value: 'light', labelKey: 'themeLight', shortLabelKey: 'themeLight', Icon: Sun },
  { value: 'dark', labelKey: 'themeDark', shortLabelKey: 'themeDark', Icon: Moon },
  { value: 'system', labelKey: 'themeSystem', shortLabelKey: 'themeSystemShort', Icon: Monitor },
]

export function optionLabel(
  t: (key: MessageKey, params?: TranslationParams) => string,
  option: { labelKey: MessageKey, params?: TranslationParams },
) {
  return t(option.labelKey, option.params)
}
