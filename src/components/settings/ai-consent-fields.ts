import type { AI_CLASSIFICATION_REQUEST_FIELDS } from '~/lib/ai-bookmark-classification'
import type { AiMessageKey } from '~/lib/i18n-ai'

type RequestField = (typeof AI_CLASSIFICATION_REQUEST_FIELDS)[number]

/**
 * 揭露清單與實際 payload 欄位一對一。新增 payload 欄位時，這裡沒有對應的
 * 標籤就會讓型別檢查與測試失敗，避免文案漏欄位。
 */
export const AI_CONSENT_DISCLOSED_FIELDS: ReadonlyArray<{
  field: RequestField
  labelKey: AiMessageKey
}> = [
  { field: 'title', labelKey: 'aiConsentFieldTitle' },
  { field: 'url', labelKey: 'aiConsentFieldUrl' },
  { field: 'description', labelKey: 'aiConsentFieldDescription' },
  { field: 'tags', labelKey: 'aiConsentFieldTags' },
  { field: 'currentCategoryPath', labelKey: 'aiConsentFieldCategoryPath' },
  { field: 'bookmarkId', labelKey: 'aiConsentFieldBookmarkId' },
  { field: 'categories', labelKey: 'aiConsentFieldCategories' },
  { field: 'model', labelKey: 'aiConsentFieldModel' },
  { field: 'prompt', labelKey: 'aiConsentFieldPrompt' },
]
