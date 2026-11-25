import type { Bookmark, Category } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_CLASSIFICATION_REQUEST_FIELDS,
  classifyBookmarks,
} from './ai-bookmark-classification'
import {
  grantAiTransferConsent,
  revokeAiTransferConsent,
  revokeAllAiTransferConsent,
} from './ai-consent'

const storageValues = new Map<string, unknown>()

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    async get<T>(key: string): Promise<T | undefined> {
      return storageValues.get(key) as T | undefined
    }

    async set(key: string, value: unknown): Promise<void> {
      storageValues.set(key, value)
    }

    async remove(key: string): Promise<void> {
      storageValues.delete(key)
    }
  },
}))

const bookmarks: Bookmark[] = [
  {
    id: 'bm-1',
    name: 'Example',
    url: 'https://example.com/docs?private=value#part',
    categoryId: 'cat-1',
    description: 'Developer docs',
    tags: ['reference'],
  },
]
const categories: Category[] = [
  { id: 'cat-1', name: 'Inbox', emoji: '', parentId: 'all', modifiable: true },
  { id: 'cat-2', name: 'Docs', emoji: '', parentId: 'all', modifiable: true },
]
const config = {
  baseUrl: 'https://api.example.test/v1',
  token: 'secret-token',
  model: 'model-1',
  prompt: 'My custom prompt',
  batchSize: 80,
}

function classificationConsent(baseUrl = config.baseUrl) {
  return grantAiTransferConsent('classification', baseUrl)
}

function successResponse() {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

async function currentJob() {
  return import('./ai-classification-job')
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  revokeAllAiTransferConsent()
  storageValues.clear()
  const job = await currentJob()
  await job.clearAiClassificationJob()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ai classification consent gate', () => {
  it('starts only after consent and sends exactly the disclosed payload', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent(),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.test/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret-token')

    const body = JSON.parse(String(init.body)) as {
      model: string
      temperature: number
      messages: Array<{ role: string, content: string }>
    }
    expect(body.model).toBe('model-1')
    expect(body.temperature).toBe(0)
    expect(body.messages[0].content).toContain('My custom prompt')

    const userContent = JSON.parse(body.messages[1].content) as {
      categories: Array<{ id: string, path: string }>
      bookmarks: Array<Record<string, unknown>>
    }
    expect(Object.keys(userContent).sort()).toEqual(['bookmarks', 'categories'])
    expect(userContent.categories).toEqual([
      { id: 'cat-1', path: 'Inbox' },
      { id: 'cat-2', path: 'Docs' },
    ])

    const sentBookmark = userContent.bookmarks[0]
    expect(new Set(Object.keys(sentBookmark))).toEqual(
      new Set([
        'bookmarkId',
        'title',
        'url',
        'description',
        'tags',
        'currentCategoryPath',
      ]),
    )
    expect(sentBookmark.url).toBe('https://example.com/docs')
    // 揭露清單與實際 payload 必須一對一，任何一側新增欄位都會讓這裡失敗。
    expect(new Set(AI_CLASSIFICATION_REQUEST_FIELDS)).toEqual(
      new Set([
        ...Object.keys(sentBookmark),
        'categories',
        'model',
        'prompt',
      ]),
    )
  })

  it('sends no request at all without consent', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(config, bookmarks, categories)
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_required',
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no request when the consent was revoked before the request', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()
    const consent = classificationConsent()
    revokeAiTransferConsent(consent)

    await job.startAiClassificationJob(config, bookmarks, categories, consent)
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_required',
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not accept a connection consent for classification', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      grantAiTransferConsent('connection', config.baseUrl),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_required',
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not accept a consent issued for a different host', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent('https://other.example.test/v1'),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_host_mismatch',
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a new consent when the user resumes after an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent(),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('error')
    })
    expect(fetchMock).toHaveBeenCalledOnce()

    await job.resumeAiClassificationJob(config, bookmarks, categories)
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_required',
      })
    })
    expect(fetchMock).toHaveBeenCalledOnce()

    await job.resumeAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent(),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not reuse the consent of an earlier completed run', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()
    const firstConsent = classificationConsent()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      firstConsent,
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    })
    expect(fetchMock).toHaveBeenCalledOnce()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      firstConsent,
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot()).toMatchObject({
        status: 'error',
        error: 'ai.consent_required',
      })
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps the same consent for automatic retries inside one run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent(),
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    }, { timeout: 10_000 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('blocks direct non-UI calls that forge a consent object', async () => {
    const fetchMock = vi.fn(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      classifyBookmarks(config, bookmarks, categories, {
        consent: {
          id: 'forged',
          kind: 'classification',
          host: 'api.example.test',
        },
      }),
    ).rejects.toThrow('ai.consent_required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only one request when two starts race with separate consents', async () => {
    let releaseFetch = () => {}
    const pendingFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })
    const fetchMock = vi.fn(async () => {
      await pendingFetch
      return successResponse()
    })
    vi.stubGlobal('fetch', fetchMock)
    let granted = false
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: unknown) => Promise<void>,
        ) => {
          if (granted)
            return callback(null)
          granted = true
          return callback({})
        },
      },
    })
    const job = await currentJob()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      classificationConsent(),
    )
    await expect(
      job.startAiClassificationJob(
        config,
        bookmarks,
        categories,
        classificationConsent(),
      ),
    ).rejects.toThrow('ai.job_running_elsewhere')

    releaseFetch()
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('never persists consent material into storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => successResponse()))
    const job = await currentJob()
    const consent = classificationConsent()

    await job.startAiClassificationJob(
      config,
      bookmarks,
      categories,
      consent,
    )
    await vi.waitFor(() => {
      expect(job.getAiClassificationJobSnapshot().status).toBe('completed')
    })

    const persisted = JSON.stringify([...storageValues.values()])
    expect(persisted).not.toContain(consent.id)
    expect(persisted).not.toContain('consent')
  })
})
