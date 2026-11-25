import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_CONSENT_DISCLOSED_FIELDS } from '../components/settings/ai-consent-fields'
import { AI_CLASSIFICATION_REQUEST_FIELDS } from './ai-bookmark-classification'
import {
  AI_CONSENT_IDLE_TTL_MS,
  assertAiTransferConsent,
  getAiConsentHost,
  grantAiTransferConsent,
  revokeAiTransferConsent,
  revokeAllAiTransferConsent,
} from './ai-consent'

const baseUrl = 'https://api.example.com/v1'

afterEach(() => {
  vi.useRealTimers()
  revokeAllAiTransferConsent()
})

describe('ai transfer consent', () => {
  it('accepts a freshly granted consent for the same kind and host', () => {
    const consent = grantAiTransferConsent('classification', baseUrl)
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).not.toThrow()
  })

  it('rejects a missing or forged consent', () => {
    expect(() =>
      assertAiTransferConsent(undefined, 'classification', baseUrl),
    ).toThrow('ai.consent_required')
    expect(() =>
      assertAiTransferConsent(
        { id: 'forged', kind: 'classification', host: 'api.example.com' },
        'classification',
        baseUrl,
      ),
    ).toThrow('ai.consent_required')
  })

  it('rejects a revoked consent', () => {
    const consent = grantAiTransferConsent('classification', baseUrl)
    revokeAiTransferConsent(consent)
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).toThrow('ai.consent_required')
  })

  it('does not let a connection consent authorise classification', () => {
    const consent = grantAiTransferConsent('connection', baseUrl)
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).toThrow('ai.consent_required')
  })

  it('rejects a consent issued for another destination host', () => {
    const consent = grantAiTransferConsent(
      'classification',
      'https://other.example.com/v1',
    )
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).toThrow('ai.consent_host_mismatch')
  })

  it('expires after the idle window and is refreshed on use', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T00:00:00Z'))
    const consent = grantAiTransferConsent('classification', baseUrl)
    vi.setSystemTime(new Date(Date.now() + AI_CONSENT_IDLE_TTL_MS - 1_000))
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).not.toThrow()
    vi.setSystemTime(new Date(Date.now() + AI_CONSENT_IDLE_TTL_MS + 1_000))
    expect(() =>
      assertAiTransferConsent(consent, 'classification', baseUrl),
    ).toThrow('ai.consent_required')
  })

  it('derives the destination host and rejects invalid endpoints', () => {
    expect(getAiConsentHost(' HTTPS://API.Example.com:443/v1 ')).toBe(
      'api.example.com',
    )
    expect(() => getAiConsentHost('not a url')).toThrow('ai.invalid_base_url')
  })

  it('discloses every request field exactly once', () => {
    expect(
      AI_CONSENT_DISCLOSED_FIELDS.map(item => item.field).sort(),
    ).toEqual([...AI_CLASSIFICATION_REQUEST_FIELDS].sort())
    expect(new Set(AI_CONSENT_DISCLOSED_FIELDS.map(item => item.field)).size)
      .toBe(AI_CONSENT_DISCLOSED_FIELDS.length)
  })
})
