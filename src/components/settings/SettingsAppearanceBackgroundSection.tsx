import type { AppearanceMessageKey } from '~/lib/i18n-appearance'
import type { LocalBackgroundErrorCode, LocalBackgroundState } from '~/lib/local-background'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import {
  getLocalBackgroundState,
  LOCAL_BACKGROUND_MIME_TYPES,
  localBackgroundErrorOf,
  readLocalBackgroundBlob,
  removeLocalBackground,
  saveLocalBackground,
  setLocalBackgroundEnabled,
} from '~/lib/local-background'
import { useI18n } from '~/lib/use-i18n'

const ERROR_MESSAGE_KEYS: Record<LocalBackgroundErrorCode, AppearanceMessageKey | null> = {
  'unsupported-format': 'appearanceLocalBackgroundErrorFormat',
  'too-large': 'appearanceLocalBackgroundErrorSize',
  'empty-file': 'appearanceLocalBackgroundErrorSize',
  'decode-failed': 'appearanceLocalBackgroundErrorDecode',
  'dimensions-too-large': 'appearanceLocalBackgroundErrorDimensions',
  'cache-unavailable': 'appearanceLocalBackgroundErrorCache',
  'read-failed': 'appearanceLocalBackgroundErrorDecode',
  'write-failed': 'appearanceLocalBackgroundErrorStorage',
  'storage-unavailable': 'appearanceLocalBackgroundErrorStorage',
  'missing-image': 'appearanceLocalBackgroundErrorMissing',
  'superseded': null,
}

export function SettingsAppearanceBackgroundSection() {
  const { t } = useI18n()
  const [state, setState] = useState<LocalBackgroundState | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState<LocalBackgroundErrorCode | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef('')

  const releasePreview = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = ''
    }
    setPreviewUrl('')
  }, [])

  const refresh = useCallback(async () => {
    const next = await getLocalBackgroundState()
    setState(next)
    releasePreview()
    if (!next.enabled)
      return
    const blob = await readLocalBackgroundBlob()
    if (!blob.ok || !blob.value)
      return
    const url = URL.createObjectURL(blob.value)
    objectUrlRef.current = url
    setPreviewUrl(url)
  }, [releasePreview])

  useEffect(() => {
    void refresh()
    return () => releasePreview()
  }, [refresh, releasePreview])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      await refresh()
    }
    finally {
      setBusy(false)
    }
  }

  const onToggle = (enabled: boolean) => {
    void run(async () => {
      const code = localBackgroundErrorOf(await setLocalBackgroundEnabled(enabled))
      if (code)
        setError(code)
    })
  }

  const onChoose = (file: File | undefined) => {
    if (!file)
      return
    void run(async () => {
      const code = localBackgroundErrorOf(await saveLocalBackground(file))
      if (code && code !== 'superseded')
        setError(code)
    })
  }

  const onRemove = () => {
    void run(async () => {
      const code = localBackgroundErrorOf(await removeLocalBackground())
      if (code)
        setError(code)
    })
  }

  const errorKey = error ? ERROR_MESSAGE_KEYS[error] : null
  const canEnable = Boolean(state?.hasImage)
  // Cache 暫時讀取失敗：圖片與旗標仍在，顯示錯誤並允許重試。
  const readFailed = Boolean(state?.cacheAvailable && state?.error)

  return (
    <section className="rounded-xl border border-border bg-muted/35 p-4">
      <h3 className="text-sm font-semibold">{t('appearanceLocalBackground')}</h3>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">
        {t('appearanceLocalBackgroundDescription')}
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('appearanceLocalBackgroundEnable')}</span>
        <Switch
          checked={state?.enabled ?? false}
          disabled={busy || !state?.cacheAvailable || (!state?.enabled && !canEnable)}
          onCheckedChange={onToggle}
          aria-label={t('appearanceLocalBackgroundEnable')}
        />
      </div>

      {previewUrl
        ? (
            <img
              src={previewUrl}
              alt=""
              className="mt-3 h-24 w-full rounded-lg border border-border object-cover"
            />
          )
        : null}

      <p className="mt-2 min-h-4 break-all text-xs text-muted-foreground">
        {state?.fileName ? state.fileName : t('appearanceLocalBackgroundEmpty')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || state?.cacheAvailable === false}
          onClick={() => inputRef.current?.click()}
        >
          {t('appearanceLocalBackgroundChoose')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !state?.hasImage}
          onClick={onRemove}
        >
          {t('appearanceLocalBackgroundRemove')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={LOCAL_BACKGROUND_MIME_TYPES.join(',')}
          className="sr-only"
          aria-label={t('appearanceLocalBackgroundChoose')}
          onChange={(event) => {
            onChoose(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {errorKey
        ? (
            <p role="status" className="mt-2 text-xs text-destructive">
              {t(errorKey)}
            </p>
          )
        : null}

      {readFailed
        ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p role="status" className="text-xs text-destructive">
                {t('appearanceLocalBackgroundErrorRead')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {t('appearanceLocalBackgroundRetry')}
              </Button>
            </div>
          )
        : null}

      {state?.cacheAvailable === false
        ? (
            <p role="status" className="mt-2 text-xs text-destructive">
              {t('appearanceLocalBackgroundErrorCache')}
            </p>
          )
        : null}

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t('appearanceLocalBackgroundHint')}
      </p>
    </section>
  )
}
