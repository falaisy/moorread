import type { Language } from './types'

export const aiClassificationPrompts: Record<Language, string> = {
  'zh-TW':
    '你是書籤整理助手。根據標題、網域、描述、標籤和目前資料夾，將書籤歸入最適合的現有資料夾。優先保留已有的合理分類；只有明顯更適合時才建議移動；信心不足時保持不變。不要建立、刪除或重新命名資料夾。',
  'en': 'You organize bookmarks. Use each bookmark\'s title, domain, description, tags, and current folder to place it in the most suitable existing folder. Preserve reasonable existing classifications. Suggest a move only when another folder is clearly better, and leave uncertain items unchanged. Do not create, delete, or rename folders.',
}

const en = {
  aiSettings: 'AI',
  aiSettingsDescription:
    'Connect an OpenAI-compatible service to generate bookmark classification suggestions.',
  aiProvider: 'OpenAI-compatible configuration',
  aiProviderDescription:
    'Configure the endpoint, token, and model. The token is never synced or included in backups.',
  aiBaseUrl: 'Base URL',
  aiToken: 'Token',
  aiModel: 'Model',
  aiPrompt: 'Classification prompt',
  aiShowToken: 'Show token',
  aiHideToken: 'Hide token',
  aiFetchModels: 'Fetch models',
  aiFetchingModels: 'Fetching',
  aiManualModelHint: 'Choose from the list or enter a model ID manually.',
  aiBatchSize: 'Bookmarks per batch',
  aiBatchSizeHint:
    'Defaults to 80. Very long content may be split into smaller batches by the character limit.',
  aiRememberToken: 'Save token on this device',
  aiRememberTokenHint:
    'When off, the token lasts only for this browser session.',
  aiSaveConfiguration: 'Save configuration',
  aiVerifyConfiguration: 'Verify connection',
  aiClearToken: 'Clear token',
  aiResetPrompt: 'Restore default prompt',
  aiConfigurationSaved: 'AI configuration saved',
  aiConnectionVerified: 'Connection verified, {count} models available',
  aiModelsLoaded: 'Loaded {count} models',
  aiTokenCleared: 'Token cleared',
  aiPrivacyNotice: 'Review the data before each transfer',
  aiPrivacyDescription:
    'Sends titles, URLs without query parameters, descriptions, tags, and folder paths. Browsing history and open counts are excluded.',
  aiConsentClassificationTitle: 'Confirm before sending bookmark data',
  aiConsentPurpose:
    'Purpose: generate bookmark classification and move suggestions.',
  aiConsentDestination: 'Destination: the AI service you configured, {host}.',
  aiConsentFieldsIntro: 'This run sends:',
  aiConsentFieldTitle: 'Bookmark titles',
  aiConsentFieldUrl: 'URLs with query parameters and anchors removed',
  aiConsentFieldDescription: 'Bookmark descriptions',
  aiConsentFieldTags: 'Bookmark tags',
  aiConsentFieldCategoryPath: 'The folder path each bookmark is currently in',
  aiConsentFieldBookmarkId: 'Internal bookmark IDs (bookmarkId)',
  aiConsentFieldCategories:
    'The complete folder list (folder IDs and paths)',
  aiConsentFieldModel: 'The model name you configured (model)',
  aiConsentFieldPrompt: 'The classification prompt you configured (prompt)',
  aiConsentNotSent:
    'Not sent: browsing history, open counts, tabs, trash and operation history.',
  aiConsentToken:
    'The token is sent to the same service in the request header (Authorization: Bearer). It is never synced or written into backups.',
  aiConsentRetry:
    'If a request temporarily fails, it is retried automatically up to 2 times in the same run with identical content.',
  aiConsentAccept: 'Agree and send',
  aiConsentCancel: 'Cancel',
  aiConsentCancelled: 'Cancelled. Nothing was sent.',
  aiConsentRequired:
    'Transfer consent is required. Nothing was sent to the AI service.',
  aiConsentConnectionTitle: 'Confirm before testing the connection',
  aiConsentConnectionBody:
    'Only the token is sent to {host} to verify the connection or list models. No bookmarks, folder lists, classification content or other bookmark data are sent.',
  aiConsentConnectionAccept: 'Agree and test',
  aiClassification: 'Smart classification',
  aiClassificationDescription:
    'AI only creates suggestions. Browser bookmarks change only after you review and confirm them.',
  aiGeneratePreview: 'Generate preview',
  aiGeneratingPreview: 'Analyzing {completed}/{total}',
  aiRetryingRequest:
    'The request temporarily failed. Retrying {attempt}/{max}…',
  aiPreviewOnly: 'Generating a preview does not modify bookmarks.',
  aiProgressPersists:
    'Closing settings keeps the progress and completed results.',
  aiPause: 'Pause',
  aiPausing: 'Pausing',
  aiPaused: 'The task is paused and can be resumed later.',
  aiResume: 'Resume',
  aiTerminate: 'Terminate',
  aiTerminated:
    'The task was terminated. Completed results are still available to preview.',
  aiViewPreview: 'View preview',
  aiPreviewTitle: 'Smart classification preview',
  aiPreviewDescription:
    'Review each move, deselect unwanted items, then confirm the selected changes.',
  aiSelectAll: 'Select all',
  aiSelectNone: 'Select none',
  aiSelectedCount: '{count} selected',
  aiFromFolder: 'From',
  aiToFolder: 'To',
  aiConfidence: '{count}% confidence',
  aiApplySelected: 'Confirm moves',
  aiApplying: 'Moving',
  aiNoSuggestions: 'AI found no bookmarks that need moving.',
  aiMoveCompleted:
    'Moved {count} bookmarks and skipped {skipped} changed items.',
  aiUndoAvailable:
    'The latest smart classification can be undone for 24 hours.',
  aiUndo: 'Undo smart classification',
  aiUndoCompleted: 'Restored {count} bookmarks and skipped {skipped} items.',
  aiInvalidBaseUrl: 'Enter a valid HTTP or HTTPS endpoint.',
  aiInsecureEndpoint:
    'With a token, HTTP is allowed only for localhost or loopback addresses.',
  aiModelRequired: 'Enter or select a model.',
  aiPromptRequired: 'Enter a classification prompt.',
  aiPermissionDenied: 'Access to this service endpoint was not granted.',
  aiPermissionRequestFailed:
    'The browser could not complete the permission request. Try again.',
  aiPermissionTimeout:
    'The browser did not answer the permission request in time. Nothing was sent to the AI service.',
  aiInvalidResponse:
    'The model returned an invalid result. No bookmarks were changed.',
  aiRequestFailed:
    'The AI request failed. Check the endpoint, token, model, and provider compatibility.',
  aiApplyFailed: 'A move failed. Successfully moved items can still be undone.',
}

