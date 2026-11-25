import type { MessageKey } from '../../lib/i18n'
import type { AppearanceSettings } from '../../lib/types'
import { BALANCED_APPEARANCE_SETTINGS, DEFAULT_APPEARANCE_SETTINGS } from '../../lib/appearance'

// 字體與版面參數屬於個人環境設定，套用風格預設時不應被重設。
type StylePresetSettings = Omit<
  AppearanceSettings,
  | 'navLayout'
  | 'homeLayout'
  | 'navItems'
  | 'cardFields'
  | 'fontFamily'
  | 'fontWeight'
  | 'contentWidth'
  | 'sidebarWidth'
  | 'sidebarCollapsed'
  // 每行欄數屬於個人版面偏好；套用風格預設時不應被重設。
  | 'bookmarkGridCols'
  | 'folderGridCols'
> & { cardFields: Omit<AppearanceSettings['cardFields'], 'websiteIcon'> }

export type StylePreset = 'sky' | 'minimal' | 'balanced' | 'compact' | 'soft'

interface StylePresetDefinition {
  labelKey: MessageKey
  descriptionKey: MessageKey
  badgeKey?: MessageKey
  settings: StylePresetSettings
}

function toStylePresetSettings(
  appearance: AppearanceSettings,
): StylePresetSettings {
  const { websiteIcon: _websiteIcon, ...cardFields } = appearance.cardFields
  return {
    gridDensity: appearance.gridDensity,
    cardSize: appearance.cardSize,
    cardHeight: appearance.cardHeight,
    gridCols: appearance.gridCols,
    cardStyle: appearance.cardStyle,
    iconSize: appearance.iconSize,
    radius: appearance.radius,
    accentColor: appearance.accentColor,
    colorTheme: appearance.colorTheme,
    fontSizeScale: appearance.fontSizeScale,
    backgroundStyle: appearance.backgroundStyle,
    cardFields,
  }
}

export const STYLE_PRESETS: Record<StylePreset, StylePresetDefinition> = {
  sky: {
    labelKey: 'appearanceStyleSky',
    descriptionKey: 'appearanceStyleSkyDescription',
    settings: toStylePresetSettings(DEFAULT_APPEARANCE_SETTINGS),
  },
  minimal: {
    labelKey: 'appearanceStyleMinimal',
    descriptionKey: 'appearanceStyleMinimalDescription',
    settings: {
      gridDensity: 'comfortable',
      cardSize: 'comfortable',
      cardHeight: 80,
      gridCols: 4,
      cardStyle: 'plain',
      iconSize: 44,
      radius: 8,
      accentColor: 'neutral',
      colorTheme: 'graphite',
      fontSizeScale: 0,
      backgroundStyle: 'flat',
      cardFields: {
        description: false,
        tags: false,
        categoryPath: false,
        categoryCards: true,
        actions: 'hover',
        titleLines: 1,
        descriptionLines: 1,
        maxVisibleTags: 0,
      },
    },
  },
  balanced: {
    labelKey: 'appearanceStyleBalanced',
    descriptionKey: 'appearanceStyleBalancedDescription',
    settings: toStylePresetSettings(BALANCED_APPEARANCE_SETTINGS),
  },
  compact: {
    labelKey: 'appearanceStyleCompact',
    descriptionKey: 'appearanceStyleCompactDescription',
    settings: {
      gridDensity: 'dense',
      cardSize: 'compact',
      cardHeight: 68,
      gridCols: 5,
      cardStyle: 'outline',
      iconSize: 36,
      radius: 8,
      accentColor: 'neutral',
      colorTheme: 'default',
      fontSizeScale: 0,
      backgroundStyle: 'flat',
      cardFields: {
        description: false,
        tags: false,
        categoryPath: true,
        categoryCards: false,
        actions: 'hover',
        titleLines: 1,
        descriptionLines: 1,
        maxVisibleTags: 0,
      },
    },
  },
  soft: {
    labelKey: 'appearanceStyleSoft',
    descriptionKey: 'appearanceStyleSoftDescription',
    settings: {
      gridDensity: 'comfortable',
      cardSize: 'spacious',
      cardHeight: 100,
      gridCols: 3,
      cardStyle: 'soft',
      iconSize: 48,
      radius: 12,
      accentColor: 'orange',
      colorTheme: 'dawn',
      fontSizeScale: 0,
      backgroundStyle: 'subtle',
      cardFields: {
        description: true,
        tags: true,
        categoryPath: true,
        categoryCards: true,
        actions: 'hover',
        titleLines: 2,
        descriptionLines: 2,
        maxVisibleTags: 3,
      },
    },
  },
}

// 以完整設定比對目前外觀，找不到相符預設時回傳空字串，讓 ToggleGroup 顯示為未選取。
export function findStylePreset(appearance: AppearanceSettings): StylePreset | '' {
  const currentSettings = toStylePresetSettings(appearance)
  const match = (
    Object.entries(STYLE_PRESETS) as Array<[StylePreset, StylePresetDefinition]>
  ).find(
    ([, preset]) =>
      JSON.stringify(preset.settings) === JSON.stringify(currentSettings),
  )
  return match?.[0] ?? ''
}
