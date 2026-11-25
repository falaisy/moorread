import type { SetStateAction } from 'react'
import type { AiClassificationSuggestion } from '~/lib/ai-bookmark-classification'
import type { AiClassificationRecovery } from '~/lib/ai-classification-apply'
import type { AiTransferConsent } from '~/lib/ai-consent'
import type { AiSettings } from '~/lib/ai-settings'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AiClassificationPreviewDialog } from '~/components/settings/AiClassificationPreviewDialog'
import { AiTransferConsentDialog } from '~/components/settings/AiTransferConsentDialog'
import {
  resolveAiActionErrorMessageKey,
  resolveAiErrorMessageKey,
} from '~/components/settings/settings-ai-error-message'
import { SettingsAiClassificationSection } from '~/components/settings/SettingsAiClassificationSection'
import { SettingsAiProviderSection } from '~/components/settings/SettingsAiProviderSection'
import {
  ensureAiEndpointPermission,
  fetchCompatibleModels,
  validateAiEndpoint,
} from '~/lib/ai-bookmark-classification'
import {
  applyClassificationSuggestions,
  loadAiClassificationRecovery,
  undoAiClassification,
} from '~/lib/ai-classification-apply'
import {
  clearAiClassificationJob,
  getAiClassificationJobSnapshot,
  initializeAiClassificationJob,
  isCurrentAiClassificationJobOwner,
  resumeAiClassificationJob,
  startAiClassificationJob,
  subscribeAiClassificationJob,
} from '~/lib/ai-classification-job'
import { grantAiTransferConsent, revokeAiTransferConsent } from '~/lib/ai-consent'
import {
  clearAiToken,
  getDefaultAiSettings,
  loadAiSettings,
  loadAiToken,
  saveAiSettings,
} from '~/lib/ai-settings'
import { resolveHydratedAiSettings } from '~/lib/ai-settings-hydration'
import { toNodeId } from '~/lib/bookmark-tree'
import { useNavStore } from '~/lib/store'
import { useI18n } from '~/lib/use-i18n'

type AiPendingConsent
  = | { kind: 'classification', action: 'start' | 'resume' }
    | { kind: 'connection', verified: boolean }