export type AiMessageKey = keyof typeof en
type AiMessages = Record<AiMessageKey, string>

const zhTW: AiMessages = {
  aiSettings: 'AI',
  aiSettingsDescription: '連接 OpenAI 相容服務，使用 AI 產生書籤分類建議。',
  aiProvider: 'OpenAI 相容設定',
  aiProviderDescription:
    '設定服務位址、密鑰和模型。密鑰不會同步或包含在備份中。',
  aiBaseUrl: 'Base URL',
  aiToken: 'Token',
  aiModel: '模型',
  aiPrompt: '分類提示詞',
  aiShowToken: '顯示 Token',
  aiHideToken: '隱藏 Token',
  aiFetchModels: '取得模型清單',
  aiFetchingModels: '正在取得',
  aiManualModelHint: '可從清單選擇，也可手動輸入模型 ID。',
  aiBatchSize: '每批書籤數',
  aiBatchSizeHint: '預設為 80。內容過長時會依字元上限自動分成更小批次。',
  aiRememberToken: '在此裝置上儲存 Token',
  aiRememberTokenHint: '關閉時，Token 只保留到目前瀏覽器工作階段結束。',
  aiSaveConfiguration: '儲存設定',
  aiVerifyConfiguration: '驗證連線',
  aiClearToken: '清除 Token',
  aiResetPrompt: '恢復預設提示詞',
  aiConfigurationSaved: 'AI 設定已儲存',
  aiConnectionVerified: '連線成功，可用模型 {count} 個',
  aiModelsLoaded: '已取得 {count} 個模型',
  aiTokenCleared: 'Token 已清除',
  aiPrivacyNotice: '每次傳送前都會先顯示資料揭露，並需要你明確同意。',
  aiPrivacyDescription:
    '會傳送書籤標題、移除查詢參數後的網址、描述、標籤和資料夾路徑，不會傳送瀏覽記錄或開啟次數。',
  aiConsentClassificationTitle: '傳送書籤資料給 AI 服務前請確認',
  aiConsentPurpose: '用途：產生書籤分類與移動建議。',
  aiConsentDestination: '目的地：你設定的 AI 服務 {host}。',
  aiConsentFieldsIntro: '這次會送出以下資料：',
  aiConsentFieldTitle: '書籤標題',
  aiConsentFieldUrl: '移除查詢參數與錨點後的網址',
  aiConsentFieldDescription: '書籤描述',
  aiConsentFieldTags: '書籤標籤',
  aiConsentFieldCategoryPath: '書籤目前所在的資料夾路徑',
  aiConsentFieldBookmarkId: '書籤內部識別碼（bookmarkId）',
  aiConsentFieldCategories: '完整資料夾清單（資料夾 ID 與路徑）',
  aiConsentFieldModel: '你設定的模型名稱（model）',
  aiConsentFieldPrompt: '你設定的分類提示詞（prompt）',
  aiConsentNotSent: '不會送出：瀏覽記錄、開啟次數、分頁、垃圾桶與操作歷史。',
  aiConsentToken:
    'Token 會放在請求標頭（Authorization: Bearer）送到同一個服務；不會同步，也不會寫入備份。',
  aiConsentRetry:
    '若請求暫時失敗，同一次執行內最多自動重試 2 次，送出內容相同。',
  aiConsentAccept: '同意並送出',
  aiConsentCancel: '取消',
  aiConsentCancelled: '已取消，未送出任何資料。',
  aiConsentRequired: '需要先同意資料傳輸，未送出任何內容到 AI 服務。',
  aiConsentConnectionTitle: '連線測試前請確認',
  aiConsentConnectionBody:
    '只會把 Token 送到 {host}，用於驗證連線或取得模型清單；不會送出書籤、資料夾清單、分類內容或其他書籤資料。',
  aiConsentConnectionAccept: '同意並測試',
  aiClassification: '智慧分類',
  aiClassificationDescription:
    'AI 只會產生移動建議。您可以逐項檢查，確認後才會修改瀏覽器書籤。',
  aiGeneratePreview: '產生分類預覽',
  aiGeneratingPreview: '正在分析 {completed}/{total}',
  aiRetryingRequest: '請求暫時失敗，正在自動重試 {attempt}/{max}…',
  aiPreviewOnly: '產生預覽不會修改任何書籤。',
  aiProgressPersists: '關閉設定不會遺失進度和已完成的結果。',
  aiPause: '暫停',
  aiPausing: '正在暫停',
  aiPaused: '任務已暫停，可稍後繼續。',
  aiResume: '繼續',
  aiTerminate: '終止',
  aiTerminated: '任務已終止，已完成的結果仍可預覽。',
  aiViewPreview: '查看預覽',
  aiPreviewTitle: '智慧分類預覽',
  aiPreviewDescription: '檢查每項移動建議，取消不需要的項目，再確認套用。',
  aiSelectAll: '全選',
  aiSelectNone: '全不選',
  aiSelectedCount: '已選擇 {count} 項',
  aiFromFolder: '原資料夾',
  aiToFolder: '目標資料夾',
  aiConfidence: '信心度 {count}%',
  aiApplySelected: '確認移動',
  aiApplying: '正在移動',
  aiNoSuggestions: 'AI 沒有發現需要調整的書籤。',
  aiMoveCompleted: '已移動 {count} 個書籤，略過 {skipped} 個已變更的項目。',
  aiUndoAvailable: '最近一次智慧分類可在 24 小時內撤銷。',
  aiUndo: '撤銷智慧分類',
  aiUndoCompleted: '已復原 {count} 個書籤，略過 {skipped} 個項目。',
  aiInvalidBaseUrl: '請輸入有效的 HTTP 或 HTTPS 服務位址。',
  aiInsecureEndpoint: '攜帶 Token 時，HTTP 僅允許 localhost 或回環位址。',
  aiModelRequired: '請輸入或選擇模型。',
  aiPromptRequired: '請輸入分類提示詞。',
  aiPermissionDenied: '未獲得此服務位址的存取權限。',
  aiPermissionRequestFailed: '瀏覽器無法完成權限請求，請再試一次。',
  aiPermissionTimeout:
    '瀏覽器在時限內未回應權限請求，未傳送任何內容到 AI 服務。',
  aiInvalidResponse: '模型回傳的分類結果格式無效，未修改書籤。',
  aiRequestFailed: 'AI 請求失敗，請檢查位址、Token、模型和服務相容性。',
  aiApplyFailed: '移動過程中發生錯誤，已成功移動的項目仍可撤銷。',
}

export const aiMessages: Record<Language, AiMessages> = {
  'zh-TW': zhTW,
  en,
}

/**
 * 同意視窗逐項列出的傳送欄位；順序與
 * `AI_CLASSIFICATION_REQUEST_FIELDS` 對應，測試會檢查兩者數量一致。
 */
export const aiConsentFieldMessageKeys = [
  'aiConsentFieldTitle',
  'aiConsentFieldUrl',
  'aiConsentFieldDescription',
  'aiConsentFieldTags',
  'aiConsentFieldCategoryPath',
  'aiConsentFieldBookmarkId',
  'aiConsentFieldCategories',
  'aiConsentFieldModel',
  'aiConsentFieldPrompt',
] as const satisfies readonly AiMessageKey[]
