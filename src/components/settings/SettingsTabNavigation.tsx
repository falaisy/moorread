import type { KeyboardEvent } from 'react'
import type { SettingsTab } from '~/components/settings/settings-sections'
import { useRef } from 'react'
import { SETTINGS_SECTIONS } from '~/components/settings/settings-sections'
import { useI18n } from '~/lib/use-i18n'
import { cn } from '~/lib/utils'

export type { SettingsTab }

interface SettingsTabNavigationProps {
  value: SettingsTab
  onValueChange: (tab: SettingsTab) => void
}

export function SettingsTabNavigation({
  value,
  onValueChange,
}: SettingsTabNavigationProps) {
  const { t } = useI18n()
  const tabButtonsRef = useRef<Array<HTMLButtonElement | null>>([])

  const focusTab = (index: number) => {
    const tab = SETTINGS_SECTIONS[index]
    if (!tab)
      return
    onValueChange(tab.id)
    tabButtonsRef.current[index]?.focus()
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTab((index + 1) % SETTINGS_SECTIONS.length)
    }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTab((index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length)
    }
    else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    }
    else if (event.key === 'End') {
      event.preventDefault()
      focusTab(SETTINGS_SECTIONS.length - 1)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t('settingsCategories')}
      aria-orientation="vertical"
      className="flex gap-1 overflow-x-auto border-b border-border/70 bg-secondary/35 p-3 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-4"
    >
      {SETTINGS_SECTIONS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabButtonsRef.current[index] = element
          }}
          id={`settings-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          aria-controls={`settings-panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onValueChange(tab.id)}
          onKeyDown={event => handleKeyDown(event, index)}
          className={cn(
            'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-full',
            value === tab.id
              ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
              : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
          )}
        >
          <tab.Icon className="size-4" aria-hidden="true" />
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  )
}
