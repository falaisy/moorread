import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAiActionErrorMessageKey } from '../components/settings/settings-ai-error-message'
import {
  AI_PERMISSION_TIMEOUT_MS,
  ensureAiEndpointPermission,
} from './ai-bookmark-classification'

const baseUrl = 'https://api.example.com/v1'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function stubPermissions(options: {
  contains: boolean
  request?: () => Promise<boolean>
}) {
  const request = vi.fn(options.request ?? (() => Promise.resolve(true)))
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(() => Promise.resolve(options.contains)),
      request,
    },
  })
  return { request }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ensureAiEndpointPermission', () => {
  it('已授予權限時直接回傳 true 且不請求', async () => {
    const { request } = stubPermissions({ contains: true })
    await expect(ensureAiEndpointPermission(baseUrl)).resolves.toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('使用者同意時回傳 true', async () => {
    stubPermissions({ contains: false, request: () => Promise.resolve(true) })
    await expect(ensureAiEndpointPermission(baseUrl)).resolves.toBe(true)
  })

  it('使用者拒絕時回傳 false', async () => {
    stubPermissions({ contains: false, request: () => Promise.resolve(false) })
    await expect(ensureAiEndpointPermission(baseUrl)).resolves.toBe(false)
  })

  it('權限 API 拒絕承諾時拋出可區別的請求失敗錯誤', async () => {
    stubPermissions({
      contains: false,
      request: () => Promise.reject(new Error('permissions unavailable')),
    })
    await expect(ensureAiEndpointPermission(baseUrl))
      .rejects
      .toThrow('ai.permission_request_failed')
  })

  it('權限 API 同步拋錯時拋出可區別的請求失敗錯誤', async () => {
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(() => Promise.resolve(false)),
        request: vi.fn(() => {
          throw new Error('not a user gesture')
        }),
      },
    })
    await expect(ensureAiEndpointPermission(baseUrl))
      .rejects
      .toThrow('ai.permission_request_failed')
  })

  it('請求一直沒有結果時以逾時錯誤結束，不誤報為 AI 請求失敗', async () => {
    const pending = deferred<boolean>()
    stubPermissions({ contains: false, request: () => pending.promise })
    await expect(ensureAiEndpointPermission(baseUrl, 20))
      .rejects
      .toThrow('ai.permission_timeout')
    expect(resolveAiActionErrorMessageKey(new Error('ai.permission_timeout')))
      .toBe('aiPermissionTimeout')
  })

  it('逾時後才成功：不再重複執行或改變結果', async () => {
    const pending = deferred<boolean>()
    const { request } = stubPermissions({ contains: false, request: () => pending.promise })
    await expect(ensureAiEndpointPermission(baseUrl, 20))
      .rejects
      .toThrow('ai.permission_timeout')
    pending.resolve(true)
    await Promise.resolve()
    expect(request).toHaveBeenCalledOnce()
  })

  it('逾時後才失敗：維持逾時結果且不產生未處理的拒絕', async () => {
    const pending = deferred<boolean>()
    stubPermissions({ contains: false, request: () => pending.promise })
    await expect(ensureAiEndpointPermission(baseUrl, 20))
      .rejects
      .toThrow('ai.permission_timeout')
    pending.reject(new Error('late failure'))
    await Promise.resolve()
    expect(true).toBe(true)
  })

  it('預設逾時為 10 秒，維持既有 AI 請求逾時語意', () => {
    expect(AI_PERMISSION_TIMEOUT_MS).toBe(10_000)
  })
})

describe('resolveAiActionErrorMessageKey', () => {
  it('拒絕、請求失敗、逾時三種情況給出不同訊息鍵', () => {
    expect(resolveAiActionErrorMessageKey(new Error('ai.permission_denied'))).toBe('aiPermissionDenied')
    expect(resolveAiActionErrorMessageKey(new Error('ai.permission_request_failed'))).toBe('aiPermissionRequestFailed')
    expect(resolveAiActionErrorMessageKey(new Error('ai.permission_timeout'))).toBe('aiPermissionTimeout')
  })

  it('其他錯誤仍落到 AI 請求失敗，不被權限訊息吃掉', () => {
    expect(resolveAiActionErrorMessageKey(new Error('boom'))).toBe('aiRequestFailed')
  })
})
