import type { StateCreator } from 'zustand'
import type { LocalizedText } from './i18n'
import type { BookmarkSlice, DescriptionSyncResult, NavState } from './store-types'
import type { Bookmark, BookmarkMeta, Settings } from './types'

import { getDescriptionSyncStatus } from './description-sync'
import { reportExpectedFallback } from './diagnostics'
import { localizedMessage } from './i18n'
import { LocalizedError, localizedErrorMessage } from './localized-error'
import { fetchSiteDescription } from './site-metadata'
import { ensureSitePermissions } from './site-permissions'
import { applyMeta } from './store-helpers'
import { updateBookmarkMetadata } from './store-persistence'

type BookmarkSliceSetter = Parameters<StateCreator<NavState, [], [], BookmarkSlice>>[0]
type BookmarkSliceGetter = () => NavState

const DESCRIPTION_FETCH_CONCURRENCY = 3
const MAX_DESCRIPTION_LENGTH = 300

let descriptionSyncPromise: Promise<DescriptionSyncResult> | undefined

async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await task(item)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
}

interface DescriptionFetchProgress {
  completed: number
  updated: number
}

interface DescriptionFetchOutcome {
  descriptions: Record<string, string>
  updatedCount: number
  failedCount: number
}

function selectDescriptionTargets(
  ids: string[],
  bookmarks: Bookmark[],
  ignoredDomains: Settings['descriptionIgnoredDomains'],
): Bookmark[] {
  const selectedIds = new Set(ids)
  const seenUrls = new Set<string>()
  return bookmarks.filter((bookmark) => {
    if (!selectedIds.has(bookmark.id))
      return false
    if (seenUrls.has(bookmark.url))
      return false
    seenUrls.add(bookmark.url)
    return (
      getDescriptionSyncStatus(bookmark, ignoredDomains) === 'eligible'
    )
  })
}

async function collectSiteDescriptions(
  targets: Bookmark[],
  isEligible: (bookmark: Bookmark) => boolean,
  hasDescription: (url: string) => boolean,
  onProgress: (progress: DescriptionFetchProgress) => void,
): Promise<DescriptionFetchOutcome> {
  let updatedCount = 0
  let failedCount = 0
  let completedCount = 0
  const descriptions: Record<string, string> = {}

  await forEachConcurrent(
    targets,
    DESCRIPTION_FETCH_CONCURRENCY,
    async (bookmark) => {
      if (!isEligible(bookmark))
        return

      try {
        const description = (await fetchSiteDescription(bookmark.url))
          ?.replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_DESCRIPTION_LENGTH)
        if (!description) {
          // fetch 成功但 HTML 裡完全沒有 meta description 或 og:description
          reportExpectedFallback('description-sync.no-meta', {
            url: bookmark.url,
            reason: 'fetch-ok-but-no-meta-description',
          })
          failedCount += 1
          return
        }
        if (hasDescription(bookmark.url))
          return
        descriptions[bookmark.url] = description
        updatedCount += 1
      }
      catch (cause) {
        // 單站失敗不影響其他書籤，直接印出 URL + 錯誤類型方便日後追查
        const err = cause as any
        reportExpectedFallback('description-sync.site', {
          url: bookmark.url,
          errorKey: err?.key ?? 'unknown',
          errorMessage: err?.message ?? String(cause),
          status: err?.params?.status ?? err?.status,
        })
        failedCount += 1
      }
      finally {
        completedCount += 1
        onProgress({ completed: completedCount, updated: updatedCount })
      }
    },
  )

  return { descriptions, updatedCount, failedCount }
}

function applyNewDescriptions(
  latestMeta: Record<string, BookmarkMeta>,
  descriptions: Record<string, string>,
): { meta: Record<string, BookmarkMeta>, addedCount: number } {
  const meta = { ...latestMeta }
  let addedCount = 0
  for (const [url, description] of Object.entries(descriptions)) {
    if (meta[url]?.description)
      continue
    meta[url] = { ...meta[url], description }
    addedCount += 1
  }
  return { meta, addedCount }
}

function describeDescriptionSyncResult(
  result: DescriptionSyncResult,
): LocalizedText {
  if (result.failed > 0) {
    return localizedMessage('runtimeDescriptionCompleteWithFailures', {
      attempted: result.attempted,
      updated: result.updated,
      failed: result.failed,
    })
  }
  return localizedMessage('runtimeDescriptionComplete', {
    attempted: result.attempted,
    updated: result.updated,
  })
}

export function createBookmarkDescriptionActions(
  set: BookmarkSliceSetter,
  get: BookmarkSliceGetter,
): Pick<BookmarkSlice, 'syncMissingDescriptions' | 'syncBookmarkDescriptions'> {
  return {
    syncMissingDescriptions: async () =>
      get().syncBookmarkDescriptions(
        get().bookmarks.map(bookmark => bookmark.id),
      ),

    syncBookmarkDescriptions: async (ids) => {
      if (descriptionSyncPromise)
        return descriptionSyncPromise

      descriptionSyncPromise = (async () => {
        const targets = selectDescriptionTargets(
          ids,
          get().bookmarks,
          get().settings.descriptionIgnoredDomains,
        )
        // 跨站抓取依賴 optional host permission；沒有權限時直接失敗並提示，
        // 而不是靜默地「補全 0 條」。
        if (targets.length > 0 && !(await ensureSitePermissions()))
          throw new LocalizedError('runtimeDescriptionPermissionRequired')

        get().beginTask({
          id: 'description-sync',
          type: 'description-sync',
          label: localizedMessage('runtimeDescriptionTask'),
          total: targets.length,
        })

        const outcome = await collectSiteDescriptions(
          targets,
          bookmark => getDescriptionSyncStatus(
            bookmark,
            get().settings.descriptionIgnoredDomains,
          ) === 'eligible',
          url => Boolean(get().meta[url]?.description),
          (progress) => {
            get().updateTask('description-sync', {
              completed: progress.completed,
              message: localizedMessage('runtimeDescriptionProgress', {
                count: progress.updated,
              }),
            })
          },
        )

        if (outcome.updatedCount === 0) {
          return {
            attempted: targets.length,
            updated: 0,
            failed: outcome.failedCount,
          }
        }

        let addedCount = 0
        const meta = await updateBookmarkMetadata((latest) => {
          const applied = applyNewDescriptions(latest, outcome.descriptions)
          addedCount = applied.addedCount
          return applied.meta
        }, () => get().meta)
        set({ meta, bookmarks: applyMeta(get().bookmarks, meta) })
        return {
          attempted: targets.length,
          updated: addedCount,
          failed: outcome.failedCount,
        }
      })()

      try {
        const result = await descriptionSyncPromise
        get().finishTask(
          'description-sync',
          'success',
          describeDescriptionSyncResult(result),
        )
        return result
      }
      catch (cause) {
        get().finishTask(
          'description-sync',
          'error',
          localizedErrorMessage(cause, 'runtimeDescriptionFailed'),
        )
        throw cause
      }
      finally {
        descriptionSyncPromise = undefined
      }
    },
  }
}
