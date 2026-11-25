import type { MessageKey } from '~/lib/i18n'

// AI 相關 lib 以固定錯誤字串回報，這裡集中轉成翻譯鍵，避免各區塊各寫一份映射。
export function resolveAiErrorMessageKey(cause: unknown): MessageKey {
  const message = cause instanceof Error ? cause.message : ''
  if (message === 'ai.invalid_base_url')
    return 'aiInvalidBaseUrl'
  if (message === 'ai.insecure_token_endpoint')
    return 'aiInsecureEndpoint'
  if (message === 'ai.model_required')
    return 'aiModelRequired'
  if (message === 'ai.prompt_required')
    return 'aiPromptRequired'
  if (message === 'ai.consent_required' || message === 'ai.consent_host_mismatch')
    return 'aiConsentRequired'
  if (message === 'ai.invalid_response' || cause instanceof SyntaxError)
    return 'aiInvalidResponse'
  return 'aiRequestFailed'
}

export function resolveAiActionErrorMessageKey(cause: unknown): MessageKey {
  const message = cause instanceof Error ? cause.message : ''
  if (message === 'ai.permission_denied')
    return 'aiPermissionDenied'
  if (message === 'ai.permission_timeout')
    return 'aiPermissionTimeout'
  if (message === 'ai.permission_request_failed')
    return 'aiPermissionRequestFailed'
  return resolveAiErrorMessageKey(cause)
}
