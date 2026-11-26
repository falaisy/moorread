import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Bookmark,
  Bot,
  Database,
  Eye,
  Info,
  Keyboard,
  LayoutGrid,
  Search,
  Settings2,
  WandSparkles,
} from 'lucide-react'
import { PrivacyDataSettings } from '~/components/PrivacyDataSettings'
import { CrossDeviceSyncSettings } from '~/components/settings/CrossDeviceSyncSettings'
import { SettingsAboutTab } from '~/components/settings/SettingsAboutTab'
import { SettingsAiTab } from '~/components/settings/SettingsAiTab'
import { SettingsBookmarkTab } from '~/components/settings/SettingsBookmarkTab'
import { SettingsDataTab } from '~/components/settings/SettingsDataTab'
import { SettingsGeneralTab } from '~/components/settings/SettingsGeneralTab'
import { SettingsLayoutTab } from '~/components/settings/SettingsLayoutTab'
import { SettingsSearchTab } from '~/components/settings/SettingsSearchTab'
import { SettingsShortcutsTab } from '~/components/settings/SettingsShortcutsTab'
import { SettingsSyncTab } from '~/components/settings/SettingsSyncTab'
import { SettingsVisualTab } from '~/components/settings/SettingsVisualTab'

export type SettingsTab
  = | 'general'
    | 'layout'
    | 'bookmark'
    | 'visual'
    | 'shortcuts'
    | 'search'
    | 'sync'
    | 'ai'
    | 'data'
    | 'about'

type SettingsTabLabelKey
  = | 'appearance'
    | 'about'
    | 'aiSettings'
    | 'bookmarkAppearance'
    | 'contentEnhancement'
    | 'dataAndPrivacy'
    | 'general'
    | 'keyboardShortcuts'
    | 'layoutAppearance'
    | 'search'
    | 'visualAppearance'

export interface SettingsSection {
  id: SettingsTab
  labelKey: SettingsTabLabelKey
  Icon: LucideIcon
  render: () => ReactNode
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', labelKey: 'general', Icon: Settings2, render: () => <SettingsGeneralTab /> },
  { id: 'layout', labelKey: 'layoutAppearance', Icon: LayoutGrid, render: () => <SettingsLayoutTab /> },
  { id: 'bookmark', labelKey: 'bookmarkAppearance', Icon: Bookmark, render: () => <SettingsBookmarkTab /> },
  { id: 'visual', labelKey: 'visualAppearance', Icon: Eye, render: () => <SettingsVisualTab /> },
  { id: 'shortcuts', labelKey: 'keyboardShortcuts', Icon: Keyboard, render: () => <SettingsShortcutsTab /> },
  { id: 'search', labelKey: 'search', Icon: Search, render: () => <SettingsSearchTab /> },
  { id: 'sync', labelKey: 'contentEnhancement', Icon: WandSparkles, render: () => <SettingsSyncTab /> },
  { id: 'ai', labelKey: 'aiSettings', Icon: Bot, render: () => <SettingsAiTab /> },
  {
    id: 'data',
    labelKey: 'dataAndPrivacy',
    Icon: Database,
    render: () => (
      <>
        <CrossDeviceSyncSettings />
        <SettingsDataTab />
        <PrivacyDataSettings />
      </>
    ),
  },
  { id: 'about', labelKey: 'about', Icon: Info, render: () => <SettingsAboutTab /> },
]

export function getSettingsSection(tab: SettingsTab): SettingsSection {
  return SETTINGS_SECTIONS.find(section => section.id === tab) ?? SETTINGS_SECTIONS[0]
}
