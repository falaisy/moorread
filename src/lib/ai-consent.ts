export type AiTransferConsentKind = 'classification' | 'connection'

export interface AiTransferConsent {
  readonly id: string
  readonly kind: AiTransferConsentKind
  readonly host: string
}

interface ConsentGrant {
  kind: AiTransferConsentKind
  host: string
  expiresAt: number
}

/**
 * 同意只存在記憶體，關閉頁面即失效；閒置逾時同樣失效。
 * 不寫入 local／sync storage，也不跨執行沿用。
 */
export const AI_CONSENT_IDLE_TTL_MS = 30 * 60 * 1000

const grants = new Map<string, ConsentGrant>()

let sequence = 0

function createConsentId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid)
    return uuid
  sequence += 1
  return `ai-consent-${Date.now()}-${sequence}`
}

export function getAiConsentHost(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host.toLowerCase()
  }
  catch {
    throw new Error('ai.invalid_base_url')
  }
}

/** 使用者按下明確同意後才建立授權；每次新執行與每次續跑都要重新建立。 */
export function grantAiTransferConsent(
  kind: AiTransferConsentKind,
  baseUrl: string,
): AiTransferConsent {
  const host = getAiConsentHost(baseUrl)
  const id = createConsentId()
  grants.set(id, {
    kind,
    host,
    expiresAt: Date.now() + AI_CONSENT_IDLE_TTL_MS,
  })
  return { id, kind, host }
}

export function revokeAiTransferConsent(
  consent: AiTransferConsent | null | undefined,
): void {
  if (consent)
    grants.delete(consent.id)
}

export function revokeAllAiTransferConsent(): void {
  grants.clear()
}

/**
 * 真正的 request 出口前的檢查：授權不存在、種類不符、已撤銷／逾時，
 * 或目的地主機與同意時不同，一律視為未同意並中止。
 */
export function assertAiTransferConsent(
  consent: AiTransferConsent | null | undefined,
  kind: AiTransferConsentKind,
  baseUrl: string,
): void {
  const grant = consent ? grants.get(consent.id) : undefined
  if (!grant || grant.kind !== kind || grant.expiresAt <= Date.now())
    throw new Error('ai.consent_required')
  if (grant.host !== getAiConsentHost(baseUrl))
    throw new Error('ai.consent_host_mismatch')
  // 每次使用都延長有效期：同一次執行可跨多個批次，但閒置後自動失效。
  grant.expiresAt = Date.now() + AI_CONSENT_IDLE_TTL_MS
}
