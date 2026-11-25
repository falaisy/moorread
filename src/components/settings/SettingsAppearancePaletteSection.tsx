import { Shuffle, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import {
  DEFAULT_THEME_BASE_COLOR,
  deriveThemePalette,
  isHexColor,
  normalizeHexColor,
} from '~/lib/palette'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

/**
 * 主題配色引擎的最小操作入口：Base Color 微調、隨機、鎖定、儲存、還原。
 * 預覽直接套用到既有 CSS Token，不建立第二套配色來源。
 */
export function SettingsAppearancePaletteSection() {
  const { t } = useI18n()
  const palette = useNavStore(state => state.themePalette)
  const previewThemeBaseColor = useNavStore(state => state.previewThemeBaseColor)
  const randomizeThemeBaseColor = useNavStore(state => state.randomizeThemeBaseColor)
  const setThemePaletteLocked = useNavStore(state => state.setThemePaletteLocked)
  const saveThemePalette = useNavStore(state => state.saveThemePalette)
  const restoreThemePalette = useNavStore(state => state.restoreThemePalette)

  const [draft, setDraft] = useState(palette.baseColor ?? '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(palette.baseColor ?? '')
  }, [palette.baseColor])

  const previewPalette = deriveThemePalette(
    palette.baseColor ?? DEFAULT_THEME_BASE_COLOR,
    'light',
  )

  const stateText = palette.baseColor
    ? palette.savedBaseColor === palette.baseColor
      ? t('themePaletteSaved')
      : t('themePalettePreview')
    : t('themePaletteDefaultState')

  const onDraftChange = (value: string) => {
    setDraft(value)
    setNotice('')
    if (isHexColor(value)) {
      setError('')
      previewThemeBaseColor(value)
    }
  }

  const onDraftBlur = () => {
    if (!isHexColor(draft))
      setError(t('themePaletteInvalid'))
  }

  const onRandom = () => {
    if (palette.locked) {
      setNotice(t('themePaletteLockedHint'))
      return
    }
    randomizeThemeBaseColor()
    setError('')
    setNotice(t('themePalettePreview'))
  }

  const onSave = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await saveThemePalette()
      setNotice(t('themePaletteSaved'))
    }
    catch {
      setError(t('themePaletteSaveFailed'))
    }
    finally {
      setSaving(false)
    }
  }

  const onRestore = () => {
    restoreThemePalette()
    setError('')
    setNotice(palette.savedBaseColor
      ? t('themePaletteRestored')
      : t('themePaletteDefaultState'))
  }

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('themePaletteTitle')}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {t('themePaletteDescription')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={t('themePaletteColorPicker')}
          value={normalizeHexColor(draft) ?? DEFAULT_THEME_BASE_COLOR}
          onChange={event => onDraftChange(event.target.value)}
          className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-card p-1"
        />
        <Input
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          onBlur={onDraftBlur}
          aria-label={t('themePaletteBaseColor')}
          aria-invalid={Boolean(error) || undefined}
          placeholder="#2F6FED"
          spellCheck={false}
          className="max-w-48 font-mono uppercase"
        />
      </div>
      {error
        ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
        : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRandom}>
          <Shuffle />
          {t('themePaletteRandom')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onSave()}
          disabled={saving || !palette.baseColor}
        >
          {t('themePaletteSave')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRestore}>
          <Undo2 />
          {t('themePaletteRestore')}
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch
            checked={palette.locked}
            onCheckedChange={setThemePaletteLocked}
            aria-label={t('themePaletteLock')}
          />
          {t('themePaletteLock')}
        </label>
      </div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {notice || stateText}
      </p>
      {palette.locked
        ? <p className="mt-1 text-xs text-muted-foreground">{t('themePaletteLockedHint')}</p>
        : null}
      {previewPalette
        ? (
            <div
              aria-hidden="true"
              className="mt-3 flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5"
              style={{
                backgroundColor: `hsl(${previewPalette['--background']})`,
                color: `hsl(${previewPalette['--foreground']})`,
              }}
            >
              <span className="text-sm font-medium">Aa</span>
              <span
                className="text-xs"
                style={{ color: `hsl(${previewPalette['--muted-foreground']})` }}
              >
                Aa
              </span>
              <span
                className="ml-auto rounded px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: `hsl(${previewPalette['--primary']})`,
                  color: `hsl(${previewPalette['--primary-foreground']})`,
                }}
              >
                Aa
              </span>
            </div>
          )
        : null}
    </section>
  )
}