export function SettingsAiTab() {
  const { language, t } = useI18n()
  const bookmarks = useNavStore(state => state.bookmarks)
  const categories = useNavStore(state => state.categories)
  const loadBookmarks = useNavStore(state => state.loadBookmarks)
  const markBookmarksOrganized = useNavStore(state => state.markBookmarksOrganized)
  const [settings, setSettings] = useState<AiSettings>(() => getDefaultAiSettings(language))
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<AiClassificationSuggestion[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [applying, setApplying] = useState(false)
  const [recovery, setRecovery] = useState<AiClassificationRecovery | null>(null)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [pendingConsent, setPendingConsent] = useState<AiPendingConsent | null>(null)
  const initialLanguageRef = useRef(language)
  const job = useSyncExternalStore(
    subscribeAiClassificationJob,
    getAiClassificationJobSnapshot,
    getAiClassificationJobSnapshot,
  )
  const previousJobStatusRef = useRef(job.status)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const tokenRef = useRef(token)
  tokenRef.current = token
  // 使用者在非同步載入完成前編輯過，就保留其輸入；
  // 較晚回來的預設值或已儲存值不得覆蓋較新的修改。
  const editedDuringLoadRef = useRef(false)
  const updateSettings = (action: SetStateAction<AiSettings>) => {
    editedDuringLoadRef.current = true
    setSettings(action)
  }
  const updateToken = (value: string) => {
    editedDuringLoadRef.current = true
    setToken(value)
  }
  const jobActive = job.status === 'running' || job.status === 'pausing'
  const jobControllable = isCurrentAiClassificationJobOwner()

  useEffect(() => {
    void (async () => {
      try {
        await initializeAiClassificationJob()
        const storedSettings = await loadAiSettings(initialLanguageRef.current)
        const storedToken = await loadAiToken(storedSettings.rememberToken)
        const hydrated = resolveHydratedAiSettings(
          { settings: settingsRef.current, token: tokenRef.current },
          { settings: storedSettings, token: storedToken },
          editedDuringLoadRef.current,
        )
        setSettings(hydrated.settings)
        setToken(hydrated.token)
        setRecovery(await loadAiClassificationRecovery())
      }
      catch {
        // 載入失敗時保留目前狀態（預設值或使用者已輸入的內容），不覆蓋也不中斷操作。
      }
    })()
  }, [])

  useEffect(() => {
    const wasActive
      = previousJobStatusRef.current === 'running'
        || previousJobStatusRef.current === 'pausing'
    if (wasActive && job.status === 'completed' && job.suggestions.length > 0) {
      setSuggestions(job.suggestions)
      setSelectedIds(new Set(job.suggestions.map(item => item.bookmarkId)))
      setPreviewOpen(true)
    }
    previousJobStatusRef.current = job.status
  }, [job])

  const clearMessages = () => {
    setStatus('')
    setError('')
  }

  const describeActionFailure = (cause: unknown) =>
    t(resolveAiActionErrorMessageKey(cause))

  const requestPermission = async () => {
    validateAiEndpoint(settings.baseUrl, Boolean(token.trim()))
    if (!(await ensureAiEndpointPermission(settings.baseUrl)))
      throw new Error('ai.permission_denied')
  }

  const saveConfiguration = async () => {
    clearMessages()
    try {
      validateAiEndpoint(settings.baseUrl, Boolean(token.trim()))
      await saveAiSettings(settings, token, language)
      setStatus(t('aiConfigurationSaved'))
    }
    catch (cause) {
      setError(t(resolveAiErrorMessageKey(cause)))
    }
  }

  const runLoadModels = async (
    verified: boolean,
    consent: AiTransferConsent,
  ) => {
    clearMessages()
    setLoadingModels(true)
    try {
      await requestPermission()
      const nextModels = await fetchCompatibleModels(
        settings.baseUrl,
        token,
        consent,
      )
      setModels(nextModels)
      setStatus(
        t(verified ? 'aiConnectionVerified' : 'aiModelsLoaded', {
          count: nextModels.length,
        }),
      )
    }
    catch (cause) {
      setError(describeActionFailure(cause))
    }
    finally {
      // 連線測試同意只用於這一次連線，不會變成 AI 分類同意。
      revokeAiTransferConsent(consent)
      setLoadingModels(false)
    }
  }

  const requestConsent = (next: AiPendingConsent) => {
    if (pendingConsent)
      return
    clearMessages()
    setPendingConsent(next)
  }

  const handleConsentGranted = async () => {
    const pending = pendingConsent
    if (!pending)
      return
    setPendingConsent(null)
    let consent: AiTransferConsent | null = null
    try {
      consent = grantAiTransferConsent(pending.kind, settings.baseUrl)
      if (pending.kind === 'connection') {
        await runLoadModels(pending.verified, consent)
        return
      }
      await requestPermission()
      await saveAiSettings(settings, token, language)
      if (pending.action === 'start') {
        await startAiClassificationJob(
          { ...settings, token },
          bookmarks,
          categories,
          consent,
        )
      }
      else {
        await resumeAiClassificationJob(
          { ...settings, token },
          bookmarks,
          categories,
          consent,
        )
      }
    }
    catch (cause) {
      revokeAiTransferConsent(consent)
      setError(describeActionFailure(cause))
    }
  }

  const handleConsentDenied = () => {
    setPendingConsent(null)
    setStatus(t('aiConsentCancelled'))
  }

  const generatePreview = async () => {
    requestConsent({ kind: 'classification', action: 'start' })
  }

  const resumePreview = async () => {
    requestConsent({ kind: 'classification', action: 'resume' })
  }

  const requestModelConsent = async (verified = false) => {
    requestConsent({ kind: 'connection', verified })
  }

  const showSavedPreview = () => {
    setSuggestions(job.suggestions)
    setSelectedIds(new Set(job.suggestions.map(item => item.bookmarkId)))
    setPreviewOpen(true)
  }

  const applyPreview = async () => {
    setApplying(true)
    clearMessages()
    const selectedSuggestions = suggestions.filter(item =>
      selectedIds.has(item.bookmarkId),
    )
    try {
      const currentState = useNavStore.getState()
      const result = await applyClassificationSuggestions(
        selectedSuggestions,
        currentState.bookmarks,
        currentState.categories,
        async (bookmarkId, targetCategoryId) => {
          await chrome.bookmarks.move(toNodeId(bookmarkId), {
            parentId: toNodeId(targetCategoryId),
          })
        },
      )
      const movedIds = result.recovery?.items.map(item => item.bookmarkId) ?? []
      if (movedIds.length > 0)
        await markBookmarksOrganized(movedIds)
      await loadBookmarks()
      setRecovery(result.recovery)
      await clearAiClassificationJob()
      setPreviewOpen(false)
      setStatus(
        t('aiMoveCompleted', { count: result.moved, skipped: result.skipped }),
      )
    }
    catch {
      const savedRecovery = await loadAiClassificationRecovery()
      if (savedRecovery?.items.length) {
        await markBookmarksOrganized(savedRecovery.items.map(item => item.bookmarkId))
      }
      await loadBookmarks()
      setRecovery(savedRecovery)
      setPreviewOpen(false)
      setError(t('aiApplyFailed'))
    }
    finally {
      setApplying(false)
    }
  }

  const undoLastClassification = async () => {
    if (!recovery)
      return
    clearMessages()
    const currentState = useNavStore.getState()
    const result = await undoAiClassification(
      recovery,
      currentState.bookmarks,
      currentState.categories,
    )
    await loadBookmarks()
    setRecovery(null)
    setStatus(
      t('aiUndoCompleted', { count: result.restored, skipped: result.skipped }),
    )
  }

  const removeToken = async () => {
    await clearAiToken()
    setToken('')
    setStatus(t('aiTokenCleared'))
    setError('')
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-base font-semibold">{t('aiSettings')}</h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {t('aiSettingsDescription')}
        </p>
      </header>

      <SettingsAiClassificationSection
        job={job}
        jobActive={jobActive}
        jobControllable={jobControllable}
        status={status}
        error={error}
        recovery={recovery}
        bookmarkCount={bookmarks.length}
        onGeneratePreview={generatePreview}
        onResumePreview={resumePreview}
        onShowSavedPreview={showSavedPreview}
        onUndo={undoLastClassification}
      />

      <SettingsAiProviderSection
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
        settings={settings}
        onSettingsChange={updateSettings}
        token={token}
        onTokenChange={updateToken}
        tokenVisible={showToken}
        onToggleTokenVisibility={() => setShowToken(current => !current)}
        models={models}
        loadingModels={loadingModels}
        onLoadModels={requestModelConsent}
        language={language}
        onSave={saveConfiguration}
        onClearToken={removeToken}
      />

      <AiTransferConsentDialog
        open={pendingConsent !== null}
        kind={pendingConsent?.kind ?? 'classification'}
        baseUrl={settings.baseUrl}
        onGranted={() => void handleConsentGranted()}
        onDenied={handleConsentDenied}
      />

      <AiClassificationPreviewDialog
        open={previewOpen}
        suggestions={suggestions}
        selectedIds={selectedIds}
        bookmarks={bookmarks}
        categories={categories}
        applying={applying}
        onOpenChange={setPreviewOpen}
        onSelectedIdsChange={setSelectedIds}
        onApply={() => void applyPreview()}
      />
    </div>
  )
}
